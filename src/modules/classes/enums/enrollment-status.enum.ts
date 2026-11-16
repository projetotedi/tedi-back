/**
 * The status of an enrollment (RF-027): active (studying, takes a seat), dropped (left the class)
 * or completed (finished the course of the class, RN-16). Any status goes to any other one; going
 * back to active takes a seat again.
 *
 * The values are stored in the Postgres enum `enrollments_status_enum`: a new status needs a
 * migration with `ALTER TYPE enrollments_status_enum ADD VALUE`.
 */
export enum EnrollmentStatus {
  ACTIVE = "active",
  DROPPED = "dropped",
  COMPLETED = "completed",
}

/**
 * The description of EnrollmentStatus, the same on every property that names it: swagger keeps the
 * description of the first property that names an enum as the description of the enum itself.
 */
export const ENROLLMENT_STATUS_DESCRIPTION =
  "active, dropped or completed. Only active enrollments take a seat of the class; the completed ones are the courses the student finished (RN-16).";
