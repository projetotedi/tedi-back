/**
 * A warning of `POST /classes/:id/enrollments` that does not stop the enrollment (RF-032): the
 * student is enrolled all the same.
 */
export enum EnrollmentWarningCode {
  /** The student has no completed enrollment in a course that the course of the class requires. */
  PREREQUISITE_NOT_COMPLETED = "PREREQUISITE_NOT_COMPLETED",
}
