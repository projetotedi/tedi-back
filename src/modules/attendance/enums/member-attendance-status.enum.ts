/**
 * Whether a member was at a lesson she was assigned to, as teacher or monitor (F6.2). A presence
 * generates the lesson hours of the member; an absence generates nothing.
 *
 * The values are stored in the Postgres enum `member_attendance_status_enum`: a new status needs a
 * migration with `ALTER TYPE member_attendance_status_enum ADD VALUE`.
 */
export enum MemberAttendanceStatus {
  PRESENT = "present",
  ABSENT = "absent",
}
