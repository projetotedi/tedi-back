/** Why `POST /classes/:id/enrollments` left a student out of the batch (`skipped`). */
export enum EnrollmentSkipReason {
  /** The student already has an enrollment in the class that is not removed, in any status. */
  ALREADY_ENROLLED = "ALREADY_ENROLLED",
}
