/**
 * How an assignment came to exist (F5.1, F5.2): `direct` is made by a coordinator or a director
 * (this card), `application` is a member who applied for the lesson and waits for a review (the
 * candidature, GUS-160).
 *
 * It is a column of `lesson_assignments`, stored in the Postgres enum
 * `lesson_assignments_source_enum`: a new source needs a migration with `ALTER TYPE ... ADD VALUE`.
 */
export enum AssignmentSource {
  DIRECT = "direct",
  APPLICATION = "application",
}
