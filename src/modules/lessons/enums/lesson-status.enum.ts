/**
 * Status of a lesson along its life (F4.5).
 *
 * It is a column of `lessons`. `planned` is where every lesson starts; `confirmed` and `done` are
 * set by the edit, and no rule limits the moves between them yet (who marks `done` and when is the
 * attendance card, GUS-166). `cancelled` is different: it only comes from `PATCH /lessons/:id/cancel`,
 * which records the reason, the instant and who did it, and it is final: a cancelled lesson is not
 * edited or rescheduled again, and nothing reactivates it.
 *
 * The values are stored in the Postgres enum `lessons_status_enum`: a new status needs a migration
 * with `ALTER TYPE lessons_status_enum ADD VALUE`.
 */
export enum LessonStatus {
  PLANNED = "planned",
  CONFIRMED = "confirmed",
  DONE = "done",
  CANCELLED = "cancelled",
}

/** The statuses the edit of a lesson takes: every one but `cancelled`, which has its own route. */
export const EDITABLE_LESSON_STATUSES = [
  LessonStatus.PLANNED,
  LessonStatus.CONFIRMED,
  LessonStatus.DONE,
] as const;
