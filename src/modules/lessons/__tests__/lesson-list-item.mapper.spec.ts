import "reflect-metadata";
import { ClassRef } from "@modules/classes/services/classes.service";
import { LESSON_CALENDAR_COLOR_COUNT } from "../dto/lesson-limits";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";
import { calendarColorIndex, toLessonListItem } from "../services/lesson-list-item.mapper";

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const PLAN_ID = "01999a3e-7c1b-7000-8000-000000000011";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";

function buildLesson(overrides: Partial<Lesson> = {}): Lesson {
  return Object.assign(new Lesson(), {
    id: LESSON_ID,
    classId: CLASS_ID,
    lessonPlanId: null,
    sequenceOrder: null,
    title: "Teclado, mouse e janelas",
    objective: null,
    date: "2026-03-10",
    startTime: "14:00",
    endTime: "15:30",
    location: null,
    expectedStudents: null,
    expectedMonitors: null,
    subject: null,
    postNotes: null,
    status: LessonStatus.PLANNED,
    cancelReason: null,
    cancelledAt: null,
    cancelledById: null,
    originalDate: null,
    rescheduleReason: null,
    rescheduleNote: null,
    createdById: ACTOR_ID,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-02T12:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  });
}

function buildClassRef(overrides: Partial<ClassRef> = {}): ClassRef {
  return {
    id: CLASS_ID,
    code: "INFO-A",
    name: "Informática Básica, turma A",
    courseId: COURSE_ID,
    archivedAt: null,
    creationRank: 1,
    ...overrides,
  };
}

describe("calendarColorIndex", () => {
  it("starts at slot 0 for the first class and goes up by one", () => {
    expect(calendarColorIndex(1)).toBe(0);
    expect(calendarColorIndex(2)).toBe(1);
    expect(calendarColorIndex(3)).toBe(2);
  });

  it("gives rank 8 the last slot and rank 9 the first again", () => {
    expect(LESSON_CALENDAR_COLOR_COUNT).toBe(8);
    expect(calendarColorIndex(8)).toBe(7);
    expect(calendarColorIndex(9)).toBe(0);
    expect(calendarColorIndex(16)).toBe(7);
    expect(calendarColorIndex(17)).toBe(0);
  });

  it("stays between 0 and the number of slots minus 1 for any rank", () => {
    for (let rank = 1; rank <= 500; rank += 1) {
      const slot = calendarColorIndex(rank);

      expect(Number.isInteger(slot)).toBe(true);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThanOrEqual(LESSON_CALENDAR_COLOR_COUNT - 1);
    }
  });

  it("gives the classes created one after the other different slots until the slots run out", () => {
    const slots = Array.from({ length: LESSON_CALENDAR_COLOR_COUNT }, (_, index) =>
      calendarColorIndex(index + 1),
    );

    expect(new Set(slots).size).toBe(LESSON_CALENDAR_COLOR_COUNT);
  });

  it("throws for a rank that cannot come from a ROW_NUMBER: below 1, not an integer or not a number", () => {
    for (const broken of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calendarColorIndex(broken)).toThrow("starts at 1");
    }
  });
});

describe("toLessonListItem", () => {
  it("builds the item from the lesson and the class", () => {
    const item = toLessonListItem(buildLesson(), buildClassRef({ creationRank: 2 }));

    expect(item).toEqual({
      id: LESSON_ID,
      class: {
        id: CLASS_ID,
        code: "INFO-A",
        name: "Informática Básica, turma A",
        colorIndex: 1,
      },
      date: "2026-03-10",
      startTime: "14:00",
      endTime: "15:30",
      title: "Teclado, mouse e janelas",
      status: LessonStatus.PLANNED,
      teacher: null,
      belowExpectedMonitors: false,
    });
  });

  it("shows the code as the name of a class that has no name", () => {
    const item = toLessonListItem(buildLesson(), buildClassRef({ name: null }));

    expect(item.class.name).toBe("INFO-A");
    expect(item.class.code).toBe("INFO-A");
  });

  it("keeps the name of a class that has one, and never answers a null name", () => {
    expect(
      toLessonListItem(buildLesson(), buildClassRef({ name: "Turma da manhã" })).class.name,
    ).toBe("Turma da manhã");
    expect(
      toLessonListItem(buildLesson(), buildClassRef({ name: null })).class.name,
    ).not.toBeNull();
  });

  it("derives the color from the creation rank of the class: ranks 1, 8 and 9 give 0, 7 and 0", () => {
    const colorOf = (creationRank: number) =>
      toLessonListItem(buildLesson(), buildClassRef({ creationRank })).class.colorIndex;

    expect(colorOf(1)).toBe(0);
    expect(colorOf(8)).toBe(7);
    expect(colorOf(9)).toBe(0);
  });

  it("answers teacher as null: there is no allocation yet", () => {
    expect(toLessonListItem(buildLesson(), buildClassRef()).teacher).toBeNull();
  });

  it("answers belowExpectedMonitors as false, even for a lesson that expects monitors", () => {
    const item = toLessonListItem(
      buildLesson({ expectedMonitors: 3, expectedStudents: 15 }),
      buildClassRef(),
    );

    expect(item.belowExpectedMonitors).toBe(false);
  });

  it("copies the status of the lesson, the cancelled one included", () => {
    for (const status of Object.values(LessonStatus)) {
      const cancelled =
        status === LessonStatus.CANCELLED
          ? { cancelledAt: new Date("2026-03-09T12:00:00.000Z"), cancelledById: ACTOR_ID }
          : {};

      expect(toLessonListItem(buildLesson({ status, ...cancelled }), buildClassRef()).status).toBe(
        status,
      );
    }
  });

  it("copies the day and the times as the entity carries them: YYYY-MM-DD and HH:mm", () => {
    const item = toLessonListItem(
      buildLesson({ date: "2026-12-31", startTime: "08:05", endTime: "10:45" }),
      buildClassRef(),
    );

    expect(item.date).toBe("2026-12-31");
    expect(item.startTime).toBe("08:05");
    expect(item.endTime).toBe("10:45");
  });

  it("carries only what the row shows: none of the other fields of the lesson or of the class", () => {
    const item = toLessonListItem(
      buildLesson({
        lessonPlanId: PLAN_ID,
        sequenceOrder: 1,
        objective: "Familiarizar o aluno com o teclado.",
        location: "Laboratório 3",
        subject: "Primeiro contato",
        postNotes: "A turma terminou antes do previsto.",
        originalDate: "2026-03-03",
        rescheduleReason: "Laboratório em manutenção.",
      }),
      buildClassRef({ archivedAt: new Date("2026-06-30T12:00:00.000Z") }),
    );

    expect(Object.keys(item).sort()).toEqual([
      "belowExpectedMonitors",
      "class",
      "date",
      "endTime",
      "id",
      "startTime",
      "status",
      "teacher",
      "title",
    ]);
    expect(Object.keys(item.class).sort()).toEqual(["code", "colorIndex", "id", "name"]);
  });

  it("throws for a class with a rank that cannot be", () => {
    expect(() => toLessonListItem(buildLesson(), buildClassRef({ creationRank: 0 }))).toThrow(
      "starts at 1",
    );
  });
});
