import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import { CoursesService } from "@modules/catalog/services/courses.service";
import { StudentsService, StudentSummary } from "@modules/people/services/students.service";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Clock } from "@shared/dates/clock";
import { isArchived } from "@shared/entities/archivable.columns";
import { AUDITABLE_ACTION_EVENT, AuditableAction } from "@shared/events/auditable-action.event";
import { EnrollStudentsDto } from "../dto/enroll-students.dto";
import { EnrollStudentsResponseDto } from "../dto/enroll-students.response.dto";
import { EnrollmentSkippedResponseDto } from "../dto/enrollment-skipped.response.dto";
import { EnrollmentResponseDto } from "../dto/enrollment.response.dto";
import { UpdateEnrollmentStatusDto } from "../dto/update-enrollment-status.dto";
import { SchoolClass } from "../entities/class.entity";
import { Enrollment } from "../entities/enrollment.entity";
import { ClassStatus } from "../enums/class-status.enum";
import { EnrollmentSkipReason } from "../enums/enrollment-skip-reason.enum";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import { classArchived, classNotFound } from "./classes.service";
import { buildEnrollmentAuditEvent } from "./enrollment-audit";
import { EnrollmentCountsService } from "./enrollment-counts.service";
import {
  alreadyEnrolled,
  classClosed,
  classFull,
  duplicateStudent,
  effectiveDateBeforeEnrollment,
  effectiveDateInFuture,
  enrollmentNotFound,
  enrollmentNotRemovable,
  studentArchived,
  studentNotFoundInBody,
} from "./enrollment-errors";
import {
  StudentCourseCompletion,
  EnrollmentWarning,
  missingPrerequisites,
} from "./enrollment-prerequisites";
import { toEnrollmentResponse } from "./enrollment-response.mapper";

/** The statuses of a class that take no enrollment and no reactivation (409 CLASS_CLOSED). */
const CLOSED_STATUSES: ReadonlySet<ClassStatus> = new Set([
  ClassStatus.COMPLETED,
  ClassStatus.CANCELLED,
]);

/** The partial unique index on (class_id, student_id) among live enrollments, by the migration. */
const ENROLLMENT_PAIR_INDEX = "uq_enrollments_class_id_student_id";
const STATUS_CHANGED_AT_CHECK = "ck_enrollments_status_changed_at";

/** A live enrollment of a class, as the batch reads it to skip who is already there. */
interface LiveEnrollmentRow {
  id: string;
  studentId: string;
  status: EnrollmentStatus;
}

/** The SQLSTATE and the constraint of a violation that the database reported. */
interface ConstraintViolation {
  code: string;
  constraint: string;
}

/**
 * The code and the constraint of a violation, when the error is a `QueryFailedError` whose driver
 * error names both (as `pg` does for 23505 and 23514); null for anything else. Narrowed by checks,
 * not by a cast: the driver error is `any` in TypeORM. The same guard as `violatedConstraint` of
 * `assignments`, which this module cannot import.
 */
function violatedConstraint(error: unknown): ConstraintViolation | null {
  if (!(error instanceof QueryFailedError)) return null;

  const driverError: unknown = error.driverError;
  if (
    typeof driverError !== "object" ||
    driverError === null ||
    !("code" in driverError) ||
    !("constraint" in driverError)
  ) {
    return null;
  }

  const { code, constraint } = driverError;
  if (typeof code !== "string" || typeof constraint !== "string") return null;

  return { code, constraint };
}

/** The status of an enrollment before a change: what the event and `changedFields` compare. */
interface StatusBefore {
  status: EnrollmentStatus;
  statusChangedAt: string;
  statusReason: string | null;
}

/**
 * The students of the body that already have a live enrollment in the class, in the order of the
 * body, with that enrollment and its status (`skipped`, M6).
 */
function skippedOf(
  ids: readonly string[],
  liveByStudent: ReadonlyMap<string, LiveEnrollmentRow>,
): EnrollmentSkippedResponseDto[] {
  return ids.flatMap((studentId) => {
    const row = liveByStudent.get(studentId);
    return row === undefined
      ? []
      : [
          {
            studentId,
            reason: EnrollmentSkipReason.ALREADY_ENROLLED,
            enrollmentId: row.id,
            status: row.status,
          },
        ];
  });
}

/** The ids of the body at the positions where `predicate` holds, as `studentIds.<i>`. */
function bodyFields(ids: readonly string[], predicate: (id: string) => boolean): string[] {
  return ids.flatMap((id, index) => (predicate(id) ? [`studentIds.${String(index)}`] : []));
}

