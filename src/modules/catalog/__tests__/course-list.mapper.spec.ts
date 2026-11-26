import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import {
  CourseListRow,
  groupPrerequisites,
  toCourseListItem,
} from "../services/course-list.mapper";

const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");

function row(overrides: Partial<CourseListRow> = {}): CourseListRow {
  return {
    id: "course-1",
    name: "Informática Intermediária",
    category: CourseCategory.INTERMEDIATE,
    archivedAt: null,
    createdAt: CREATED_AT,
    lessonPlanCount: 2,
    plannedWorkloadMinutes: 210,
    ...overrides,
  };
}

describe("groupPrerequisites()", () => {
  it("groups the links by course and orders each list by name, in pt-BR", () => {
    const grouped = groupPrerequisites([
      { courseId: "course-1", id: "p-2", name: "Smartphones" },
      { courseId: "course-2", id: "p-1", name: "Informática Básica" },
      { courseId: "course-1", id: "p-1", name: "Informática Básica" },
      { courseId: "course-1", id: "p-3", name: "Ética digital" },
    ]);

    expect(grouped.get("course-1")).toEqual([
      { id: "p-3", name: "Ética digital" },
      { id: "p-1", name: "Informática Básica" },
      { id: "p-2", name: "Smartphones" },
    ]);
    expect(grouped.get("course-2")).toEqual([{ id: "p-1", name: "Informática Básica" }]);
    expect(grouped.get("course-3")).toBeUndefined();
  });

  it("answers an empty map for no links", () => {
    expect(groupPrerequisites([]).size).toBe(0);
  });
});

describe("toCourseListItem()", () => {
  it("maps the row and derives status active from a null archivedAt", () => {
    const prerequisites = [{ id: "p-1", name: "Informática Básica" }];

    expect(toCourseListItem(row(), prerequisites)).toEqual({
      id: "course-1",
      name: "Informática Intermediária",
      category: CourseCategory.INTERMEDIATE,
      status: CourseStatus.ACTIVE,
      lessonPlanCount: 2,
      plannedWorkloadMinutes: 210,
      prerequisites,
      createdAt: CREATED_AT,
    });
  });

  it("derives status archived when archivedAt is set", () => {
    const item = toCourseListItem(row({ archivedAt: new Date() }), []);

    expect(item.status).toBe(CourseStatus.ARCHIVED);
    expect(item.prerequisites).toEqual([]);
  });

  it("does not share the array of prerequisites it received", () => {
    const prerequisites = [{ id: "p-1", name: "Informática Básica" }];

    const item = toCourseListItem(row(), prerequisites);
    item.prerequisites.push({ id: "p-2", name: "Smartphones" });

    expect(prerequisites).toHaveLength(1);
  });
});
