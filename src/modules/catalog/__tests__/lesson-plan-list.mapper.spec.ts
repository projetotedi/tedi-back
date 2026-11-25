import { LessonPlanListStatus } from "../enums/lesson-plan-list.enums";
import {
  groupContents,
  lessonPlanListStatus,
  toLessonPlanListItem,
} from "../services/lesson-plan-list.mapper";

const UPDATED_AT = new Date("2026-10-01T12:00:00.000Z");
const ARCHIVED_AT = new Date("2026-10-02T12:00:00.000Z");

describe("lesson-plan-list.mapper", () => {
  it.each([
    [null, 0, LessonPlanListStatus.UNUSED],
    [null, 2, LessonPlanListStatus.IN_USE],
    [ARCHIVED_AT, 0, LessonPlanListStatus.ARCHIVED],
    [ARCHIVED_AT, 3, LessonPlanListStatus.ARCHIVED],
  ])("archivedAt %p and %p courses is %s", (archivedAt, courseCount, status) => {
    expect(lessonPlanListStatus(archivedAt, courseCount)).toBe(status);
  });

  it("groups the contents by plan, keeping their order", () => {
    const grouped = groupContents([
      { lessonPlanId: "a", text: "Teclado" },
      { lessonPlanId: "b", text: "Senhas" },
      { lessonPlanId: "a", text: "Mouse" },
    ]);

    expect(grouped.get("a")).toEqual(["Teclado", "Mouse"]);
    expect(grouped.get("b")).toEqual(["Senhas"]);
  });

  it("maps a row, reading a count that came as a string", () => {
    expect(
      toLessonPlanListItem(
        {
          id: "a",
          title: "Teclado",
          expectedDurationMinutes: 90,
          materialUrl: null,
          courseCount: "2" as unknown as number,
          archivedAt: null,
          updatedAt: UPDATED_AT,
        },
        ["Teclado"],
      ),
    ).toEqual({
      id: "a",
      title: "Teclado",
      contents: ["Teclado"],
      expectedDurationMinutes: 90,
      materialUrl: null,
      courseCount: 2,
      status: LessonPlanListStatus.IN_USE,
      archivedAt: null,
      updatedAt: UPDATED_AT,
    });
  });
});
