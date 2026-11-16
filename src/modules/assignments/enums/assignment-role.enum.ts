/**
 * What a member does in a lesson (RF-047): the one who gives it, or one of the monitors who help.
 *
 * It is a column of `lesson_assignments`, stored in the Postgres enum `lesson_assignments_role_enum`:
 * a new role needs a migration with `ALTER TYPE lesson_assignments_role_enum ADD VALUE`.
 */
export enum AssignmentRole {
  TEACHER = "teacher",
  MONITOR = "monitor",
}
