import { Injectable, OnModuleInit } from "@nestjs/common";
import { EntityManager } from "typeorm";
import {
  StudentEnrollmentsReader,
  StudentEnrollmentsRegistry,
} from "@modules/people/services/student-enrollments.registry";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";

/** One active enrollment as the sheet of the class shows it. */
export interface ActiveEnrollmentPreviewRow {
  enrollmentId: string;
  studentId: string;
  enrolledAt: Date;
}

/**
 * What the module knows about the enrollments of a class or of a student: the ACTIVE ones (not
 * removed, status active) and, for the change of course, the LIVE ones (not removed, any status).
 * Its consumers:
 *
 * - ClassesService asks `countActive` before it archives a class (409
 *   CLASS_HAS_ACTIVE_ENROLLMENTS) and before it lowers the seats (409 CAPACITY_BELOW_ENROLLED), and
 *   `countLive` before it changes the course of a class (409 COURSE_CHANGE_NOT_ALLOWED, GUS-102).
 * - EnrollmentsService (GUS-108) asks `countActive` for the seats left before it enrolls or
 *   reactivates.
 * - CourseClassesService asks `countActiveByClass` for the whole page of the classes of a course,
 *   in one call, to fill `enrolledCount` without a query per class (GUS-102).
 * - ClassDetailService (GUS-104) uses `countActive` for `summary.enrolledCount` and
 *   `enrollmentsTotal`, and `listActivePreview` for `enrollmentsPreview`. The preview keeps a fixed
 *   order, `enrolledAt` ascending and then the id of the enrollment, and carries only ids: the
 *   names of the students are read by whoever calls, from `people`.
 * - `people` asks `countActiveEnrollments` through its port (`StudentEnrollmentsRegistry`, where
 *   this service registers itself when the module starts) before it archives a student (409
 *   STUDENT_HAS_ACTIVE_ENROLLMENTS, section 19, M1).
 *
 * Nothing here takes a lock: the lock is the caller's. Whoever counts to decide a write locks the
 * row of the class FOR UPDATE first (`ClassesService.loadClass`, `EnrollmentsService`), so an
 * enrollment and an archive (a cut of the seats, a change of course) never pass their checks at
 * once. The count of a student must not lock either (see the port): the archive of a student holds
 * the profile and an enrollment holds the class before the profile, so a lock here could make the
 * two wait for each other.
 */
@Injectable()
export class EnrollmentCountsService implements StudentEnrollmentsReader, OnModuleInit {
  constructor(private readonly registry: StudentEnrollmentsRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** The active enrollments of the class. */
  async countActive(manager: EntityManager, classId: string): Promise<number> {
    const rows: Array<{ total: number }> = await manager.query(
      `SELECT COUNT(*)::int AS "total"
         FROM enrollments
        WHERE class_id = $1 AND status = $2 AND deleted_at IS NULL`,
      [classId, EnrollmentStatus.ACTIVE],
    );
    return rows[0].total;
  }

  /**
   * The enrollments of the class that are not removed, in ANY status. It is what blocks the change
   * of course (409 COURSE_CHANGE_NOT_ALLOWED): a completed enrollment is a course the student
   * completed (RN-16, derived from the course of the class), and a dropped one is history of that
   * course, so moving the class to another course would rewrite both. Archiving the class and
   * lowering its seats look only at the active ones (`countActive`).
   */
  async countLive(manager: EntityManager, classId: string): Promise<number> {
    const rows: Array<{ total: number }> = await manager.query(
      `SELECT COUNT(*)::int AS "total"
         FROM enrollments
        WHERE class_id = $1 AND deleted_at IS NULL`,
      [classId],
    );
    return rows[0].total;
  }

  /**
   * The active enrollments of each class in `classIds`, in one call. A class that is not in the
   * map has none, so the reader takes `map.get(id) ?? 0`. No ids, no query: an empty map.
   */
  async countActiveByClass(
    manager: EntityManager,
    classIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (classIds.length === 0) return new Map();

    const rows: Array<{ classId: string; total: number }> = await manager.query(
      `SELECT class_id AS "classId", COUNT(*)::int AS "total"
         FROM enrollments
        WHERE class_id = ANY($1::uuid[]) AND status = $2 AND deleted_at IS NULL
        GROUP BY class_id`,
      [[...classIds], EnrollmentStatus.ACTIVE],
    );
    return new Map(rows.map((row) => [row.classId, row.total]));
  }

  /**
   * The first `limit` active enrollments of a class, the earliest first (`enrolledAt`, then the id
   * of the enrollment, so the order is the same on every call). It never answers more than `limit`
   * rows.
   */
  listActivePreview(
    manager: EntityManager,
    classId: string,
    limit: number,
  ): Promise<ActiveEnrollmentPreviewRow[]> {
    return manager.query(
      `SELECT id AS "enrollmentId", student_id AS "studentId", enrolled_at AS "enrolledAt"
         FROM enrollments
        WHERE class_id = $1 AND status = $2 AND deleted_at IS NULL
        ORDER BY enrolled_at, id
        LIMIT $3`,
      [classId, EnrollmentStatus.ACTIVE, limit],
    );
  }

  /**
   * The active enrollments of a student, in any class. The port of `people`
   * (StudentEnrollmentsReader): it runs in the transaction of the archive of the student, with its
   * `manager`, and takes no lock.
   */
  async countActiveEnrollments(manager: EntityManager, studentId: string): Promise<number> {
    const rows: Array<{ total: number }> = await manager.query(
      `SELECT COUNT(*)::int AS "total"
         FROM enrollments
        WHERE student_id = $1 AND status = $2 AND deleted_at IS NULL`,
      [studentId, EnrollmentStatus.ACTIVE],
    );
    return rows[0].total;
  }
}
