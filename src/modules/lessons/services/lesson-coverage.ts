import { EntityManager } from "typeorm";
import { LessonCoverageDto } from "../dto/lesson-coverage.response.dto";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";

/** The staff a lesson has, counted over the CONFIRMED assignments only (F5.4). */
export interface ConfirmedStaffCount {
  teachers: number;
  monitors: number;
}

/** A person as the port hands her over: the id and the name, nothing else of her. */
export interface StaffPerson {
  id: string;
  name: string;
}

/**
 * The confirmed staff of a lesson with the teacher in person (F4.4): the counts of
 * `ConfirmedStaffCount` and who the confirmed teacher is, which a row of the list and of the
 * calendar shows. It is what `findConfirmedStaff` finds; the counts alone are what
 * `countConfirmedStaff` counts, and they are all the detail of a lesson needs.
 */
export interface ConfirmedStaff extends ConfirmedStaffCount {
  /**
   * The confirmed teacher (a lesson has at most one, RN-02), or null when it has none. A pending
   * teacher is a candidate, not the teacher. Also null when the person is gone, whatever
   * `teachers` says.
   */
  teacher: StaffPerson | null;
}

/**
 * A lesson that nobody is confirmed in: what a lesson without assignments, or without a counter,
 * has. One value for both reads (`countConfirmedStaff` ignores the `teacher`), so the callers have a
 * single answer for "nobody".
 */
export const NO_CONFIRMED_STAFF: Readonly<ConfirmedStaff> = Object.freeze({
  teachers: 0,
  monitors: 0,
  teacher: null,
});

/** A lesson has one teacher (RN-02): the same number for every lesson, not a column. */
export const EXPECTED_TEACHERS = 1;

/**
 * The port through which `lessons` learns how many people are confirmed in its lessons without
 * knowing who assigns them: the `assignments` module implements it and registers it in the
 * `LessonCoverageRegistry` (docs/ARCHITECTURE.md section 15). That is what keeps the dependency
 * pointing one way (`assignments` -> `lessons`): `lessons` reads the counts and never the table.
 *
 * Two reads, over the same confirmed assignments, because two kinds of caller need different
 * things and the name of a person is not free:
 * - `countConfirmedStaff` answers the COUNTS. It is what the detail of a lesson and the answers of
 *   its writes need, and those run inside a transaction (the `manager`): it costs one aggregated
 *   query and reads no person, so it holds no second connection while the transaction holds one.
 * - `findConfirmedStaff` answers the counts AND the confirmed teacher, with her name. It is what the
 *   list and the calendar need to draw a row; they are plain reads with no transaction, so it takes
 *   no `manager`, and the names of the whole page cost ONE more query.
 *
 * Both take ids of lessons and answer ONE entry per lesson that has someone confirmed; a lesson with
 * nobody is left out of the map, and the caller reads it as `NO_CONFIRMED_STAFF`. They are meant to
 * be called once per page of lessons (or per period), never once per lesson.
 */
export interface LessonStaffCounter {
  countConfirmedStaff(
    lessonIds: readonly string[],
    manager?: EntityManager,
  ): Promise<Map<string, ConfirmedStaffCount>>;

  findConfirmedStaff(lessonIds: readonly string[]): Promise<Map<string, ConfirmedStaff>>;
}

/**
 * Whether a lesson has fewer confirmed monitors than it expects (F4.4, F5.4, RF-050), the one rule
 * behind `belowExpectedMonitors` in the detail, in the list and in the calendar: true only for a
 * lesson that still happens (not `cancelled`), that says how many monitors it expects
 * (`expectedMonitors` is not null: null means "not informed", so nothing is missing) and that has
 * fewer confirmed monitors than that. The teacher is not part of it, and a pending monitor never
 * counts.
 */
export function isBelowExpectedMonitors(
  lesson: Pick<Lesson, "status" | "expectedMonitors">,
  staff: Pick<ConfirmedStaffCount, "monitors">,
): boolean {
  // Missing (undefined) on an entity that was just inserted, not loaded.
  const expectedMonitors = lesson.expectedMonitors ?? null;

  return (
    lesson.status !== LessonStatus.CANCELLED &&
    expectedMonitors !== null &&
    staff.monitors < expectedMonitors
  );
}

/**
 * The coverage of a lesson (F5.4), as the response shows it: the confirmed teacher against the one
 * that is expected, the confirmed monitors against `expectedMonitors`, and whether the monitors fall
 * short.
 *
 * `belowExpectedMonitors` follows `isBelowExpectedMonitors`. The teacher is not part of it: a lesson
 * without a teacher reads in `coverage.teacher`. Pending assignments never count.
 */
export function toLessonCoverage(
  lesson: Pick<Lesson, "status" | "expectedMonitors">,
  staff: ConfirmedStaffCount,
): { coverage: LessonCoverageDto; belowExpectedMonitors: boolean } {
  return {
    coverage: {
      teacher: { confirmed: staff.teachers, expected: EXPECTED_TEACHERS },
      // Missing (undefined) on an entity that was just inserted, not loaded.
      monitors: { confirmed: staff.monitors, expected: lesson.expectedMonitors ?? null },
    },
    belowExpectedMonitors: isBelowExpectedMonitors(lesson, staff),
  };
}
