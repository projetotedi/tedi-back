import "reflect-metadata";
import { LessonPlanContent } from "../entities/lesson-plan-content.entity";
import {
  CourseLessonPlanRow,
  toCourseLessonPlansResponse,
} from "../services/course-lesson-plans-response.mapper";

const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000009";
const FIRST_PLAN_ID = "01999a3e-7c1b-7000-8000-000000000001";
const SECOND_PLAN_ID = "01999a3e-7c1b-7000-8000-000000000002";
const THIRD_PLAN_ID = "01999a3e-7c1b-7000-8000-000000000003";
const ARCHIVED_AT = new Date("2026-10-10T12:00:00.000Z");

function buildRow(overrides: Partial<CourseLessonPlanRow> = {}): CourseLessonPlanRow {
  return {
    position: 1,
    lessonPlanId: FIRST_PLAN_ID,
    title: "Teclado, mouse e janelas",
    expectedDurationMinutes: 90,
    materialUrl: null,
    archivedAt: null,
    courseCount: 1,
    ...overrides,
  };
}

function buildContent(lessonPlanId: string, position: number, text: string): LessonPlanContent {
  return Object.assign(new LessonPlanContent(), {
    id: `${lessonPlanId}-${position}`,
    lessonPlanId,
    position,
    text,
  });
}

describe("toCourseLessonPlansResponse()", () => {
  it("sums 90, 120 and 60 into plannedWorkloadMinutes 270", () => {
    const rows = [
      buildRow({ position: 1, lessonPlanId: FIRST_PLAN_ID, expectedDurationMinutes: 90 }),
      buildRow({ position: 2, lessonPlanId: SECOND_PLAN_ID, expectedDurationMinutes: 120 }),
      buildRow({ position: 3, lessonPlanId: THIRD_PLAN_ID, expectedDurationMinutes: 60 }),
    ];

    const result = toCourseLessonPlansResponse(COURSE_ID, rows, []);

    expect(result.plannedWorkloadMinutes).toBe(270);
    expect(result.courseId).toBe(COURSE_ID);
    expect(result.items).toHaveLength(3);
  });

  it("answers plannedWorkloadMinutes 0 for an empty sequence", () => {
    const result = toCourseLessonPlansResponse(COURSE_ID, [], []);

    expect(result).toEqual({ courseId: COURSE_ID, plannedWorkloadMinutes: 0, items: [] });
  });

  it("counts an archived plan that stayed in the sequence", () => {
    const rows = [
      buildRow({ position: 1, expectedDurationMinutes: 90, archivedAt: ARCHIVED_AT }),
      buildRow({ position: 2, lessonPlanId: SECOND_PLAN_ID, expectedDurationMinutes: 60 }),
    ];

    const result = toCourseLessonPlansResponse(COURSE_ID, rows, []);

    expect(result.plannedWorkloadMinutes).toBe(150);
    expect(result.items[0].archivedAt).toEqual(ARCHIVED_AT);
    expect(result.items[1].archivedAt).toBeNull();
  });

  it("groups the contents by plan in position order", () => {
    const rows = [
      buildRow({ position: 1, lessonPlanId: FIRST_PLAN_ID }),
      buildRow({ position: 2, lessonPlanId: SECOND_PLAN_ID, title: "Pastas e arquivos" }),
    ];
    // Out of order on purpose: by plan and by position.
    const contents = [
      buildContent(SECOND_PLAN_ID, 1, "Copiar e mover"),
      buildContent(FIRST_PLAN_ID, 1, "Janelas do sistema"),
      buildContent(SECOND_PLAN_ID, 0, "Criar pastas"),
      buildContent(FIRST_PLAN_ID, 0, "Teclado e mouse"),
      buildContent(FIRST_PLAN_ID, 2, "Menu iniciar"),
    ];

    const result = toCourseLessonPlansResponse(COURSE_ID, rows, contents);

    expect(result.items[0].contents).toEqual([
      "Teclado e mouse",
      "Janelas do sistema",
      "Menu iniciar",
    ]);
    expect(result.items[1].contents).toEqual(["Criar pastas", "Copiar e mover"]);
  });

  it("answers no contents for a plan that has none, and ignores the contents of plans outside the sequence", () => {
    const rows = [buildRow({ position: 1, lessonPlanId: FIRST_PLAN_ID })];
    const contents = [buildContent(THIRD_PLAN_ID, 0, "Outro plano")];

    const result = toCourseLessonPlansResponse(COURSE_ID, rows, contents);

    expect(result.items[0].contents).toEqual([]);
  });

  it("keeps the items in the order of position", () => {
    const rows = [
      buildRow({ position: 3, lessonPlanId: THIRD_PLAN_ID, title: "Terceiro" }),
      buildRow({ position: 1, lessonPlanId: FIRST_PLAN_ID, title: "Primeiro" }),
      buildRow({ position: 2, lessonPlanId: SECOND_PLAN_ID, title: "Segundo" }),
    ];

    const result = toCourseLessonPlansResponse(COURSE_ID, rows, []);

    expect(result.items.map((item) => [item.position, item.title])).toEqual([
      [1, "Primeiro"],
      [2, "Segundo"],
      [3, "Terceiro"],
    ]);
  });

  it("copies position, title, duration, material link, courseCount and archivedAt of each row", () => {
    const row = buildRow({
      position: 2,
      lessonPlanId: SECOND_PLAN_ID,
      title: "Pastas e arquivos",
      expectedDurationMinutes: 120,
      materialUrl: "https://drive.google.com/file/d/exemplo/view",
      courseCount: 3,
      archivedAt: ARCHIVED_AT,
    });

    const result = toCourseLessonPlansResponse(
      COURSE_ID,
      [row],
      [buildContent(SECOND_PLAN_ID, 0, "Criar pastas")],
    );

    expect(result.items).toEqual([
      {
        position: 2,
        lessonPlanId: SECOND_PLAN_ID,
        title: "Pastas e arquivos",
        contents: ["Criar pastas"],
        expectedDurationMinutes: 120,
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        courseCount: 3,
        archivedAt: ARCHIVED_AT,
      },
    ]);
    expect(Object.keys(result.items[0]).sort()).toEqual([
      "archivedAt",
      "contents",
      "courseCount",
      "expectedDurationMinutes",
      "lessonPlanId",
      "materialUrl",
      "position",
      "title",
    ]);
  });

  it("does not change the lists it receives", () => {
    const rows = [
      buildRow({ position: 2, lessonPlanId: SECOND_PLAN_ID }),
      buildRow({ position: 1, lessonPlanId: FIRST_PLAN_ID }),
    ];
    const contents = [
      buildContent(FIRST_PLAN_ID, 1, "Segundo"),
      buildContent(FIRST_PLAN_ID, 0, "Primeiro"),
    ];

    toCourseLessonPlansResponse(COURSE_ID, rows, contents);

    expect(rows.map((row) => row.position)).toEqual([2, 1]);
    expect(contents.map((content) => content.position)).toEqual([1, 0]);
  });
});
