import { CourseCategory, CourseStatus } from "@modules/catalog/services/courses.service";
import { ClassStatus } from "../enums/class-status.enum";
import { ClassListRow, toClassListItem } from "../services/class-list.mapper";

const ROW: ClassListRow = {
  id: "class-1",
  code: "INFO-A",
  name: null,
  courseId: "course-1",
  editionId: "edition-1",
  editionName: "2026.1",
  startDate: "2026-03-03",
  endDate: "2026-06-27",
  capacity: 15,
  status: ClassStatus.PLANNED,
  archivedAt: null,
};

const COURSE = {
  id: "course-1",
  name: "Informática Básica",
  category: CourseCategory.BASIC,
  status: CourseStatus.ACTIVE,
};

describe("toClassListItem()", () => {
  it("answers exactly the fields of the line, with the course and the enrollments it is given", () => {
    const item = toClassListItem(ROW, COURSE, 12);

    expect(item).toEqual({
      id: "class-1",
      code: "INFO-A",
      name: null,
      course: COURSE,
      edition: { id: "edition-1", name: "2026.1" },
      startDate: "2026-03-03",
      endDate: "2026-06-27",
      enrolledCount: 12,
      capacity: 15,
      status: ClassStatus.PLANNED,
      archivedAt: null,
    });
    expect(item).not.toHaveProperty("courseId");
  });

  it("copies the course field by field", () => {
    const course = { ...COURSE, extra: "not part of the contract" };

    expect(toClassListItem(ROW, course, 0).course).toEqual(COURSE);
  });
});
