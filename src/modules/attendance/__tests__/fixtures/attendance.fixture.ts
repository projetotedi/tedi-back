import { DataSource } from "typeorm";

/**
 * Fixtures of the attendance module for its e2e. The scenery of a test (the people, the course, the
 * class, the lesson, the assignments and the hour entries) comes from the services and the fixtures
 * that the other modules export (the owner module exports the function, docs/ARCHITECTURE.md
 * section 5), re-exported here so the tests of the module import them from one place.
 */

// A student and her enrollment in a class, from the classes (GUS-108). `insertEnrollment` answers
// the id of the ENROLLMENT, which the roll call takes; `FIRST_ENROLLED_AT` (2026-03-03) is a day
// before the lessons of the scenery, so the enrollment is expected at them (GUS-166, S2).
export {
  FIRST_ENROLLED_AT,
  insertClass,
  insertCourse,
  insertEdition,
  insertEnrollment,
  insertStudent,
} from "@modules/classes/__tests__/fixtures/classes.fixture";

// The period of the class of the scenery, the body of a lesson inside it and a lesson inserted
// straight through the repository of the lessons (a lesson after today, which POST /lessons takes
// but whose class period the scenery would have to stretch).
export {
  CLASS_PERIOD,
  insertLesson,
  lessonBody,
} from "@modules/lessons/__tests__/fixtures/lessons.fixture";

// A department, and the member profile that gives a director (or a member) one, from the people.
export {
  insertDepartment,
  insertMemberProfile,
} from "@modules/people/__tests__/fixtures/member-registration.fixture";

// A row of lesson_assignments in any status (confirmed with who reviewed it), from the assignments.
export { insertAssignment } from "@modules/assignments/__tests__/fixtures/assignments.fixture";

// A pending attendance entry of lesson hours, for a present row to point to, from the hours.
export { insertAttendanceHourEntry } from "@modules/hours/__tests__/fixtures/hour-entries.fixture";

/**
 * INSERT INTO student_attendance ... RETURNING id: an attendance that is only the scenery of a test
 * (a roll call already signed, a justified absence), by SQL so it depends on the schema and not on
 * the rules of the routes the test exercises. Signed now unless `signedAt` is given; a
 * `justification` comes with who and when (now unless given), as the CHECKs of the table demand.
 */
export async function insertStudentAttendance(
  dataSource: DataSource,
  input: {
    lessonId: string;
    enrollmentId: string;
    status: "present" | "absent";
    signedById: string;
    signedAt?: Date;
    justification?: {
      reason: "health" | "other";
      note?: string | null;
      justifiedById: string;
      justifiedAt?: Date;
    };
  },
): Promise<string> {
  const justification = input.justification;
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO student_attendance (id, lesson_id, enrollment_id, status, signed_by_id, signed_at,
                                     justification_reason, justification_note, justified_by_id,
                                     justified_at)
     VALUES (gen_random_uuid(), $1, $2, $3::student_attendance_status_enum, $4,
             COALESCE($5::timestamptz, now()),
             $6::student_attendance_justification_reason_enum, $7, $8::uuid, $9::timestamptz)
     RETURNING id`,
    [
      input.lessonId,
      input.enrollmentId,
      input.status,
      input.signedById,
      input.signedAt ?? null,
      justification?.reason ?? null,
      justification?.note ?? null,
      justification?.justifiedById ?? null,
      justification === undefined ? null : (justification.justifiedAt ?? new Date()),
    ],
  );
  return rows[0].id;
}

/**
 * Polls `condition` every 50 ms until it holds, for at most `timeoutMs` (5 s by default): the
 * listener of `lesson.cancelled` runs after the response of the cancellation, so a test that
 * checks what it did has to wait for it. Throws when the time runs out, so a listener that never
 * runs fails the test instead of passing by luck.
 */
export async function waitFor(condition: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Condition not met within ${timeoutMs} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
