import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";

/**
 * How many active enrollments a class has. It is the extension point of the enrollments, and it
 * has three consumers:
 *
 * - ClassesService asks `countActive` before it archives a class (409
 *   CLASS_HAS_ACTIVE_ENROLLMENTS), before it lowers the seats (409 CAPACITY_BELOW_ENROLLED) and
 *   before it changes the course of a class (409 COURSE_CHANGE_NOT_ALLOWED, GUS-102).
 * - CourseClassesService asks `countActiveByClass` for the whole page of the classes of a course,
 *   in one call, to fill `enrolledCount` without a query per class (GUS-102).
 *
 * There is no enrollment table yet, so both answer "none" and the rules that depend on them never
 * fire in production; the e2e overrides this provider to prove them. GUS-108 (enrollments)
 * replaces the bodies with a `SELECT count(*)` and a `SELECT class_id, count(*) ... GROUP BY
 * class_id` over its table and, in the same card, makes the enrollment lock the row of the class
 * (`FOR UPDATE`) before it counts and inserts: without that lock an enrollment and an archive (a
 * cut of the seats, a change of course) could both pass their checks at once.
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
}
