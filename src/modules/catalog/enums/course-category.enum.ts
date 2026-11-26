/**
 * Category of a course (RF-013): the level of its content. A class (turma) has no category of its
 * own: it always shows the current category of its course (RN-14, RF-029), so changing the
 * category of a course changes what its classes show, the ones that already exist included
 * (GUS-102).
 *
 * The values are stored in the Postgres enum `courses_category_enum`: a new category needs a
 * migration with `ALTER TYPE courses_category_enum ADD VALUE`.
 */
export enum CourseCategory {
  BASIC = "basic",
  INTERMEDIATE = "intermediate",
  ADVANCED = "advanced",
}
