import "reflect-metadata";
import { ClassSummary } from "@modules/classes/services/classes.service";
import { CourseSummary } from "@modules/catalog/services/courses.service";
import { LessonPlanSummary } from "@modules/catalog/services/lesson-plans.service";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";
import { LessonRefs, toLessonResponse } from "../services/lesson-response.mapper";

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const EDITION_ID = "01999a3e-7c1b-7000-8000-0000000000e1";
const PLAN_ID = "01999a3e-7c1b-7000-8000-000000000011";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const CREATED_AT = new Date("2026-03-01T12:00:00.000Z");
const UPDATED_AT = new Date("2026-03-02T12:00:00.000Z");

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
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  });
}

function buildRefs(overrides: Partial<LessonRefs> = {}): LessonRefs {
  const schoolClass: ClassSummary = {
    id: CLASS_ID,
    code: "INFO-A",
    name: "Informática Básica, turma A",
    courseId: COURSE_ID,
    edition: { id: EDITION_ID, name: "2026.1" },
    startDate: "2026-03-03",
    endDate: "2026-06-27",
    // The enum belongs to the classes module: the test takes the type from the contract.
    status: "in_progress" as ClassSummary["status"],
    archivedAt: null,
  };
  const course: CourseSummary = {
    id: COURSE_ID,
    name: "Informática Básica",
    category: "basic",
    status: "active",
  } as unknown as CourseSummary;

  return { schoolClass, course, lessonPlan: null, ...overrides };
}

