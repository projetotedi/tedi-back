/**
 * Order of the list of courses (GUS-99). NAME is alphabetical, the default; CREATED_AT puts the
 * newest first. Both break ties by id, so a page never repeats or skips a course.
 */
export enum CourseListSort {
  NAME = "name",
  CREATED_AT = "createdAt",
}
