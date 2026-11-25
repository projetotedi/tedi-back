import { DataSource } from "typeorm";

/**
 * A student straight in the tables (`people` and `student_profiles`), for an e2e that only needs
 * one as scenery: the rules of the registration are not what that test exercises. Exported for the
 * e2e of other modules (classes, GUS-108), which reexport it from their own fixture.
 *
 * The birth date defaults to a real date on purpose: `listStudentEntries` refuses a student without
 * one (it is required on registration). The accessibility need defaults to `none`, the default of
 * the column. Archived (now, by `archivedById`) when `archivedById` is given. The phone goes in as
 * given, so a test can store one with a mask (the API stores digits only).
 */
export async function insertStudent(
  dataSource: DataSource,
  input: {
    name: string;
    createdById: string;
    birthDate?: string;
    phone?: string | null;
    email?: string | null;
    accessibilityNeed?: string;
    archivedById?: string;
  },
): Promise<string> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `WITH person AS (
       INSERT INTO people (id, name, birth_date, phone, email)
       VALUES (gen_random_uuid(), $1, $2::date, $3, $7)
       RETURNING id
     )
     INSERT INTO student_profiles (id, person_id, accessibility_need, created_by_id,
                                   archived_at, archived_by_id)
     SELECT gen_random_uuid(), person.id,
            $4::student_profiles_accessibility_need_enum, $5,
            CASE WHEN $6::uuid IS NULL THEN NULL ELSE now() END, $6::uuid
       FROM person
     RETURNING person_id AS id`,
    [
      input.name,
      input.birthDate ?? "1960-05-10",
      input.phone ?? null,
      input.accessibilityNeed ?? "none",
      input.createdById,
      input.archivedById ?? null,
      input.email ?? null,
    ],
  );
  return rows[0].id;
}
