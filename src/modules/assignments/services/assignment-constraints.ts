import { EntityManager, In, QueryFailedError } from "typeorm";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { ACTIVE_ASSIGNMENT_STATUSES } from "../enums/assignment-status.enum";

/** One active place per member in a lesson (RN-01): `pending` and `confirmed` hold it. */
export const ACTIVE_UNIQUE_INDEX = "uq_lesson_assignments_lesson_id_person_id_active";
/** One confirmed teacher per lesson (RN-02). */
export const CONFIRMED_TEACHER_UNIQUE_INDEX = "uq_lesson_assignments_lesson_id_confirmed_teacher";
export const PERSON_FOREIGN_KEY = "fk_lesson_assignments_person_id";
export const LESSON_FOREIGN_KEY = "fk_lesson_assignments_lesson_id";

/** The SQLSTATE and the constraint of a violation that the database reported. */
export interface ConstraintViolation {
  code: string;
  constraint: string;
}

/**
 * The code and the constraint of a violation, when the error is a `QueryFailedError` whose driver
 * error names both (as `pg` does for 23505 and 23503); null for anything else. Each family of
 * routes maps them to its own business error: the direct assignment (GUS-158) and the application
 * (GUS-160) answer different codes for the same index.
 */
export function violatedConstraint(error: unknown): ConstraintViolation | null {
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

/**
 * Whether the member holds a place in the lesson: a pending or confirmed assignment of hers, of any
 * role and any source. It is the pre-check that says the same as the predicate of
 * `uq_lesson_assignments_lesson_id_person_id_active`, so the business error is answered before the
 * index has to.
 */
export function hasActiveAssignment(
  manager: EntityManager,
  lessonId: string,
  personId: string,
): Promise<boolean> {
  return manager.exists(LessonAssignment, {
    where: { lessonId, personId, status: In(ACTIVE_ASSIGNMENT_STATUSES) },
  });
}
