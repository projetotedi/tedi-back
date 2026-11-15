import { DataSource } from "typeorm";
import { ClassStatus } from "../../enums/class-status.enum";

/**
 * Fixtures of the classes module for its e2e. They use raw SQL on purpose: a row that is only the
 * scenery of a test (a course, an edition, a class that is already there) does not go through the
 * services, so the test depends on the schema and not on the rules of the module it exercises.
 */

/**
 * INSERT INTO courses ... RETURNING id. The author is a person that already exists. The category
 * is one of the values of `courses_category_enum` (basic, intermediate, advanced).
 */
export async function insertCourse(
  dataSource: DataSource,
  createdById: string,
  name = "Informática Básica",
  category = "basic",
): Promise<string> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO courses (id, name, description, category, created_by_id)
     VALUES (gen_random_uuid(), $2, 'Fundamentos do uso do computador.', $3::courses_category_enum, $1)
     RETURNING id`,
    [createdById, name, category],
  );
  return rows[0].id;
}

/**
 * Archives a course the way its card will (archived_at and archived_by_id filled), by SQL: the
 * route that archives a course does not exist yet, and a test of the classes only needs the state.
 */
export async function archiveCourse(
  dataSource: DataSource,
  courseId: string,
  archivedById: string,
): Promise<void> {
  await dataSource.query(
    `UPDATE courses SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
    [courseId, archivedById],
  );
}

/** INSERT INTO editions ... RETURNING id. */
export async function insertEdition(dataSource: DataSource, name: string): Promise<string> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO editions (id, name) VALUES (gen_random_uuid(), $1) RETURNING id`,
    [name],
  );
  return rows[0].id;
}

/**
 * INSERT INTO classes ... RETURNING id. Archived when `archivedById` is given. The status is
 * planned, the period 2026-03-03 to 2026-06-27 and the seats 15 unless they are given, and the name
 * is null.
 */
export async function insertClass(
  dataSource: DataSource,
  input: {
    courseId: string;
    editionId: string;
    createdById: string;
    code?: string;
    name?: string;
    startDate?: string;
    endDate?: string;
    capacity?: number;
    archivedById?: string;
    status?: ClassStatus;
  },
): Promise<string> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO classes (id, code, course_id, edition_id, start_date, end_date, capacity,
                          created_by_id, archived_at, archived_by_id, status, name)
     VALUES (gen_random_uuid(), $4, $1, $2, $8::date, $9::date, $10, $3,
             CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() END, $5::uuid,
             $6::classes_status_enum, $7)
     RETURNING id`,
    [
      input.courseId,
      input.editionId,
      input.createdById,
      input.code ?? "INFO-A",
      input.archivedById ?? null,
      input.status ?? ClassStatus.PLANNED,
      input.name ?? null,
      input.startDate ?? "2026-03-03",
      input.endDate ?? "2026-06-27",
      input.capacity ?? 15,
    ],
  );
  return rows[0].id;
}
