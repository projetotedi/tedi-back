import { EntityManager } from "typeorm";
import { LessonCoverageDto } from "../dto/lesson-coverage.response.dto";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";

/** The staff a lesson has, counted over the CONFIRMED assignments only (F5.4). */
export interface ConfirmedStaffCount {
  teachers: number;
  monitors: number;
}

/** A lesson that nobody is confirmed in: what a lesson without assignments, or without a counter, has. */
export const NO_CONFIRMED_STAFF: Readonly<ConfirmedStaffCount> = Object.freeze({
  teachers: 0,
  monitors: 0,
});

/** A lesson has one teacher (RN-02): the same number for every lesson, not a column. */
export const EXPECTED_TEACHERS = 1;

/**
 * The port through which `lessons` learns how many people are confirmed in its lessons without
 * knowing who assigns them: the `assignments` module implements it and registers it in the
 * `LessonCoverageRegistry` (docs/ARCHITECTURE.md section 15). That is what keeps the dependency
 * pointing one way (`assignments` -> `lessons`): `lessons` reads the counts and never the table.
 *
 * `countConfirmedStaff` takes ids of lessons and answers ONE entry per lesson that has someone
 * confirmed; a lesson with nobody is left out of the map, and the caller reads it as
 * `NO_CONFIRMED_STAFF`. It is meant to be called once per page of lessons, not once per lesson.
 * Pass the `manager` of a transaction to read inside it.
 */
export interface LessonStaffCounter {
  countConfirmedStaff(
    lessonIds: readonly string[],
    manager?: EntityManager,
  ): Promise<Map<string, ConfirmedStaffCount>>;
}

/**
 * The coverage of a lesson (F5.4), as the response shows it: the confirmed teacher against the one
 * that is expected, the confirmed monitors against `expectedMonitors`, and whether the monitors fall
 * short.
 *
 * `belowExpectedMonitors` is true only for a lesson that still happens (not `cancelled`), that says
 * how many monitors it expects (`expectedMonitors` is not null: null means "not informed", so nothing
 * is missing) and that has fewer confirmed monitors than that. The teacher is not part of it: a
 * lesson without a teacher reads in `coverage.teacher`. Pending assignments never count.
 */
export function toLessonCoverage(
  lesson: Pick<Lesson, "status" | "expectedMonitors">,
  staff: ConfirmedStaffCount,
): { coverage: LessonCoverageDto; belowExpectedMonitors: boolean } {
  // Missing (undefined) on an entity that was just inserted, not loaded.
  const expectedMonitors = lesson.expectedMonitors ?? null;

  return {
    coverage: {
      teacher: { confirmed: staff.teachers, expected: EXPECTED_TEACHERS },
      monitors: { confirmed: staff.monitors, expected: expectedMonitors },
    },
    belowExpectedMonitors:
      lesson.status !== LessonStatus.CANCELLED &&
      expectedMonitors !== null &&
      staff.monitors < expectedMonitors,
  };
}
