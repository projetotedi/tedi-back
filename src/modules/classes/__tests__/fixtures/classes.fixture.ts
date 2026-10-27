import { DataSource } from "typeorm";

/**
 * Fixtures of the classes module for its e2e. They use raw SQL on purpose: a row that is only the
 * scenery of a test (a course, an edition, a class that is already there) does not go through the
 * services, so the test depends on the schema and not on the rules of the module it exercises.
 */

/** INSERT INTO courses ... RETURNING id. The author is a person that already exists. */
export async function insertCourse(
  dataSource: DataSource,
  createdById: string,
  name = "Informática Básica",
): Promise<string> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO courses (id, name, description, category, created_by_id)
     VALUES (gen_random_uuid(), $2, 'Fundamentos do uso do computador.', 'basic', $1)
     RETURNING id`,
    [createdById, name],
  );
  return rows[0].id;
}

/** INSERT INTO editions ... RETURNING id. */
export async function insertEdition(dataSource: DataSource, name: string): Promise<string> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO editions (id, name) VALUES (gen_random_uuid(), $1) RETURNING id`,
    [name],
  );
  return rows[0].id;
}

/** INSERT INTO classes ... RETURNING id. Archived when `archivedById` is given. */
export async function insertClass(
  dataSource: DataSource,
  input: {
    courseId: string;
    editionId: string;
    createdById: string;
    code?: string;
    archivedById?: string;
  },
): Promise<string> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO classes (id, code, course_id, edition_id, start_date, end_date, capacity,
                          created_by_id, archived_at, archived_by_id)
     VALUES (gen_random_uuid(), $4, $1, $2, '2026-03-03', '2026-06-27', 15, $3,
             CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() END, $5::uuid)
     RETURNING id`,
    [
      input.courseId,
      input.editionId,
      input.createdById,
      input.code ?? "INFO-A",
      input.archivedById ?? null,
    ],
  );
  return rows[0].id;
}
