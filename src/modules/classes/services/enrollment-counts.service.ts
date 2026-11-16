import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";

/** One active enrollment as the sheet of the class shows it. GUS-108 fills it from its table. */
export interface ActiveEnrollmentPreviewRow {
  enrollmentId: string;
  studentId: string;
  enrolledAt: Date;
}

/**
 * What the module knows about the active enrollments of a class. It is the extension point of the
 * enrollments, and it has three consumers:
 *
 * - ClassesService asks `countActive` before it archives a class (409
 *   CLASS_HAS_ACTIVE_ENROLLMENTS), before it lowers the seats (409 CAPACITY_BELOW_ENROLLED) and
 *   before it changes the course of a class (409 COURSE_CHANGE_NOT_ALLOWED, GUS-102).
 * - CourseClassesService asks `countActiveByClass` for the whole page of the classes of a course,
 *   in one call, to fill `enrolledCount` without a query per class (GUS-102).
 * - ClassDetailService (GUS-104) uses `countActive` for `summary.enrolledCount` and
 *   `enrollmentsTotal`, and `listActivePreview` for `enrollmentsPreview`. The preview comes in a
 *   fixed order, `enrolledAt` ascending and then the id of the enrollment, and carries only ids:
 *   the names of the students are read by whoever calls, from `people`, so GUS-108 changes the
 *   bodies here and nothing else.
 *
 * There is no enrollment table yet, so all three answer "none" and the rules that depend on them
 * never fire in production; the e2e overrides this provider to prove them. GUS-108 (enrollments)
 * replaces the bodies with a `SELECT count(*)`, a `SELECT class_id, count(*) ... GROUP BY
 * class_id` and a `SELECT ... ORDER BY enrolled_at, id LIMIT n` over its table and, in the same
 * card, makes the enrollment lock the row of the class (`FOR UPDATE`) before it counts and
 * inserts: without that lock an enrollment and an archive (a cut of the seats, a change of
 * course) could both pass their checks at once.
 */
@Injectable()
export class EnrollmentCountsService {
  // TODO(GUS-108): count the active enrollments of the class.
  countActive(_manager: EntityManager, _classId: string): Promise<number> {
    return Promise.resolve(0);
  }

  /**
   * The active enrollments of each class in `classIds`, in one call. A class that is not in the
   * map has none, so the reader takes `map.get(id) ?? 0`. Until GUS-108 the map is always empty.
   */
  // TODO(GUS-108): one SELECT class_id, count(*) ... GROUP BY class_id.
  countActiveByClass(
    _manager: EntityManager,
    _classIds: readonly string[],
  ): Promise<Map<string, number>> {
    return Promise.resolve(new Map());
  }

  /**
   * The first `limit` active enrollments of a class, the earliest first (`enrolledAt`, then the id
   * of the enrollment, so the order is the same on every call). Until GUS-108 the list is always
   * empty. It never answers more than `limit` rows.
   */
  // TODO(GUS-108): SELECT id, student_id, enrolled_at ... WHERE class_id = $1 AND <active>
  //                ORDER BY enrolled_at, id LIMIT $2
  listActivePreview(
    _manager: EntityManager,
    _classId: string,
    _limit: number,
  ): Promise<ActiveEnrollmentPreviewRow[]> {
    return Promise.resolve([]);
  }
}
