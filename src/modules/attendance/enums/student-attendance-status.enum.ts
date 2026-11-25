/**
 * Whether a student was at a lesson of her class (F6.1, GUS-166). A justified absence is still an
 * absence: the justification is a column of its own, and the status does not change.
 *
 * The values are stored in the Postgres enum `student_attendance_status_enum`, shared by the
 * attendance and by the from and to of its corrections: a new status needs a migration with
 * `ALTER TYPE student_attendance_status_enum ADD VALUE`.
 */
export enum StudentAttendanceStatus {
  PRESENT = "present",
  ABSENT = "absent",
}

/**
 * The description of StudentAttendanceStatus, the same on every property that names it: swagger
 * keeps the description of the first property that names an enum as the description of the enum
 * itself.
 */
export const STUDENT_ATTENDANCE_STATUS_DESCRIPTION =
  "present or absent. A justified absence is still absent: it counts as an absence in the attendance rate. Students generate no hours.";
