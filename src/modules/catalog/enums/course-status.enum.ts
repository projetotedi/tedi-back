/**
 * Status of a course in the API. It is derived from `archived_at` (RN-27) and is NOT a column:
 * a course is ARCHIVED when `archived_at` is set and ACTIVE otherwise. A new course is ACTIVE.
 */
export enum CourseStatus {
  ACTIVE = "active",
  ARCHIVED = "archived",
}