describe("toLessonResponse", () => {
  it("computes durationMinutes from the two times", () => {
    expect(toLessonResponse(buildLesson(), buildRefs()).durationMinutes).toBe(90);
    expect(
      toLessonResponse(buildLesson({ startTime: "08:00", endTime: "08:45" }), buildRefs())
        .durationMinutes,
    ).toBe(45);
    expect(
      toLessonResponse(buildLesson({ startTime: "00:00", endTime: "23:59" }), buildRefs())
        .durationMinutes,
    ).toBe(1439);
    expect(
      toLessonResponse(buildLesson({ startTime: "13:50", endTime: "14:10" }), buildRefs())
        .durationMinutes,
    ).toBe(20);
  });

  it("lessonPlan is null without origin", () => {
    const response = toLessonResponse(buildLesson(), buildRefs({ lessonPlan: null }));

    expect(response.lessonPlan).toBeNull();
    expect(response.sequenceOrder).toBeNull();
  });

  it("maps class, course and edition refs", () => {
    const response = toLessonResponse(buildLesson(), buildRefs());

    expect(response.class).toEqual({
      id: CLASS_ID,
      code: "INFO-A",
      name: "Informática Básica, turma A",
      startDate: "2026-03-03",
      endDate: "2026-06-27",
      archivedAt: null,
    });
    expect(response.course).toEqual({ id: COURSE_ID, name: "Informática Básica" });
    expect(response.edition).toEqual({ id: EDITION_ID, name: "2026.1" });
  });

  it("shows only the id and the name of the course, and only the id and the name of the edition", () => {
    const response = toLessonResponse(buildLesson(), buildRefs());

    expect(Object.keys(response.course).sort()).toEqual(["id", "name"]);
    expect(Object.keys(response.edition).sort()).toEqual(["id", "name"]);
    expect(Object.keys(response.class).sort()).toEqual([
      "archivedAt",
      "code",
      "endDate",
      "id",
      "name",
      "startDate",
    ]);
  });

  it("maps the lesson plan of origin, archived or not, with the title it has now", () => {
    const plan: LessonPlanSummary = {
      id: PLAN_ID,
      title: "Título atual do plano",
      objective: "Objetivo do plano.",
      expectedDurationMinutes: 90,
      archivedAt: null,
    };

    const active = toLessonResponse(
      buildLesson({ lessonPlanId: PLAN_ID, sequenceOrder: 2 }),
      buildRefs({ lessonPlan: plan }),
    );
    expect(active.lessonPlan).toEqual({
      id: PLAN_ID,
      title: "Título atual do plano",
      archivedAt: null,
    });
    expect(active.sequenceOrder).toBe(2);
    // The title of the lesson is its own copy, not the one of the plan (RN-18).
    expect(active.title).toBe("Teclado, mouse e janelas");

    const archivedAt = new Date("2026-04-01T00:00:00.000Z");
    const archived = toLessonResponse(
      buildLesson({ lessonPlanId: PLAN_ID }),
      buildRefs({ lessonPlan: { ...plan, archivedAt } }),
    );
    expect(archived.lessonPlan?.archivedAt).toEqual(archivedAt);
    // Only what the page shows of the plan: not its objective nor its duration.
    expect(Object.keys(archived.lessonPlan ?? {}).sort()).toEqual(["archivedAt", "id", "title"]);
  });

  it("shows an archived class with archivedAt", () => {
    const archivedAt = new Date("2026-04-01T00:00:00.000Z");
    const refs = buildRefs();

    const response = toLessonResponse(buildLesson(), {
      ...refs,
      schoolClass: { ...refs.schoolClass, archivedAt },
    });

    expect(response.class.archivedAt).toEqual(archivedAt);
  });

  it("copies every field of the lesson", () => {
    const cancelledAt = new Date("2026-03-09T12:00:00.000Z");

    const response = toLessonResponse(
      buildLesson({
        lessonPlanId: PLAN_ID,
        sequenceOrder: 1,
        objective: "Familiarizar o aluno com o teclado.",
        date: "2026-03-17",
        startTime: "08:05",
        endTime: "10:45",
        location: "Laboratório 3, bloco B",
        expectedStudents: 15,
        expectedMonitors: 2,
        subject: "Primeiro contato",
        postNotes: "Correu bem.",
        status: LessonStatus.CANCELLED,
        cancelReason: "Feriado municipal.",
        cancelledAt,
        cancelledById: ACTOR_ID,
        originalDate: "2026-03-10",
        rescheduleReason: "Laboratório em manutenção.",
        rescheduleNote: "Avisar a turma.",
      }),
      buildRefs(),
    );

    expect(response).toMatchObject({
      id: LESSON_ID,
      sequenceOrder: 1,
      title: "Teclado, mouse e janelas",
      objective: "Familiarizar o aluno com o teclado.",
      date: "2026-03-17",
      startTime: "08:05",
      endTime: "10:45",
      durationMinutes: 160,
      location: "Laboratório 3, bloco B",
      expectedStudents: 15,
      expectedMonitors: 2,
      subject: "Primeiro contato",
      postNotes: "Correu bem.",
      status: LessonStatus.CANCELLED,
      cancelReason: "Feriado municipal.",
      cancelledAt,
      cancelledById: ACTOR_ID,
      originalDate: "2026-03-10",
      rescheduleReason: "Laboratório em manutenção.",
      rescheduleNote: "Avisar a turma.",
      createdById: ACTOR_ID,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
  });

  it("answers null for the optional columns an inserted entity does not carry", () => {
    const bare = Object.assign(buildLesson(), {
      sequenceOrder: undefined,
      objective: undefined,
      location: undefined,
      expectedStudents: undefined,
      expectedMonitors: undefined,
      subject: undefined,
      postNotes: undefined,
      cancelReason: undefined,
      cancelledAt: undefined,
      cancelledById: undefined,
      originalDate: undefined,
      rescheduleReason: undefined,
      rescheduleNote: undefined,
    });

    const response = toLessonResponse(bare, buildRefs());

    for (const field of [
      "sequenceOrder",
      "objective",
      "location",
      "expectedStudents",
      "expectedMonitors",
      "subject",
      "postNotes",
      "cancelReason",
      "cancelledAt",
      "cancelledById",
      "originalDate",
      "rescheduleReason",
      "rescheduleNote",
    ] as const) {
      expect(response[field]).toBeNull();
    }
  });

  it("keeps a zero head count: 0 is a number, not an absence", () => {
    const response = toLessonResponse(
      buildLesson({ expectedStudents: 0, expectedMonitors: 0 }),
      buildRefs(),
    );

    expect(response.expectedStudents).toBe(0);
    expect(response.expectedMonitors).toBe(0);
  });

  it("exposes no column the contract does not name: not deletedAt, not classId, not lessonPlanId", () => {
    const response = toLessonResponse(buildLesson({ lessonPlanId: PLAN_ID }), buildRefs());

    expect(response).not.toHaveProperty("deletedAt");
    expect(response).not.toHaveProperty("classId");
    expect(response).not.toHaveProperty("lessonPlanId");
  });
});
