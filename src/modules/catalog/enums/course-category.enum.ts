/**
 * Category of a course (RF-013): the level of its content. A class (turma) takes the category of
 * its course when it is created (RN-14); changing the category of a course later never changes
 * the classes that already exist (RN-18).
 *
 * The values are stored in the Postgres enum `courses_category_enum`: a new category needs a
 * migration with `ALTER TYPE courses_category_enum ADD VALUE`.
 */
export enum CourseCategory {
  BASIC = "basic",
  INTERMEDIATE = "intermediate",
  ADVANCED = "advanced",
}
