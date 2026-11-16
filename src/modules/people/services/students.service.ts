import { HttpException, Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { isUUID } from "class-validator";
import { DataSource, EntityManager, In, IsNull, QueryFailedError } from "typeorm";
import { ArchiveDto } from "@shared/dto/archive.dto";
import { Clock } from "@shared/dates/clock";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { isArchived, markArchived, markUnarchived } from "@shared/entities/archivable.columns";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import {
  normalizePagination,
  PaginatedResult,
  PaginationParams,
} from "@shared/pagination/pagination.util";
import { applyTextSearch } from "@shared/search/search.util";
import { CreateStudentDto } from "../dto/create-student.dto";
import { StudentDetailDto } from "../dto/student-detail.response.dto";
import { StudentResponseDto } from "../dto/student.response.dto";
import { UpdateStudentDto } from "../dto/update-student.dto";
import { Person } from "../entities/person.entity";
import { StudentProfile } from "../entities/student-profile.entity";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";
import { auditSnapshot } from "./student-audit";
import { toStudentDetail } from "./student-detail.mapper";
import { StudentEnrollmentsRegistry } from "./student-enrollments.registry";
import { StudentRefRow, toStudentRef, toStudentResponse } from "./student-response.mapper";

/** Fields of the student that live on Person. */
const PERSON_FIELDS = ["name", "birthDate", "email", "phone"] as const;

/** Fields of the student that live on StudentProfile. */
const PROFILE_FIELDS = [
  "education",
  "hasSmartphone",
  "hasComputer",
  "howFoundUs",
  "emergencyContactName",
  "emergencyContactPhone",
  "accessibilityNeed",
  "supportResource",
  "classNeeds",
] as const;

const STUDENT_TARGET_TYPE = "student";

/**
 * The one place that builds the "student not found" error: an unknown id, a malformed id and a
 * person without a student profile all answer the same 404 STUDENT_NOT_FOUND. Used by this
 * service, by the id pipe of the controller and by the read route of GUS-107.
 */
export function studentNotFound(): HttpException {
  return new HttpException({ error: "STUDENT_NOT_FOUND", message: "Student not found." }, 404);
}

/** 409: a student with an active enrollment stays a student (section 10.3, GUS-108). */
export function studentHasActiveEnrollments(): HttpException {
  return new HttpException(
    {
      error: "STUDENT_HAS_ACTIVE_ENROLLMENTS",
      message: "A student with active enrollments cannot be archived.",
    },
    409,
  );
}

/**
 * The most ids `listStudentRefs` takes in `onlyIds` or in `excludeIds`. They are the students of
 * the enrollments of a class or of the active enrollments of the school (hundreds today): more
 * than this is a bug or a school far beyond its size, and it fails loudly instead of truncating.
 */
export const STUDENT_REF_FILTER_MAX_IDS = 10_000;

/**
 * What another module needs to know about a student to enroll it (classes, GUS-108): who it is and
 * whether it is archived. Nothing personal beyond the name.
 */
export interface StudentSummary {
  id: string;
  name: string;
  archivedAt: Date | null;
}

/**
 * One student of a list of students, for another module (classes, GUS-108): the item of the list
 * of students that GUS-106 reuses (`StudentListItemResponseDto` has this shape).
 */
export interface StudentRef {
  id: string;
  name: string;
  age: number;
  phone: string | null;
  accessibilityNeed: AccessibilityNeed;
}

/** Which students `listStudentRefs` lists. Every field narrows the list; none is required. */
export interface StudentRefFilter {
  /** Only these students. Empty answers an empty page. */
  onlyIds?: readonly string[];
  /** Every student but these. */
  excludeIds?: readonly string[];
  /** Part of the name, ignoring case and accents (section 12). */
  search?: string;
  /** Archived students are left out unless this is true (an enrollment history keeps them). */
  includeArchived?: boolean;
}

/** Values changed by an update. Raw values stay local: events only get the allow-listed ones. */
interface FieldChanges {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  fields: string[];
}

/**
 * Registration and archiving of students (RF-001, RF-003, RN-27).
 *
 * The student id is the id of the Person (RN-09): a profile is only extra data of a Person,
 * so the same Person can be student and member. Phone, e-mail, emergency contact and the
 * accessibility fields are personal data (RNF-13): this service has no Logger and never
 * puts their values in an AuditableActionEvent (see student-audit.ts).
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly enrollments: StudentEnrollmentsRegistry,
  ) {}

  /**
   * Registers a student: Person and StudentProfile in one transaction.
   * Emits STUDENT_CREATED after the commit.
   */
  async create(dto: CreateStudentDto, actorId: string): Promise<StudentResponseDto> {
    let created: { person: Person; profile: StudentProfile };

    try {
      created = await this.dataSource.transaction(async (manager) => {
        const person = await manager.save(
          manager.create(Person, {
            name: dto.name,
            birthDate: dto.birthDate,
            email: dto.email ?? null,
            phone: dto.phone ?? null,
          }),
        );

        const profile = await manager.save(
          manager.create(StudentProfile, {
            personId: person.id,
            education: dto.education ?? null,
            hasSmartphone: dto.hasSmartphone ?? null,
            hasComputer: dto.hasComputer ?? null,
            howFoundUs: dto.howFoundUs ?? null,
            emergencyContactName: dto.emergencyContactName ?? null,
            emergencyContactPhone: dto.emergencyContactPhone ?? null,
            accessibilityNeed: dto.accessibilityNeed ?? AccessibilityNeed.NONE,
            supportResource: dto.supportResource ?? null,
            classNeeds: dto.classNeeds ?? null,
            createdById: actorId,
          }),
        );

        return { person, profile };
      });
    } catch (error) {
      throw this.mapEmailConflict(error);
    }

    const { person, profile } = created;

    this.emit(
      AuditableAction.STUDENT_CREATED,
      actorId,
      person.id,
      null,
      auditSnapshot({ ...person, ...profile }),
    );

    return toStudentResponse(person, profile, todayInAppTimeZone(this.clock.now()));
  }

  /**
   * Edits a student. Omitted fields stay as they are, null clears optional ones.
   * An archived student is read-only (409 STUDENT_ARCHIVED).
   * Emits STUDENT_UPDATED after the commit, only when something changed.
   */
  async update(id: string, dto: UpdateStudentDto, actorId: string): Promise<StudentResponseDto> {
    const changes: FieldChanges = { before: {}, after: {}, fields: [] };
    let updated: { person: Person; profile: StudentProfile };

    try {
      updated = await this.dataSource.transaction(async (manager) => {
        let { person, profile } = await this.loadStudent(manager, id);

        if (isArchived(profile.archive)) {
          throw new HttpException(
            { error: "STUDENT_ARCHIVED", message: "Archived students are read-only." },
            409,
          );
        }

        const values = dto as Record<string, unknown>;
        const personChanged = this.applyChanges(person, values, PERSON_FIELDS, changes);
        const profileChanged = this.applyChanges(profile, values, PROFILE_FIELDS, changes);

        if (personChanged) person = await manager.save(person);
        if (profileChanged) profile = await manager.save(profile);

        return { person, profile };
      });
    } catch (error) {
      throw this.mapEmailConflict(error);
    }

    if (changes.fields.length > 0) {
      this.emit(
        AuditableAction.STUDENT_UPDATED,
        actorId,
        id,
        auditSnapshot(changes.before),
        // changedFields lists every changed field by name, sensitive ones included, without values.
        { ...auditSnapshot(changes.after), changedFields: changes.fields },
      );
    }

    return toStudentResponse(updated.person, updated.profile, todayInAppTimeZone(this.clock.now()));
  }

  /**
   * Archives a student instead of deleting (RN-27). Archiving twice keeps the first archive,
   * answers 200 and emits nothing, and does not even ask the enrollments.
   * Emits STUDENT_ARCHIVED after the commit.
   *
   * A student with an active enrollment answers 409 STUDENT_HAS_ACTIVE_ENROLLMENTS, after the 404
   * (section 19, M1). The count comes from the port `StudentEnrollmentsRegistry`, which `classes`
   * implements, inside this transaction and AFTER the profile is locked FOR UPDATE: an enrollment
   * reads the profile FOR SHARE, so the two serialize, and the count, a new statement, sees an
   * enrollment that committed while the archive waited.
   */
  async archive(
    id: string,
    dto: ArchiveDto | undefined,
    actorId: string,
  ): Promise<StudentResponseDto> {
    const now = this.clock.now();

    const result = await this.dataSource.transaction(async (manager) => {
      const { person, profile } = await this.loadStudent(manager, id);

      let changed = false;
      if (!isArchived(profile.archive)) {
        const active = await this.enrollments.countActiveEnrollments(manager, profile.personId);
        if (active > 0) throw studentHasActiveEnrollments();

        changed = markArchived(profile.archive, actorId, dto?.reason ?? null, now);
        await manager.save(profile);
      }

      return { person, profile, changed };
    });

    if (result.changed) {
      this.emit(
        AuditableAction.STUDENT_ARCHIVED,
        actorId,
        id,
        { archivedAt: null },
        {
          archivedAt: result.profile.archive.archivedAt,
          archiveReason: result.profile.archive.archiveReason,
        },
      );
    }

    return toStudentResponse(result.person, result.profile, todayInAppTimeZone(now));
  }

  /**
   * Reactivates an archived student, clearing the archive columns (the history stays in the
   * event). A student that is not archived answers 200 and emits nothing.
   * Emits STUDENT_UNARCHIVED after the commit.
   */
  async unarchive(id: string, actorId: string): Promise<StudentResponseDto> {
    const now = this.clock.now();

    const result = await this.dataSource.transaction(async (manager) => {
      const { person, profile } = await this.loadStudent(manager, id);

      const before = {
        archivedAt: profile.archive.archivedAt,
        archivedById: profile.archive.archivedById,
        archiveReason: profile.archive.archiveReason,
      };
      const changed = markUnarchived(profile.archive);
      if (changed) await manager.save(profile);

      return { person, profile, before, changed };
    });

    if (result.changed) {
      this.emit(AuditableAction.STUDENT_UNARCHIVED, actorId, id, result.before, {
        archivedAt: null,
      });
    }

    return toStudentResponse(result.person, result.profile, todayInAppTimeZone(now));
  }

  /**
   * Batch lookup by Person id, for other modules (classes, GUS-108).
   * Unknown ids and ids that are not uuids are ignored (no error) and the order is not
   * guaranteed: callers index by `id`.
   * Archived students are included unless `excludeArchived` is true: enrollment history
   * must still resolve them, while the list of available students must not offer them.
   */
  async findByIds(
    ids: readonly string[],
    options: { excludeArchived?: boolean } = {},
  ): Promise<StudentResponseDto[]> {
    // A value that is not a uuid cannot be a student; sending it to Postgres would fail (22P02).
    const unique = [...new Set(ids)].filter((id) => isUUID(id));
    if (unique.length === 0) return [];

    const profiles = await this.dataSource.getRepository(StudentProfile).find({
      where: {
        personId: In(unique),
        ...(options.excludeArchived ? { archive: { archivedAt: IsNull() } } : {}),
      },
    });
    if (profiles.length === 0) return [];

    const people = await this.dataSource.getRepository(Person).find({
      where: { id: In(profiles.map((profile) => profile.personId)) },
    });
    const peopleById = new Map(people.map((person) => [person.id, person]));

    const today = todayInAppTimeZone(this.clock.now());
    return profiles.flatMap((profile) => {
      const person = peopleById.get(profile.personId);
      return person ? [toStudentResponse(person, profile, today)] : [];
    });
  }

  /**
   * Id, name and archive date of the students among `ids`, for another module (classes, GUS-108:
   * the students of an enrollment). Ids are lower-cased and deduped; an id that is not a uuid, a
   * person without a student profile, and a removed person or profile are left out. The order is
   * the person id, ascending. It writes nothing and emits nothing.
   *
   * `forShare` locks the student profiles `FOR SHARE` until the end of the transaction of the
   * `manager` (so it needs one: without it this throws, as a bug of the caller), in person id
   * order. The lock is on the PROFILE and not on `people`: `archive`, `update` and `unarchive` lock
   * the profile `FOR UPDATE` and read the person without a lock, so only a lock on the profile
   * conflicts with them (section 19, M2). An enrollment then never lands on a student that is being
   * archived: whoever locks first wins, and the other one sees what it committed.
   *
   * There is no cap here: the ids come from a body of at most 100 ids or from one enrollment.
   */
  async findStudentSummaries(
    ids: readonly string[],
    manager?: EntityManager,
    options: { forShare?: boolean } = {},
  ): Promise<StudentSummary[]> {
    if (options.forShare === true && manager === undefined) {
      throw new Error("forShare needs the manager of a transaction");
    }
    // A value that is not a uuid cannot be a student; sending it to Postgres would fail (22P02).
    const unique = [...new Set(ids.filter((id) => isUUID(id)).map((id) => id.toLowerCase()))];
    if (unique.length === 0) return [];

    const reader = manager ?? this.dataSource.manager;
    const profiles = await reader.find(StudentProfile, {
      where: { personId: In(unique) },
      order: { personId: "ASC" },
      lock: options.forShare === true ? { mode: "pessimistic_read" } : undefined,
    });
    if (profiles.length === 0) return [];

    const people = await reader.find(Person, {
      where: { id: In(profiles.map((profile) => profile.personId)) },
      select: { id: true, name: true },
    });
    const namesById = new Map(people.map((person) => [person.id, person.name]));

    return profiles.flatMap((profile) => {
      const name = namesById.get(profile.personId);
      return name === undefined
        ? []
        : [{ id: profile.personId, name, archivedAt: profile.archive.archivedAt }];
    });
  }

  /**
   * A page of students for another module (classes, GUS-108: the lists of the enrollments), so it
   * never reads the tables of `people`. Ordered by name and then person id, with the total of the
   * filter counted in SQL. A student is a person (not removed) with a student profile (not
   * removed); the archived ones are left out unless `includeArchived`.
   *
   * The ids go to Postgres as ONE array parameter (`= ANY(:ids::uuid[])`), never one parameter per
   * id. Ids that are not uuids are skipped; an empty `onlyIds` answers an empty page without
   * querying. More than STUDENT_REF_FILTER_MAX_IDS ids throws (a 500 that is logged), instead of
   * truncating the filter. The age is computed against one day, today in America/Sao_Paulo.
   */
  async listStudentRefs(
    filter: StudentRefFilter,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<StudentRef>> {
    for (const ids of [filter.onlyIds, filter.excludeIds]) {
      if (ids !== undefined && ids.length > STUDENT_REF_FILTER_MAX_IDS) {
        throw new Error(
          `listStudentRefs takes at most ${STUDENT_REF_FILTER_MAX_IDS} ids, got ${ids.length}.`,
        );
      }
    }
    const onlyIds = filter.onlyIds?.filter((id) => isUUID(id));
    const excludeIds = filter.excludeIds?.filter((id) => isUUID(id)) ?? [];
    const { page, limit } = normalizePagination(pagination);
    if (onlyIds !== undefined && onlyIds.length === 0) return { data: [], total: 0, page, limit };

    const builder = this.dataSource
      .getRepository(Person)
      .createQueryBuilder("person")
      .innerJoin(
        StudentProfile,
        "student_profile",
        "student_profile.person_id = person.id AND student_profile.deleted_at IS NULL",
      )
      .select("person.id", "id")
      .addSelect("person.name", "name")
      .addSelect("person.birth_date::text", "birthDate")
      .addSelect("person.phone", "phone")
      .addSelect("student_profile.accessibility_need", "accessibilityNeed")
      .where("person.deleted_at IS NULL");

    if (filter.includeArchived !== true) builder.andWhere("student_profile.archived_at IS NULL");
    if (onlyIds !== undefined) builder.andWhere("person.id = ANY(:onlyIds::uuid[])", { onlyIds });
    if (excludeIds.length > 0) {
      builder.andWhere("NOT (person.id = ANY(:excludeIds::uuid[]))", { excludeIds });
    }
    applyTextSearch(builder, ["person.name"], filter.search, "studentRefSearch");
    builder.orderBy("person.name", "ASC").addOrderBy("person.id", "ASC");

    const [rows, total] = await Promise.all([
      builder
        .clone()
        .offset((page - 1) * limit)
        .limit(limit)
        .getRawMany<StudentRefRow>(),
      builder.clone().getCount(),
    ]);

    const today = todayInAppTimeZone(this.clock.now());
    return { data: rows.map((row) => toStudentRef(row, today)), total, page, limit };
  }

  /**
   * Student record page (GUS-107). Archived students stay readable (RN-27).
   * Read-only: no transaction, no lock, no audit event, no log (RNF-13).
   * createdBy is null when the Person who registered the student was soft-deleted:
   * TypeORM's default find skips soft-deleted rows, the same rule the AuthGuard and the
   * invites apply. A soft-deleted student is a 404.
   * An id that is not a uuid is a 404 without touching the database (the service is exported
   * and other modules call it; Postgres would reject the value with 22P02), same guard as
   * findByIds.
   */
  async findDetail(id: string): Promise<StudentDetailDto> {
    if (!isUUID(id)) throw studentNotFound();

    const profile = await this.dataSource
      .getRepository(StudentProfile)
      .findOne({ where: { personId: id } });
    if (profile === null) throw studentNotFound();

    // One query for the student and the creator.
    const people = await this.dataSource
      .getRepository(Person)
      .find({ where: { id: In([id, profile.createdById]) } });
    const person = people.find((candidate) => candidate.id === id);
    if (person === undefined) throw studentNotFound();
    const creator = people.find((candidate) => candidate.id === profile.createdById) ?? null;

    return toStudentDetail(person, profile, creator, todayInAppTimeZone(this.clock.now()));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Loads the student of a Person id inside a transaction, locking the profile row so
   * concurrent edits and archives of the same student run one at a time.
   * The lookup has no relations: Postgres rejects FOR UPDATE on the nullable side of a join.
   * 404 STUDENT_NOT_FOUND covers unknown ids and people that have no student profile.
   */
  private async loadStudent(
    manager: EntityManager,
    id: string,
  ): Promise<{ person: Person; profile: StudentProfile }> {
    const profile = await manager.findOne(StudentProfile, {
      where: { personId: id },
      lock: { mode: "pessimistic_write" },
    });
    const person = profile ? await manager.findOne(Person, { where: { id } }) : null;

    if (profile === null || person === null) {
      throw studentNotFound();
    }

    return { person, profile };
  }

  /**
   * Copies the fields present in `values` (not undefined) that differ from the entity,
   * recording old and new values. Returns true when something changed.
   */
  private applyChanges(
    entity: Person | StudentProfile,
    values: Readonly<Record<string, unknown>>,
    fields: readonly string[],
    changes: FieldChanges,
  ): boolean {
    const target = entity as unknown as Record<string, unknown>;
    let changed = false;

    for (const field of fields) {
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
   * Turns the unique violation of the e-mail into 409 EMAIL_ALREADY_IN_USE (same code the
   * invites use). Without this a duplicate e-mail would be a 500. Any other error is kept.
   */
  private mapEmailConflict(error: unknown): unknown {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { code?: string; constraint?: string } | undefined;
      if (driverError?.code === "23505" && driverError.constraint === "uq_people_email") {
        return new HttpException(
          { error: "EMAIL_ALREADY_IN_USE", message: "Email already in use." },
          409,
        );
      }
    }
    return error;
  }

  /** Emits on the audit channel. Called only after the transaction has committed. */
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
    event.targetType = STUDENT_TARGET_TYPE;
    event.targetId = targetId;
    event.before = before;
    event.after = after;
    event.occurredAt = this.clock.now();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);
  }
}

/**
 * The enum of `StudentRef.accessibilityNeed`, the contract of `listStudentRefs`, re-exported so that
 * other modules (classes) import it from the service PeopleModule exports and never from
 * `people/enums/*` (module is a closed box).
 */
export { AccessibilityNeed } from "../enums/accessibility-need.enum";
