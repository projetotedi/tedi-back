import { HttpException, Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { ArchiveDto } from "@shared/dto/archive.dto";
import { isArchived, markArchived, markUnarchived } from "@shared/entities/archivable.columns";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { ClassResponseDto } from "../dto/class.response.dto";
import { CreateClassDto } from "../dto/create-class.dto";
import { UpdateClassDto } from "../dto/update-class.dto";
import { SchoolClass } from "../entities/class.entity";
import { Edition } from "../entities/edition.entity";
import { ClassStatus } from "../enums/class-status.enum";
import { invalidPeriod, isValidPeriod } from "./class-period";
import { toClassResponse } from "./class-response.mapper";
import { EditionsService } from "./editions.service";
import { EnrollmentCountsService } from "./enrollment-counts.service";

/** The fields of the class an edit copies from the body when they differ (the edition is apart). */
const CLASS_FIELDS = [
  "code",
  "name",
  "startDate",
  "endDate",
  "location",
  "capacity",
  "status",
] as const;

const CLASS_TARGET_TYPE = "class";

/** The unique index on (edition_id, LOWER("code")), created by the migration (see SchoolClass). */
const CLASS_CODE_INDEX = "uq_classes_edition_id_code";
const CLASS_COURSE_FOREIGN_KEY = "fk_classes_course_id";
const CLASS_PERIOD_CHECK = "ck_classes_period";

export function classNotFound(): HttpException {
  return new HttpException({ error: "CLASS_NOT_FOUND", message: "Class not found." }, 404);
}

function classArchived(): HttpException {
  return new HttpException(
    { error: "CLASS_ARCHIVED", message: "Archived classes are read-only." },
    409,
  );
}

/** The one place that builds "code taken": the pre-check and the unique violation. */
function classCodeTaken(): HttpException {
  return new HttpException(
    {
      error: "CLASS_CODE_TAKEN",
      message: "A class with this code already exists in this edition.",
    },
    409,
  );
}

/**
 * The `courseId` of the body is not a course. It is the answer to the foreign key violation until
 * GUS-102 adds the lookup in the catalog (and the archived course) in front of it.
 */
function courseNotFound(): HttpException {
  return new HttpException({ error: "COURSE_NOT_FOUND", message: "Course not found." }, 400);
}

function classHasActiveEnrollments(): HttpException {
  return new HttpException(
    {
      error: "CLASS_HAS_ACTIVE_ENROLLMENTS",
      message: "A class with active enrollments cannot be archived.",
    },
    409,
  );
}

function capacityBelowEnrolled(): HttpException {
  return new HttpException(
    {
      error: "CAPACITY_BELOW_ENROLLED",
      message: "The capacity cannot be lower than the number of active enrollments.",
    },
    409,
  );
}

interface FieldChanges {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  fields: string[];
}

/**
 * Classes (turmas) of the courses: create, edit, archive and unarchive (RF-024, RF-034, RN-10,
 * RN-13, RN-21, RN-22, RN-27). The edition of a class is created on demand, by its name.
 *
 * Every write runs in a transaction and the audit event goes out after the commit, only when
 * something changed. Listing and detail are other cards (GUS-103 and GUS-104).
 */
@Injectable()
export class ClassesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly editions: EditionsService,
    private readonly enrollmentCounts: EnrollmentCountsService,
  ) {}

  /**
   * Creates a class, and its edition when `editionName` does not exist yet, in one transaction.
   * A repeated name reuses the edition. The class starts `planned` unless the body says otherwise.
   *
   * Errors: 400 INVALID_PERIOD (end before start, answered before the transaction opens), 409
   * CLASS_CODE_TAKEN (the code exists in that edition, ignoring case and archived classes
   * included; a race on the unique index answers the same) and 400 COURSE_NOT_FOUND (the foreign
   * key violation). A failure rolls the new edition back with the class.
   *
   * Emits CLASS_CREATED after the commit.
   */
  async create(dto: CreateClassDto, actorId: string): Promise<ClassResponseDto> {
    if (!isValidPeriod(dto.startDate, dto.endDate)) throw invalidPeriod();

    const created = await this.runInTransaction(async (manager) => {
      const { edition, created: editionCreated } = await this.editions.findOrCreate(
        manager,
        dto.editionName,
      );
      await this.assertCodeAvailable(manager, edition.id, dto.code);

      const schoolClass = await manager.save(
        manager.create(SchoolClass, {
          code: dto.code,
          name: dto.name ?? null,
          courseId: dto.courseId,
          editionId: edition.id,
          startDate: dto.startDate,
          endDate: dto.endDate,
          location: dto.location ?? null,
          capacity: dto.capacity,
          status: dto.status ?? ClassStatus.PLANNED,
          createdById: actorId,
        }),
      );

      return { schoolClass, edition, editionCreated };
    });

    const { schoolClass, edition, editionCreated } = created;
    this.emit(AuditableAction.CLASS_CREATED, actorId, schoolClass.id, null, {
      code: schoolClass.code,
      name: schoolClass.name,
      courseId: schoolClass.courseId,
      editionId: edition.id,
      editionName: edition.name,
      editionCreated,
      startDate: schoolClass.startDate,
      endDate: schoolClass.endDate,
      location: schoolClass.location,
      capacity: schoolClass.capacity,
      status: schoolClass.status,
    });

    return toClassResponse(schoolClass, edition);
  }

  /**
   * Edits a class. Every field is optional: omitted keeps, `name` and `location` sent as null
   * clear. `editionName` moves the class to that edition, created on demand. The course never
   * changes (RN-13), and the status takes any value: the rules of the moves between statuses are
   * the F2.6 card.
   *
   * Errors, in the order they are answered: 404 CLASS_NOT_FOUND, 409 CLASS_ARCHIVED (archived
   * classes are read-only, RN-27), 400 INVALID_PERIOD (the period that results, with the dates
   * sent and the ones already stored, must end on or after it starts), 409 CLASS_CODE_TAKEN (only
   * when the code or the edition changes; the class itself is left out of the check, so changing
   * only the case of its own code passes) and 409 CAPACITY_BELOW_ENROLLED (only when the seats
   * change, and below the number of active enrollments).
   *
   * The row of the class is locked FOR UPDATE until the end of the transaction, so two edits of
   * the same class are serialized, and so is an edit and an archive.
   *
   * Without a change (or with an empty body) nothing is written and no event is emitted. Emits
   * CLASS_UPDATED after the commit, with only the fields that changed.
   *
   * `requestedId` is only the key of the lookup. The UUID pipe of the route accepts upper case and
   * Postgres finds the row all the same, but the ids of the database are lower case. So everything
   * after the lookup (comparisons, writes and the event) uses `schoolClass.id`, the id of the
   * database.
   */
  async update(
    requestedId: string,
    dto: UpdateClassDto,
    actorId: string,
  ): Promise<ClassResponseDto> {
    const changes: FieldChanges = { before: {}, after: {}, fields: [] };

    const updated = await this.runInTransaction(async (manager) => {
      const schoolClass = await this.loadClass(manager, requestedId);
      if (isArchived(schoolClass.archive)) throw classArchived();

      if (dto.startDate !== undefined || dto.endDate !== undefined) {
        const startDate = dto.startDate ?? schoolClass.startDate;
        const endDate = dto.endDate ?? schoolClass.endDate;
        if (!isValidPeriod(startDate, endDate)) throw invalidPeriod();
      }

      let edition = await this.loadEdition(manager, schoolClass.editionId);
      let editionChanged = false;
      if (dto.editionName !== undefined && dto.editionName !== edition.name) {
        const next = (await this.editions.findOrCreate(manager, dto.editionName)).edition;

        changes.before.editionId = edition.id;
        changes.before.editionName = edition.name;
        changes.after.editionId = next.id;
        changes.after.editionName = next.name;
        changes.fields.push("editionId", "editionName");

        schoolClass.editionId = next.id;
        edition = next;
        editionChanged = true;
      }

      const codeChanged = dto.code !== undefined && dto.code !== schoolClass.code;
      if (codeChanged || editionChanged) {
        await this.assertCodeAvailable(
          manager,
          edition.id,
          dto.code ?? schoolClass.code,
          schoolClass.id,
        );
      }

      if (dto.capacity !== undefined && dto.capacity !== schoolClass.capacity) {
        const active = await this.enrollmentCounts.countActive(manager, schoolClass.id);
        if (dto.capacity < active) throw capacityBelowEnrolled();
      }

      const classChanged = this.applyChanges(schoolClass, dto as Record<string, unknown>, changes);

      if (classChanged || editionChanged) {
        schoolClass.updatedAt = this.clock.now();
        await manager.save(schoolClass);
      }

      return { schoolClass, edition };
    });

    if (changes.fields.length > 0) {
      this.emit(AuditableAction.CLASS_UPDATED, actorId, updated.schoolClass.id, changes.before, {
        ...changes.after,
        changedFields: changes.fields,
      });
    }

    return toClassResponse(updated.schoolClass, updated.edition);
  }

  /**
   * Archives a class instead of deleting it (RN-27). It leaves the default listing, stays
   * readable by id and becomes read-only. Archiving an archived class is a no-op that answers 200
   * and keeps the first archive (no write, no event, and the enrollments are not even counted).
   *
   * A class with active enrollments cannot be archived: 409 CLASS_HAS_ACTIVE_ENROLLMENTS. Until
   * GUS-108 there is no enrollment, so the count is 0 (see EnrollmentCountsService).
   *
   * Emits CLASS_ARCHIVED after the commit, only when the class was archived now.
   */
  async archive(
    requestedId: string,
    dto: ArchiveDto | undefined,
    actorId: string,
  ): Promise<ClassResponseDto> {
    const now = this.clock.now();

    const result = await this.runInTransaction(async (manager) => {
      const schoolClass = await this.loadClass(manager, requestedId);

      let changed = false;
      if (!isArchived(schoolClass.archive)) {
        const active = await this.enrollmentCounts.countActive(manager, schoolClass.id);
        if (active > 0) throw classHasActiveEnrollments();

        changed = markArchived(schoolClass.archive, actorId, dto?.reason ?? null, now);
        await manager.save(schoolClass);
      }

      const edition = await this.loadEdition(manager, schoolClass.editionId);
      return { schoolClass, edition, changed };
    });

    if (result.changed) {
      this.emit(
        AuditableAction.CLASS_ARCHIVED,
        actorId,
        result.schoolClass.id,
        { archivedAt: null },
        {
          archivedAt: result.schoolClass.archive.archivedAt,
          archiveReason: result.schoolClass.archive.archiveReason,
        },
      );
    }

    return toClassResponse(result.schoolClass, result.edition);
  }

  /**
   * Reactivates an archived class: clears the three archive columns. A class that is not archived
   * is a no-op that answers 200 (no write, no event). Emits CLASS_UNARCHIVED after the commit,
   * only when the class was reactivated now.
   */
  async unarchive(requestedId: string, actorId: string): Promise<ClassResponseDto> {
    const result = await this.runInTransaction(async (manager) => {
      const schoolClass = await this.loadClass(manager, requestedId);

      const before = {
        archivedAt: schoolClass.archive.archivedAt,
        archivedById: schoolClass.archive.archivedById,
        archiveReason: schoolClass.archive.archiveReason,
      };
      const changed = markUnarchived(schoolClass.archive);
      if (changed) await manager.save(schoolClass);

      const edition = await this.loadEdition(manager, schoolClass.editionId);
      return { schoolClass, edition, before, changed };
    });

    if (result.changed) {
      this.emit(AuditableAction.CLASS_UNARCHIVED, actorId, result.schoolClass.id, result.before, {
        archivedAt: null,
      });
    }

    return toClassResponse(result.schoolClass, result.edition);
  }

  /**
   * Runs the work in a transaction and turns the constraint violations that mean a business error
   * into it: a repeated code (409), a course that does not exist (400) and a period upside down
   * (400, which the check before the write normally answers first).
   */
  private async runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      throw this.mapConstraintError(error);
    }
  }

  /** The class, locked FOR UPDATE until the end of the transaction. */
  private async loadClass(manager: EntityManager, id: string): Promise<SchoolClass> {
    const schoolClass = await manager.findOne(SchoolClass, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (schoolClass === null) throw classNotFound();

    return schoolClass;
  }

  /** The edition a class points to: the foreign key guarantees it exists, even a soft-deleted one. */
  private loadEdition(manager: EntityManager, id: string): Promise<Edition> {
    return manager.findOneOrFail(Edition, { where: { id }, withDeleted: true });
  }

  /** Copies the fields that were sent and differ into the class, and records before and after. */
  private applyChanges(
    schoolClass: SchoolClass,
    values: Readonly<Record<string, unknown>>,
    changes: FieldChanges,
  ): boolean {
    const target = schoolClass as unknown as Record<string, unknown>;
    let changed = false;

    for (const field of CLASS_FIELDS) {
      const next = values[field];
      if (next === undefined || next === target[field]) continue;

      changes.before[field] = target[field];
      changes.after[field] = next;
      changes.fields.push(field);
      target[field] = next;
      changed = true;
    }

    return changed;
  }

  /**
   * 409 when another class of the edition already has the code, ignoring case and archived classes
   * included. `exceptId` is the edited class, so it does not clash with itself.
   */
  private async assertCodeAvailable(
    manager: EntityManager,
    editionId: string,
    code: string,
    exceptId?: string,
  ): Promise<void> {
    const query = manager
      .createQueryBuilder(SchoolClass, "schoolClass")
      .where("schoolClass.editionId = :editionId", { editionId })
      .andWhere("LOWER(schoolClass.code) = LOWER(:code)", { code });
    if (exceptId !== undefined) query.andWhere("schoolClass.id <> :exceptId", { exceptId });

    if (await query.getExists()) throw classCodeTaken();
  }

  /** Turns the violations of the constraints of `classes` into their business error. */
  private mapConstraintError(error: unknown): unknown {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { code?: string; constraint?: string } | undefined;

      if (driverError?.code === "23505" && driverError.constraint === CLASS_CODE_INDEX) {
        return classCodeTaken();
      }
      if (driverError?.code === "23503" && driverError.constraint === CLASS_COURSE_FOREIGN_KEY) {
        return courseNotFound();
      }
      if (driverError?.code === "23514" && driverError.constraint === CLASS_PERIOD_CHECK) {
        return invalidPeriod();
      }
    }
    return error;
  }

  private emit(
    action: AuditableAction,
    actorId: string,
    targetId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): void {
    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = action;
    event.targetType = CLASS_TARGET_TYPE;
    event.targetId = targetId;
    event.before = before;
    event.after = after;
    event.occurredAt = this.clock.now();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);
  }
}
