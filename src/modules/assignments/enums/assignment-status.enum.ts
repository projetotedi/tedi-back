/**
 * Where an assignment of a member to a lesson stands (F5.2).
 *
 * `pending` waits for a decision, `confirmed` is staff of the lesson, `declined` is a refused
 * application (only the review of applications, GUS-160, writes it) and `cancelled` is an
 * assignment that was withdrawn (`PATCH /assignments/:id/cancel`). The last two are final: the row
 * stays, and the member can be assigned to the same lesson again with a new one.
 *
 * It is a column of `lesson_assignments`, stored in the Postgres enum
 * `lesson_assignments_status_enum`: a new status needs a migration with `ALTER TYPE ... ADD VALUE`.
 */
export enum AssignmentStatus {
  PENDING = "pending",
  CONFIRMED = "confirmed",
  DECLINED = "declined",
  CANCELLED = "cancelled",
}

/**
 * The statuses a new assignment can be created with: a coordinator or a director either leaves it
 * waiting (`pending`) or puts it in place straight away (`confirmed`). `declined` and `cancelled`
 * only come out of a decision about an assignment that already exists.
 */
export const CREATABLE_ASSIGNMENT_STATUSES = [
  AssignmentStatus.PENDING,
  AssignmentStatus.CONFIRMED,
] as const;

/**
 * The statuses that still hold the place of the member in the lesson: one of them blocks a second
 * assignment of the same member to the same lesson (RN-01). It is the predicate of the partial
 * unique index `uq_lesson_assignments_lesson_id_person_id_active` and of the pre-check of the
 * service, which must say the same thing.
 */
export const ACTIVE_ASSIGNMENT_STATUSES = [
  AssignmentStatus.PENDING,
  AssignmentStatus.CONFIRMED,
] as const;
