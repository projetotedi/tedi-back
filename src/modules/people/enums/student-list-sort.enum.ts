/**
 * Order of the list of students (GUS-106). NAME is alphabetical, the default; CREATED_AT puts the
 * student registered last first. Both break ties by id, so a page never repeats or skips a student.
 */
export enum StudentListSort {
  NAME = "name",
  CREATED_AT = "createdAt",
}
