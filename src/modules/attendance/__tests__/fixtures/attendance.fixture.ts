/**
 * Fixtures of the attendance module for its e2e. The scenery of a test (the people, the course, the
 * class, the lesson, the assignments and the hour entries) comes from the services and the fixtures
 * that the other modules export (the owner module exports the function, docs/ARCHITECTURE.md
 * section 5), re-exported here so the tests of the module import them from one place.
 */

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
