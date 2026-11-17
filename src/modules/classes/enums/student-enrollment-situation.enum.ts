/**
 * The filter of `GET /enrollments/students`: students with an active enrollment (in the class asked,
 * or in any class) or students without one (not archived).
 */
export enum StudentEnrollmentSituation {
  ENROLLED = "enrolled",
  NOT_ENROLLED = "not_enrolled",
}
