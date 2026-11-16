import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";
import { lessonCreatedPayload } from "../services/lesson-audit";

function buildLesson(overrides: Partial<Lesson> = {}): Lesson {
  return Object.assign(new Lesson(), {
    id: "01999a3e-7c1b-7000-8000-0000000000f1",
    classId: "01999a3e-7c1b-7000-8000-0000000000c1",
    lessonPlanId: "01999a3e-7c1b-7000-8000-000000000011",
    sequenceOrder: 2,
    title: "Teclado, mouse e janelas",
    objective: "Familiarizar o aluno com o teclado.",
    date: "2026-04-14",
    startTime: "09:00",
    endTime: "11:00",
    location: "Laboratório 2 — Bloco B",
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
    createdById: "01999a3e-0000-7000-8000-0000000000aa",
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  });
}

describe("lessonCreatedPayload", () => {
  it("says what the lesson is: the class, the plan, the position, the text, the day, the time, the place and the status", () => {
    expect(lessonCreatedPayload(buildLesson())).toEqual({
      classId: "01999a3e-7c1b-7000-8000-0000000000c1",
      lessonPlanId: "01999a3e-7c1b-7000-8000-000000000011",
      sequenceOrder: 2,
      title: "Teclado, mouse e janelas",
      objective: "Familiarizar o aluno com o teclado.",
      date: "2026-04-14",
      startTime: "09:00",
      endTime: "11:00",
      location: "Laboratório 2 — Bloco B",
      expectedStudents: null,
      expectedMonitors: null,
      subject: null,
      status: LessonStatus.PLANNED,
    });
  });

  it("carries the optional fields a lesson on its own has, as null", () => {
    const payload = lessonCreatedPayload(
      buildLesson({ lessonPlanId: null, sequenceOrder: null, objective: null, location: null }),
    );

    expect(payload).toMatchObject({
      lessonPlanId: null,
      sequenceOrder: null,
      objective: null,
      location: null,
    });
  });

  it("never carries the free text written after the fact, nor the audit columns (RNF-13)", () => {
    const payload = lessonCreatedPayload(
      buildLesson({
        postNotes: "Texto livre.",
        cancelReason: "Texto livre.",
        rescheduleReason: "Texto livre.",
        rescheduleNote: "Texto livre.",
      }),
    );

    for (const field of [
      "id",
      "postNotes",
      "cancelReason",
      "cancelledAt",
      "cancelledById",
      "originalDate",
      "rescheduleReason",
      "rescheduleNote",
      "createdById",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ]) {
      expect(payload).not.toHaveProperty(field);
    }
  });
});