/** The positions of the repeated ids of the body (the second occurrence on), as `studentIds.<i>`. */
function repeatedFields(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return ids.flatMap((id, index) => {
    if (seen.has(id)) return [`studentIds.${String(index)}`];
    seen.add(id);
    return [];
  });
}

/**
 * The writes of the enrollments (GUS-108, docs/ARCHITECTURE.md section 19): enroll a batch of
 * students in a class (RF-026), change the status of an enrollment (RF-027) and remove one made by
 * mistake. Every write locks the row of the class FOR UPDATE first, the same lock the edit and the
 * archive of the class take (`ClassesService.loadClass`), so the seats, the status of the class and
 * its archive never change under a check. The global order of the locks is class, then student
 * profiles (FOR SHARE, by person id), then enrollments; whoever locks more than one of them asks in
 * that order (section 19, M2).
 *
 * Events go out after the commit, one per enrollment that changed, with ids, statuses and dates
 * only: never the reason of a change nor personal data of the student (RNF-13). No log.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly students: StudentsService,
    private readonly courses: CoursesService,
    private readonly counts: EnrollmentCountsService,
  ) {}

  /**
   * Enrolls the students of the body in the class, all or none of the errors (section 19, M6).
   *
   * Errors, in order: 400 DUPLICATE_STUDENT (before the transaction); 404 CLASS_NOT_FOUND; 409
   * CLASS_ARCHIVED; 409 CLASS_CLOSED; 400 STUDENT_NOT_FOUND; 409 STUDENT_ARCHIVED (only among the
   * ones that would be enrolled); 409 CLASS_FULL (only the new ones count, against the seats left).
   * A student who already has an enrollment in the class that is not removed, in any status, is
   * skipped (`skipped`), not refused, even when she is archived. A prerequisite
   * of the course that a student did not complete is a warning (`warnings`, RF-032).
   *
   * Every enrollment made now has `enrolledAt`, `createdAt` and `updatedAt` = one instant of the
   * clock, status active, `statusChangedAt` = that day in America/Sao_Paulo, and the actor as author.
   * Emits ENROLLMENT_CREATED per enrollment after the commit.
   */
  async enroll(
    requestedClassId: string,
    dto: EnrollStudentsDto,
    actorId: string,
  ): Promise<EnrollStudentsResponseDto> {
    const ids = dto.studentIds.map((id) => id.toLowerCase());
    const repeated = repeatedFields(ids);
    if (repeated.length > 0) throw duplicateStudent(repeated);

    const now = this.clock.now();

    const result = await this.runInTransaction(async (manager) => {
      const schoolClass = await this.lockClass(manager, requestedClassId);
      if (isArchived(schoolClass.archive)) throw classArchived();
      if (CLOSED_STATUSES.has(schoolClass.status)) throw classClosed();

      const students = await this.students.findStudentSummaries(ids, manager, { forShare: true });
      const studentsById = new Map(students.map((student) => [student.id, student]));
      const notFound = bodyFields(ids, (id) => !studentsById.has(id));
      if (notFound.length > 0) throw studentNotFoundInBody(notFound);

      const live = await this.findLiveEnrollments(manager, schoolClass.id, ids);
      const liveByStudent = new Map(live.map((row) => [row.studentId, row]));
      // Only who would be enrolled now is refused for being archived: a student who already has an
      // enrollment in the class is skipped, archived or not (M6).
      const archived = bodyFields(
        ids,
        (id) => !liveByStudent.has(id) && (studentsById.get(id)?.archivedAt ?? null) !== null,
      );
      if (archived.length > 0) throw studentArchived(archived);
      const skipped = skippedOf(ids, liveByStudent);
      const toEnroll = ids.filter((id) => !liveByStudent.has(id));
      if (toEnroll.length === 0) {
        return { enrolled: [], skipped, warnings: [], studentsById };
      }

      const active = await this.counts.countActive(manager, schoolClass.id);
      const remaining = Math.max(0, schoolClass.capacity - active);
      if (toEnroll.length > remaining) throw classFull(remaining, toEnroll.length, "studentIds");

      const warnings = await this.prerequisiteWarnings(manager, schoolClass.courseId, toEnroll);
      const enrolled = await this.createEnrollments(
        manager,
        schoolClass.id,
        toEnroll,
        actorId,
        now,
      );
      return { enrolled, skipped, warnings, studentsById };
    });

    this.emitCreated(result.enrolled, result.warnings, actorId, now);

    return {
      enrolled: result.enrolled.map((enrollment) =>
        toEnrollmentResponse(enrollment, this.studentOf(result.studentsById, enrollment)),
      ),
      skipped: result.skipped,
      warnings: result.warnings,
    };
  }

  /**
   * Changes the status of an enrollment (RF-027): any status goes to any other one, from
   * `effectiveDate` (the day of the enrollment to today, America/Sao_Paulo) with an optional reason
   * that replaces the one before. The same status is a no-op: 200, nothing written, no event, the
   * date and the reason ignored (the first date holds).
   *
   * Going to active (a reactivation) takes a seat, so it needs an open class (409 CLASS_CLOSED), a
   * student who is not archived (409 STUDENT_ARCHIVED) and a seat (409 CLASS_FULL on `status`).
   * Leaving active needs nothing more, also in a completed or cancelled class: that is how a class
   * is closed out. An archived class is read-only (409 CLASS_ARCHIVED).
   *
   * Errors, in order: 400 EFFECTIVE_DATE_IN_FUTURE (before the transaction); 404
   * ENROLLMENT_NOT_FOUND; the no-op; 409 CLASS_ARCHIVED; 400 EFFECTIVE_DATE_BEFORE_ENROLLMENT; and,
   * to active, CLASS_CLOSED, STUDENT_ARCHIVED and CLASS_FULL.
   *
   * Locks: the class FOR UPDATE; the student profile FOR SHARE only to active (so an archive of the
   * student and a reactivation serialize); then the enrollment FOR UPDATE. The class and the student
   * are read from an unlocked peek of the enrollment: both never change on an enrollment.
   * Emits ENROLLMENT_STATUS_CHANGED after the commit, only when something changed.
   */
  async updateStatus(
    requestedId: string,
    dto: UpdateEnrollmentStatusDto,
    actorId: string,
  ): Promise<EnrollmentResponseDto> {
    const now = this.clock.now();
    if (dto.effectiveDate > todayInAppTimeZone(now)) throw effectiveDateInFuture();

    const result = await this.runInTransaction(async (manager) => {
      const peek = await manager.findOne(Enrollment, { where: { id: requestedId } });
      if (peek === null) throw enrollmentNotFound();

      const schoolClass = await this.lockClass(manager, peek.classId);
      const toActive = dto.status === EnrollmentStatus.ACTIVE;
      const [student] = await this.students.findStudentSummaries([peek.studentId], manager, {
        forShare: toActive,
      });
      if (student === undefined) {
        // The foreign key keeps the person, and no route removes a person or a student profile.
        throw new Error(`The student ${peek.studentId} of the enrollment ${peek.id} is gone.`);
      }

      const enrollment = await manager.findOne(Enrollment, {
        where: { id: peek.id },
        lock: { mode: "pessimistic_write" },
      });
      if (enrollment === null) throw enrollmentNotFound();
      if (enrollment.status === dto.status) return { enrollment, student, before: null };

      if (isArchived(schoolClass.archive)) throw classArchived();
      if (dto.effectiveDate < todayInAppTimeZone(enrollment.enrolledAt)) {
        throw effectiveDateBeforeEnrollment();
      }
      if (toActive) await this.assertCanReactivate(manager, schoolClass, student);

      const before = await this.writeStatusChange(manager, enrollment, dto, now);
      return { enrollment, student, before };
    });

    if (result.before !== null) {
      this.emitStatusChanged(result.enrollment, result.before, actorId, now);
    }

    return toEnrollmentResponse(result.enrollment, result.student);
  }

  /**
   * Removes an enrollment made by mistake (the "Remover" of the screen of enrollment): a soft delete,
   * `deletedAt` and `updatedAt` = one instant of the clock. Only an active one: dropped and
   * completed are history (RN-16) and answer 409 ENROLLMENT_NOT_REMOVABLE. Removing frees the pair
   * (class, student), so the student can be enrolled again; removing again is 404.
   *
   * Errors, in order: 404 ENROLLMENT_NOT_FOUND; 409 CLASS_ARCHIVED; 409 ENROLLMENT_NOT_REMOVABLE.
   * Locks: the class FOR UPDATE, then the enrollment FOR UPDATE. The roll call of the students
   * (GUS-166) adds "has attendance" to the same 409, asked after the lock of the enrollment and
   * before the update (section 19, hooks for GUS-166).
   * Emits ENROLLMENT_REMOVED after the commit.
   */
  async remove(requestedId: string, actorId: string): Promise<void> {
    const now = this.clock.now();

    const removed = await this.runInTransaction(async (manager) => {
      const peek = await manager.findOne(Enrollment, { where: { id: requestedId } });
      if (peek === null) throw enrollmentNotFound();

      const schoolClass = await this.lockClass(manager, peek.classId);
      const enrollment = await manager.findOne(Enrollment, {
        where: { id: peek.id },
        lock: { mode: "pessimistic_write" },
      });
      if (enrollment === null) throw enrollmentNotFound();
      if (isArchived(schoolClass.archive)) throw classArchived();
      if (enrollment.status !== EnrollmentStatus.ACTIVE) throw enrollmentNotRemovable();

      await manager.update(Enrollment, { id: enrollment.id }, { deletedAt: now, updatedAt: now });
      return enrollment;
    });

    this.eventEmitter.emit(
      AUDITABLE_ACTION_EVENT,
      buildEnrollmentAuditEvent(
        AuditableAction.ENROLLMENT_REMOVED,
        actorId,
        removed.id,
        { classId: removed.classId, studentId: removed.studentId, status: removed.status },
        { deletedAt: now },
        now,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Writes the new enrollments, active, with `enrolledAt`, `createdAt` and `updatedAt` = `now` and
   * `statusChangedAt` = that day in America/Sao_Paulo. In the order of the body: the ids (UUID v7 of
   * @BeforeInsert) come out ascending, so the preview of the class (enrolledAt, then id) keeps that
   * order too.
   */
  private createEnrollments(
    manager: EntityManager,
    classId: string,
    studentIds: readonly string[],
    actorId: string,
    now: Date,
  ): Promise<Enrollment[]> {
    const today = todayInAppTimeZone(now);
    return manager.save(
      studentIds.map((studentId) =>
        manager.create(Enrollment, {
          classId,
          studentId,
          status: EnrollmentStatus.ACTIVE,
          enrolledAt: now,
          statusChangedAt: today,
          statusReason: null,
          createdById: actorId,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    );
  }

  /** One ENROLLMENT_CREATED per enrollment made, after the commit, with its missing prerequisites. */
  private emitCreated(
    enrolled: readonly Enrollment[],
    warnings: readonly EnrollmentWarning[],
    actorId: string,
    now: Date,
  ): void {
    for (const enrollment of enrolled) {
      this.eventEmitter.emit(
        AUDITABLE_ACTION_EVENT,
        buildEnrollmentAuditEvent(
          AuditableAction.ENROLLMENT_CREATED,
          actorId,
          enrollment.id,
          null,
          {
            classId: enrollment.classId,
            studentId: enrollment.studentId,
            status: enrollment.status,
            enrolledAt: enrollment.enrolledAt,
            statusChangedAt: enrollment.statusChangedAt,
            missingPrerequisiteIds: warnings
              .filter((warning) => warning.studentId === enrollment.studentId)
              .map((warning) => warning.courseId),
          },
          now,
        ),
      );
    }
  }

  /**
   * Going back to active takes a seat: the class must be open (409 CLASS_CLOSED), the student not
   * archived (409 STUDENT_ARCHIVED) and a seat left (409 CLASS_FULL on `status`), in this order.
   * Runs under the lock of the class, with the profile read FOR SHARE.
   */
  private async assertCanReactivate(
    manager: EntityManager,
    schoolClass: SchoolClass,
    student: StudentSummary,
  ): Promise<void> {
    if (CLOSED_STATUSES.has(schoolClass.status)) throw classClosed();
    if (student.archivedAt !== null) throw studentArchived();
    const active = await this.counts.countActive(manager, schoolClass.id);
    if (active + 1 > schoolClass.capacity) {
      throw classFull(Math.max(0, schoolClass.capacity - active), 1, "status");
    }
  }

  /**
   * Writes the new status from `effectiveDate`, with the reason of the body (none clears the one
   * before), and answers the status it had. `updatedAt` is the instant of the clock, not the
   * CURRENT_TIMESTAMP of the table.
   */
  private async writeStatusChange(
    manager: EntityManager,
    enrollment: Enrollment,
    dto: UpdateEnrollmentStatusDto,
    now: Date,
  ): Promise<StatusBefore> {
    const before = {
      status: enrollment.status,
      statusChangedAt: enrollment.statusChangedAt,
      statusReason: enrollment.statusReason,
    };
    enrollment.status = dto.status;
    enrollment.statusChangedAt = dto.effectiveDate;
    enrollment.statusReason = dto.reason ?? null;
    enrollment.updatedAt = now;
    await manager.save(enrollment);
    return before;
  }

  /**
   * ENROLLMENT_STATUS_CHANGED after the commit: status and statusChangedAt before and after, and
   * `changedFields`, which names the reason when it changed, never its value (RNF-13).
   */
  private emitStatusChanged(
    enrollment: Enrollment,
    before: StatusBefore,
    actorId: string,
    now: Date,
  ): void {
    const changedFields = [
      "status",
      ...(before.statusChangedAt !== enrollment.statusChangedAt ? ["statusChangedAt"] : []),
      ...(before.statusReason !== enrollment.statusReason ? ["statusReason"] : []),
    ];
    this.eventEmitter.emit(
      AUDITABLE_ACTION_EVENT,
      buildEnrollmentAuditEvent(
        AuditableAction.ENROLLMENT_STATUS_CHANGED,
        actorId,
        enrollment.id,
        { status: before.status, statusChangedAt: before.statusChangedAt },
        { status: enrollment.status, statusChangedAt: enrollment.statusChangedAt, changedFields },
        now,
      ),
    );
  }

  /**
   * Runs the work in a transaction and turns the constraint violations that mean a business error
   * into it: a second live enrollment of the pair (409 ALREADY_ENROLLED; the lock of the class
   * normally prevents it) and a status that would hold before the day of the enrollment (400
   * EFFECTIVE_DATE_BEFORE_ENROLLMENT; the check before the write normally answers it). Any other
   * error goes on as it is.
   */
  private async runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      throw this.mapConstraintError(error);
    }
  }

  private mapConstraintError(error: unknown): unknown {
    const violation = violatedConstraint(error);

    if (violation?.code === "23505" && violation.constraint === ENROLLMENT_PAIR_INDEX) {
      return alreadyEnrolled();
    }
    if (violation?.code === "23514" && violation.constraint === STATUS_CHANGED_AT_CHECK) {
      return effectiveDateBeforeEnrollment();
    }
    return error;
  }

  /** The class, locked FOR UPDATE until the end of the transaction (404 when it is not there). */
  private async lockClass(manager: EntityManager, id: string): Promise<SchoolClass> {
    const schoolClass = await manager.findOne(SchoolClass, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (schoolClass === null) throw classNotFound();

    return schoolClass;
  }

  /**
   * The enrollments of the class that are not removed, in any status, of the students asked. No
   * lock: it runs under the lock of the class, which every write of its enrollments takes first.
   */
  private findLiveEnrollments(
    manager: EntityManager,
    classId: string,
    studentIds: readonly string[],
  ): Promise<LiveEnrollmentRow[]> {
    return manager.query(
      `SELECT id AS "id", student_id AS "studentId", status AS "status"
         FROM enrollments
        WHERE class_id = $1 AND student_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [classId, [...studentIds]],
    );
  }

  /**
   * The warnings of the prerequisites of the course for the students about to be enrolled. A course
   * without prerequisites answers [] without reading any completion. The reads take no lock.
   */
  private async prerequisiteWarnings(
    manager: EntityManager,
    courseId: string,
    studentIds: readonly string[],
  ): Promise<EnrollmentWarning[]> {
    const prerequisites = await this.courses.findPrerequisiteRefs(courseId, manager);
    if (prerequisites.length === 0) return [];

    const completions = await this.findCompletions(
      manager,
      studentIds,
      prerequisites.map((course) => course.id),
    );
    return missingPrerequisites(studentIds, prerequisites, completions);
  }

  /**
   * Which of the students completed which of the courses: a completed enrollment, not removed, in a
   * class of the course (an archived class included).
   */
  private findCompletions(
    manager: EntityManager,
    studentIds: readonly string[],
    courseIds: readonly string[],
  ): Promise<StudentCourseCompletion[]> {
    return manager.query(
      `SELECT DISTINCT e.student_id AS "studentId", c.course_id AS "courseId"
         FROM enrollments e
         JOIN classes c ON c.id = e.class_id
        WHERE e.student_id = ANY($1::uuid[])
          AND c.course_id = ANY($2::uuid[])
          AND e.status = $3
          AND e.deleted_at IS NULL`,
      [[...studentIds], [...courseIds], EnrollmentStatus.COMPLETED],
    );
  }

  /** The student of an enrollment made now: read in the same transaction, so it is there. */
  private studentOf(
    studentsById: ReadonlyMap<string, StudentSummary>,
    enrollment: Enrollment,
  ): StudentSummary {
    const student = studentsById.get(enrollment.studentId);
    if (student === undefined) {
      throw new Error(`The student ${enrollment.studentId} of a new enrollment was not read.`);
    }
    return student;
  }
}
