import {
  ConfirmedStaffCount,
  EXPECTED_TEACHERS,
  isBelowExpectedMonitors,
} from "@modules/lessons/services/lesson-coverage";
import { LessonStatus, LessonSummary } from "@modules/lessons/services/lessons.service";
import { AssignmentRole } from "../enums/assignment-role.enum";

/** What the rule reads of a lesson: a `LessonSummary` and a `LessonAgendaRef` both have it. */
type VacancyLesson = Pick<LessonSummary, "status" | "expectedMonitors">;

/**
 * Whether a lesson no longer takes applications (GUS-160, C14): it is before `today` (a
 * "YYYY-MM-DD" in America/Sao_Paulo), or it is already `done`, which means it happened, even when it
 * is today or was marked done ahead of time. A lesson of today is still taken while it is not done.
 * The ONE rule that applying (409 LESSON_IN_PAST) and the lessons with an open place follow, so a
 * lesson listed as open is never refused as past. Approving and declining do not look at it (A12).
 */
export function isClosedForApplications(
  lesson: Pick<LessonSummary, "date" | "status">,
  today: string,
): boolean {
  // "YYYY-MM-DD" strings compare in the order of the calendar.
  return lesson.date < today || lesson.status === LessonStatus.DONE;
}

/** The order the open roles are listed in: the teacher first, as the coverage reads. */
const ROLES_IN_ORDER: readonly AssignmentRole[] = [AssignmentRole.TEACHER, AssignmentRole.MONITOR];

/**
 * Whether the lesson has an open place for the role (GUS-160, C1): the ONE rule that applying,
 * approving and the lessons with an open place follow, so a lesson listed as open for a role never
 * answers ROLE_FULL for it, and the other way round. A place is the coverage (A2): only confirmed
 * assignments take one, so a pending application fills none, and several can wait for the same
 * place (the approval takes it).
 *
 * - teacher: open while the lesson has no confirmed teacher;
 * - monitor: open while the confirmed monitors are below `expectedMonitors`
 *   (`isBelowExpectedMonitors`): null ("not informed", L3) and 0 expect nobody, so they are full.
 * A cancelled lesson has no place at all.
 */
export function hasOpenPlace(
  role: AssignmentRole,
  lesson: VacancyLesson,
  staff: ConfirmedStaffCount,
): boolean {
  switch (role) {
    case AssignmentRole.TEACHER:
      return lesson.status !== LessonStatus.CANCELLED && staff.teachers < EXPECTED_TEACHERS;
    case AssignmentRole.MONITOR:
      return isBelowExpectedMonitors(lesson, staff);
    default: {
      const unknownRole: never = role;
      throw new Error(`Unknown assignment role: ${String(unknownRole)}.`);
    }
  }
}

/** The roles with an open place in the lesson, teacher before monitor; [] for a full lesson. */
export function openRolesOf(lesson: VacancyLesson, staff: ConfirmedStaffCount): AssignmentRole[] {
  return ROLES_IN_ORDER.filter((role) => hasOpenPlace(role, lesson, staff));
}
