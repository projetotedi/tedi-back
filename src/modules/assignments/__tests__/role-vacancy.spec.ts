import { LessonStatus } from "@modules/lessons/services/lessons.service";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { hasOpenPlace, isClosedForApplications, openRolesOf } from "../services/role-vacancy";

function lesson(expectedMonitors: number | null, status = LessonStatus.PLANNED) {
  return { status, expectedMonitors };
}

describe("role-vacancy", () => {
  it.each([
    ["no confirmed teacher", lesson(2), { teachers: 0, monitors: 0 }, true],
    ["a confirmed teacher", lesson(2), { teachers: 1, monitors: 0 }, false],
    [
      "no confirmed teacher, but the lesson is cancelled",
      lesson(2, LessonStatus.CANCELLED),
      { teachers: 0, monitors: 0 },
      false,
    ],
    [
      "no confirmed teacher, a lesson that expects no monitors",
      lesson(null),
      { teachers: 0, monitors: 0 },
      true,
    ],
  ])(
    "opens a teacher place only while the lesson has no confirmed teacher: %s",
    (_case, forLesson, staff, open) => {
      expect(hasOpenPlace(AssignmentRole.TEACHER, forLesson, staff)).toBe(open);
    },
  );

  it.each([
    ["2 expected, 1 confirmed", lesson(2), 1, true],
    ["2 expected, 0 confirmed", lesson(2), 0, true],
    ["2 expected, 2 confirmed", lesson(2), 2, false],
    ["2 expected, 3 confirmed", lesson(2), 3, false],
    ["null expected (not informed: nothing is expected)", lesson(null), 0, false],
    ["0 expected", lesson(0), 0, false],
    [
      "2 expected, 0 confirmed, but the lesson is cancelled",
      lesson(2, LessonStatus.CANCELLED),
      0,
      false,
    ],
  ])(
    "opens a monitor place only below expectedMonitors: %s",
    (_case, forLesson, monitors, open) => {
      expect(hasOpenPlace(AssignmentRole.MONITOR, forLesson, { teachers: 1, monitors })).toBe(open);
    },
  );

  it("does not look at the other role: a confirmed teacher leaves the monitors open, and full monitors leave the teacher open", () => {
    expect(hasOpenPlace(AssignmentRole.MONITOR, lesson(2), { teachers: 1, monitors: 1 })).toBe(
      true,
    );
    expect(hasOpenPlace(AssignmentRole.TEACHER, lesson(2), { teachers: 0, monitors: 2 })).toBe(
      true,
    );
  });

  it("throws for a role it does not know, instead of answering a place", () => {
    expect(() =>
      hasOpenPlace("director" as AssignmentRole, lesson(2), { teachers: 0, monitors: 0 }),
    ).toThrow("Unknown assignment role: director.");
  });

  it.each([
    ["a planned lesson of yesterday", "2026-03-08", LessonStatus.PLANNED, true],
    ["a planned lesson of today", "2026-03-09", LessonStatus.PLANNED, false],
    ["a confirmed lesson of today", "2026-03-09", LessonStatus.CONFIRMED, false],
    ["a lesson of today already marked done", "2026-03-09", LessonStatus.DONE, true],
    ["a later lesson marked done ahead of time", "2026-03-17", LessonStatus.DONE, true],
    ["a later planned lesson", "2026-03-17", LessonStatus.PLANNED, false],
  ])(
    "closes a lesson for applications when it is before today or done: %s",
    (_case, date, status, closed) => {
      expect(isClosedForApplications({ date, status }, "2026-03-09")).toBe(closed);
    },
  );

  it("lists the open roles in a fixed order: teacher, then monitor", () => {
    expect(openRolesOf(lesson(3), { teachers: 0, monitors: 2 })).toEqual([
      AssignmentRole.TEACHER,
      AssignmentRole.MONITOR,
    ]);
    expect(openRolesOf(lesson(2), { teachers: 1, monitors: 0 })).toEqual([AssignmentRole.MONITOR]);
    expect(openRolesOf(lesson(null), { teachers: 0, monitors: 0 })).toEqual([
      AssignmentRole.TEACHER,
    ]);
  });

  it("answers [] for a full lesson", () => {
    expect(openRolesOf(lesson(2), { teachers: 1, monitors: 2 })).toEqual([]);
    expect(openRolesOf(lesson(null), { teachers: 1, monitors: 0 })).toEqual([]);
    expect(openRolesOf(lesson(2, LessonStatus.CANCELLED), { teachers: 0, monitors: 0 })).toEqual(
      [],
    );
  });
});
