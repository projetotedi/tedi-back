import { DataSource } from "typeorm";
import { insertStudent } from "@modules/people/__tests__/fixtures/students.fixture";
import { ClassStatus } from "../../enums/class-status.enum";
import { EnrollmentStatus } from "../../enums/enrollment-status.enum";

// The students of an enrollment come from the fixture of people: reexported so the e2e of this
// module import their scenery from one place.
export { insertStudent };

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

/**
 * INSERT INTO enrollments ... RETURNING id. Active, enrolled now and not removed unless told.
 *
 * `statusChangedAt` defaults to the day of `enrolledAt` in America/Sao_Paulo, derived in SQL: a fixed
 * date could fall before the day of the enrollment and break `ck_enrollments_status_changed_at`.
 * `deletedAt` makes it a removed enrollment, which frees the pair (class, student).
 */
export async function insertEnrollment(
  dataSource: DataSource,
  input: {
    classId: string;
    studentId: string;
    createdById: string;
    status?: EnrollmentStatus;
    enrolledAt?: Date;
    statusChangedAt?: string;
    deletedAt?: Date;
    statusReason?: string;
  },
): Promise<string> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO enrollments (id, class_id, student_id, status, enrolled_at, status_changed_at,
                             status_reason, created_by_id, deleted_at)
     VALUES (gen_random_uuid(), $1, $2, $3::enrollments_status_enum,
             COALESCE($4::timestamptz, now()),
             COALESCE($5::date, (COALESCE($4::timestamptz, now()) AT TIME ZONE 'America/Sao_Paulo')::date),
             $6, $7, $8::timestamptz)
     RETURNING id`,
    [
      input.classId,
      input.studentId,
      input.status ?? EnrollmentStatus.ACTIVE,
      input.enrolledAt ?? null,
      input.statusChangedAt ?? null,
      input.statusReason ?? null,
      input.createdById,
      input.deletedAt ?? null,
    ],
  );
  return rows[0].id;
}

/** The instant of the first enrollment of `insertEnrollments`; the next ones come 1 second apart. */
export const FIRST_ENROLLED_AT = new Date("2026-03-03T13:00:00.000Z");

/**
 * `count` new students (named "<namePrefix> 01", "<namePrefix> 02"...) enrolled in the class, with
 * `enrolledAt` strictly increasing (FIRST_ENROLLED_AT plus i seconds): the id of an enrollment made
 * here is random (gen_random_uuid), so the order of the preview (`enrolledAt`, then the id) must
 * never need the id to break a tie. Answers the ids of the students, in the order of enrollment.
 */
export async function insertEnrollments(
  dataSource: DataSource,
  input: {
    classId: string;
    createdById: string;
    count: number;
    status?: EnrollmentStatus;
    namePrefix?: string;
  },
): Promise<string[]> {
  const studentIds: string[] = [];
  for (let index = 0; index < input.count; index++) {
    const studentId = await insertStudent(dataSource, {
      name: `${input.namePrefix ?? "Student"} ${String(index + 1).padStart(2, "0")}`,
      createdById: input.createdById,
    });
    await insertEnrollment(dataSource, {
      classId: input.classId,
      studentId,
      createdById: input.createdById,
      status: input.status,
      enrolledAt: new Date(FIRST_ENROLLED_AT.getTime() + index * 1000),
    });
    studentIds.push(studentId);
  }
  return studentIds;
}
