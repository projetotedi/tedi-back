/**
 * Why an assignment ended, when the system ended it and not a person (GUS-179): a stable code that
 * the front translates (the backend has no i18n), shown in the history of the member.
 *
 * `lesson_cancelled`: the lesson was cancelled, so its confirmed and pending assignments became
 * `cancelled` and its pending applications `expired`. Null for everything a person decided
 * (confirming, declining or cancelling one assignment).
 *
 * It is a column of `lesson_assignments`, stored in the Postgres enum
 * `lesson_assignments_status_reason_enum`: a new reason needs a migration with
 * `ALTER TYPE ... ADD VALUE`.
 */
export enum AssignmentStatusReason {
  LESSON_CANCELLED = "lesson_cancelled",
}
