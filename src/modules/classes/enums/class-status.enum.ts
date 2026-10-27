/**
 * Status of a class (turma) along the life of its offering (RF-034).
 *
 * It is a column of `classes`, and it is independent of archiving (RN-27): an archived class keeps
 * the status it had, and archiving never changes it. No rule limits the moves between statuses yet
 * (the transitions are the F2.6 card).
 *
 * The values are stored in the Postgres enum `classes_status_enum`: a new status needs a migration
 * with `ALTER TYPE classes_status_enum ADD VALUE`.
 */
export enum ClassStatus {
  PLANNED = "planned",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}
