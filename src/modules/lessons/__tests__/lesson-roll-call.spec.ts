import "reflect-metadata";
import { EntityManager } from "typeorm";
import { LessonStatus } from "../enums/lesson-status.enum";
import {
  hasLessonEnded,
  isAttendancePending,
  LessonRollCallCounter,
  NO_STUDENT_ROLL_CALL,
  rollCallLessonOf,
  toLessonAttendance,
} from "../services/lesson-roll-call";
import { LessonRollCallRegistry } from "../services/lesson-roll-call.registry";

/** 11:00 of 2026-03-10 in America/Sao_Paulo (UTC-3). */
const AT_ELEVEN = new Date("2026-03-10T14:00:00.000Z");

/** A lesson of 09:00 to 11:00 of 2026-03-10, not cancelled. */
function lessonOf(
  overrides: Partial<{ status: LessonStatus; date: string; endTime: string }> = {},
) {
  return { status: LessonStatus.PLANNED, date: "2026-03-10", endTime: "11:00", ...overrides };
}

describe("hasLessonEnded", () => {
  it("is true for a lesson of a day before today in America/Sao_Paulo", () => {
    expect(hasLessonEnded({ date: "2026-03-09", endTime: "23:59" }, AT_ELEVEN)).toBe(true);
    expect(hasLessonEnded({ date: "2025-12-31", endTime: "08:00" }, AT_ELEVEN)).toBe(true);
  });

  it("is true on the day of the lesson from its endTime on, endTime included", () => {
    expect(hasLessonEnded({ date: "2026-03-10", endTime: "11:00" }, AT_ELEVEN)).toBe(true);
    expect(hasLessonEnded({ date: "2026-03-10", endTime: "10:59" }, AT_ELEVEN)).toBe(true);
  });

  it("is false before the endTime of today and for a lesson after today", () => {
    expect(hasLessonEnded({ date: "2026-03-10", endTime: "11:01" }, AT_ELEVEN)).toBe(false);
    expect(hasLessonEnded({ date: "2026-03-11", endTime: "08:00" }, AT_ELEVEN)).toBe(false);
  });

  it("uses the day in São Paulo, not in UTC: 01:30Z of the 11th is still the 10th", () => {
    // 22:30 of the 10th in São Paulo: a lesson of the 11th has not even started.
    const lateEvening = new Date("2026-03-11T01:30:00.000Z");

    expect(hasLessonEnded({ date: "2026-03-11", endTime: "08:00" }, lateEvening)).toBe(false);
    expect(hasLessonEnded({ date: "2026-03-10", endTime: "22:30" }, lateEvening)).toBe(true);
    expect(hasLessonEnded({ date: "2026-03-10", endTime: "23:00" }, lateEvening)).toBe(false);
  });
});

describe("isAttendancePending", () => {
  it("is true for an ended lesson that is not cancelled with fewer signed than total", () => {
    expect(isAttendancePending(lessonOf(), { total: 3, signed: 2 }, AT_ELEVEN)).toBe(true);
    expect(
      isAttendancePending(lessonOf({ date: "2026-03-03" }), { total: 1, signed: 0 }, AT_ELEVEN),
    ).toBe(true);
  });

  it.each([
    ["cancelled", lessonOf({ status: LessonStatus.CANCELLED }), { total: 3, signed: 0 }],
    ["not ended", lessonOf({ endTime: "11:30" }), { total: 3, signed: 0 }],
    ["no students", lessonOf(), { total: 0, signed: 0 }],
    ["complete", lessonOf(), { total: 3, signed: 3 }],
  ])("is false for a %s lesson", (_label, lesson, count) => {
    expect(isAttendancePending(lesson, count, AT_ELEVEN)).toBe(false);
  });

  it("reads a lesson without a counter (NO_STUDENT_ROLL_CALL) as not pending", () => {
    expect(isAttendancePending(lessonOf(), NO_STUDENT_ROLL_CALL, AT_ELEVEN)).toBe(false);
  });
});

describe("toLessonAttendance", () => {
  it("answers students { total, signed } and pending", () => {
    expect(toLessonAttendance(lessonOf(), { total: 3, signed: 1 }, AT_ELEVEN)).toEqual({
      students: { total: 3, signed: 1 },
      pending: true,
    });
    expect(
      toLessonAttendance(lessonOf({ date: "2026-03-17" }), { total: 3, signed: 1 }, AT_ELEVEN),
    ).toEqual({ students: { total: 3, signed: 1 }, pending: false });
  });
});

describe("rollCallLessonOf", () => {
  it("hands over only the id, the class, the day and the end of the lesson", () => {
    const lesson = {
      id: "01999a3e-7c1b-7000-8000-0000000000f1",
      classId: "01999a3e-7c1b-7000-8000-0000000000c1",
      date: "2026-03-10",
      endTime: "11:00",
      title: "Not handed over",
      startTime: "09:00",
    };

    expect(rollCallLessonOf(lesson)).toEqual({
      id: lesson.id,
      classId: lesson.classId,
      date: "2026-03-10",
      endTime: "11:00",
    });
  });
});

describe("LessonRollCallRegistry", () => {
  const lessons = [
    {
      id: "01999a3e-7c1b-7000-8000-0000000000f1",
      classId: "01999a3e-7c1b-7000-8000-0000000000c1",
      date: "2026-03-10",
      endTime: "11:00",
    },
  ];

  it("answers an empty map without a counter registered", async () => {
    const registry = new LessonRollCallRegistry();

    await expect(registry.countStudentRollCalls(lessons)).resolves.toEqual(new Map());
  });

  it("delegates to the counter with the lessons and the manager", async () => {
    const registry = new LessonRollCallRegistry();
    const counts = new Map([[lessons[0].id, { total: 2, signed: 1 }]]);
    const counter: LessonRollCallCounter = {
      countStudentRollCalls: jest.fn().mockResolvedValue(counts),
    };
    const manager = {} as EntityManager;
    registry.register(counter);

    await expect(registry.countStudentRollCalls(lessons, manager)).resolves.toBe(counts);
    expect(counter.countStudentRollCalls).toHaveBeenCalledWith(lessons, manager);
  });

  it("throws when a second counter registers", () => {
    const registry = new LessonRollCallRegistry();
    const counter: LessonRollCallCounter = { countStudentRollCalls: jest.fn() };
    registry.register(counter);

    expect(() => registry.register(counter)).toThrow("already registered");
  });
});
