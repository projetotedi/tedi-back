import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";

/**
 * How many active enrollments a class has. It is the extension point of the enrollments:
 * ClassesService asks it before it archives a class (409 CLASS_HAS_ACTIVE_ENROLLMENTS) and before
 * it lowers the seats (409 CAPACITY_BELOW_ENROLLED).
 *
 * There is no enrollment table yet, so the count is always 0 and those two rules never fire in
 * production; the e2e overrides this provider to prove them. GUS-108 (enrollments) replaces the
 * body with a `SELECT count(*)` over its table and, in the same card, makes the enrollment lock the
 * row of the class (`FOR UPDATE`) before it counts and inserts: without that lock an enrollment and
 * an archive (or a cut of the seats) could both pass their checks at once.
 */
@Injectable()
export class EnrollmentCountsService {
  // TODO(GUS-108): count the active enrollments of the class.
  countActive(_manager: EntityManager, _classId: string): Promise<number> {
    return Promise.resolve(0);
  }
}
