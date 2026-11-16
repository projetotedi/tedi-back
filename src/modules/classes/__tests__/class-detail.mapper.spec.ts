import "reflect-metadata";
import {
  CourseCategory,
  CourseStatus,
  CourseSummary,
} from "@modules/catalog/services/courses.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import { SchoolClass } from "../entities/class.entity";
import { Edition } from "../entities/edition.entity";
import { ClassStatus } from "../enums/class-status.enum";
import { ClassDetailInput, toClassDetail } from "../services/class-detail.mapper";
import { ActiveEnrollmentPreviewRow } from "../services/enrollment-counts.service";

const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
const ARCHIVED_AT = new Date("2026-10-10T12:00:00.000Z");

const CREATOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const EDITION_ID = "01999a3e-7c1b-7000-8000-0000000000e1";
const STUDENT_A_ID = "01999a3e-7c1b-7000-8000-0000000000a1";
const STUDENT_B_ID = "01999a3e-7c1b-7000-8000-0000000000a2";
const STUDENT_C_ID = "01999a3e-7c1b-7000-8000-0000000000a3";

type ClassOverrides = Partial<Omit<SchoolClass, "archive">> & {
  archive?: Partial<ArchivableColumns>;
};

function buildClass(overrides: ClassOverrides = {}): SchoolClass {
  const { archive, ...rest } = overrides;
  return Object.assign(new SchoolClass(), {
    id: CLASS_ID,
    code: "INFO-A",
    name: null,
    courseId: COURSE_ID,
    editionId: EDITION_ID,
    startDate: "2026-03-03",
    endDate: "2026-06-27",
    location: null,
    capacity: 15,
    status: ClassStatus.PLANNED,
    createdById: CREATOR_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    archive: Object.assign(new ArchivableColumns(), {
      archivedAt: null,
      archivedById: null,
      archiveReason: null,
      ...archive,
    }),
    ...rest,
  });
}

function buildEdition(): Edition {
  return Object.assign(new Edition(), {
    id: EDITION_ID,
    name: "2026.1",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  });
}

function buildCourse(overrides: Partial<CourseSummary> = {}): CourseSummary {
  return {
    id: COURSE_ID,
    name: "Informática Básica",
    category: CourseCategory.BASIC,
    status: CourseStatus.ACTIVE,
    ...overrides,
  };
}

function buildRow(
  enrollmentId: string,
  studentId: string,
  enrolledAt = "2026-02-20T14:30:00.000Z",
): ActiveEnrollmentPreviewRow {
  return { enrollmentId, studentId, enrolledAt: new Date(enrolledAt) };
}

function peopleOf(...people: PersonRefDto[]): Map<string, PersonRefDto> {
  return new Map(people.map((person) => [person.id, person]));
}

function buildInput(overrides: Partial<ClassDetailInput> = {}): ClassDetailInput {
  return {
    schoolClass: buildClass(),
    edition: buildEdition(),
    course: buildCourse(),
    lessonPlanCount: 6,
    plannedWorkloadMinutes: 540,
    createdBy: { id: CREATOR_ID, name: "Carla Menezes" },
    enrolledCount: 12,
    previewRows: [],
    peopleById: new Map(),
    ...overrides,
  };
}

describe("toClassDetail()", () => {
  it("card case 1: INFO-A, Básica with 6 plans of 540 minutes and 12 of 15 seats", () => {
    const detail = toClassDetail(buildInput());

    expect(detail.summary.enrolledCount).toBe(12);
    expect(detail.summary.capacity).toBe(15);
    expect(detail.summary.occupancyRate).toBe(0.8);
    expect(detail.course.plannedWorkloadMinutes).toBe(540);
    expect(detail.course.lessonPlanCount).toBe(6);
  });

  it("copies the data of the class and its edition field by field", () => {
    const detail = toClassDetail(
      buildInput({
        schoolClass: buildClass({
          name: "Informática Básica, turma A",
          location: "Laboratório 3, bloco B",
          status: ClassStatus.IN_PROGRESS,
          startDate: "2026-12-31",
          endDate: "2027-01-01",
          capacity: 20,
        }),
      }),
    );

    expect(detail).toMatchObject({
      id: CLASS_ID,
      code: "INFO-A",
      name: "Informática Básica, turma A",
      edition: { id: EDITION_ID, name: "2026.1" },
      startDate: "2026-12-31",
      endDate: "2027-01-01",
      location: "Laboratório 3, bloco B",
      capacity: 20,
      status: "in_progress",
      archivedAt: null,
      createdAt: CREATED_AT,
    });
  });

  it("answers name and location as null when the class has none", () => {
    const detail = toClassDetail(buildInput());

    expect(detail).toHaveProperty("name", null);
    expect(detail).toHaveProperty("location", null);
  });

  it("answers exactly the keys of the contract, and nothing of the entity", () => {
    const detail = toClassDetail(buildInput({ previewRows: [buildRow("f1", STUDENT_A_ID)] }));

    expect(Object.keys(detail).sort()).toEqual([
      "archivedAt",
      "capacity",
      "code",
      "course",
      "createdAt",
      "createdBy",
      "edition",
      "endDate",
      "enrollmentsPreview",
      "enrollmentsTotal",
      "id",
      "location",
      "name",
      "startDate",
      "status",
      "summary",
    ]);
    expect(Object.keys(detail.course).sort()).toEqual([
      "category",
      "id",
      "lessonPlanCount",
      "name",
      "plannedWorkloadMinutes",
      "status",
    ]);
    expect(Object.keys(detail.summary).sort()).toEqual([
      "averageAttendance",
      "capacity",
      "enrolledCount",
      "lessonsDone",
      "lessonsTotal",
      "occupancyRate",
    ]);
    expect(detail).not.toHaveProperty("courseId");
    expect(detail).not.toHaveProperty("archivedById");
    expect(detail).not.toHaveProperty("archiveReason");
    expect(detail).not.toHaveProperty("updatedAt");
  });

  it("takes the category from the course summary", () => {
    for (const category of Object.values(CourseCategory)) {
      const detail = toClassDetail(buildInput({ course: buildCourse({ category }) }));

      expect(detail.course.category).toBe(category);
    }
  });

  it("takes the id, the name and the status of the course from the course summary", () => {
    const detail = toClassDetail(
      buildInput({
        course: buildCourse({ name: "Informática Avançada", status: CourseStatus.ARCHIVED }),
      }),
    );

    expect(detail.course).toEqual({
      id: COURSE_ID,
      name: "Informática Avançada",
      category: "basic",
      status: "archived",
      lessonPlanCount: 6,
      plannedWorkloadMinutes: 540,
    });
  });

  it("keeps lessonsDone, lessonsTotal and averageAttendance as null, present in the answer", () => {
    const { summary } = toClassDetail(buildInput());

    expect(summary).toHaveProperty("lessonsDone", null);
    expect(summary).toHaveProperty("lessonsTotal", null);
    expect(summary).toHaveProperty("averageAttendance", null);
    expect(JSON.parse(JSON.stringify(summary))).toMatchObject({
      lessonsDone: null,
      lessonsTotal: null,
      averageAttendance: null,
    });
  });

  it("enrollmentsTotal equals summary.enrolledCount, even when the preview is shorter", () => {
    const detail = toClassDetail(
      buildInput({
        enrolledCount: 12,
        previewRows: [buildRow("f1", STUDENT_A_ID)],
        peopleById: peopleOf({ id: STUDENT_A_ID, name: "Ana Souza" }),
      }),
    );

    expect(detail.enrollmentsTotal).toBe(12);
    expect(detail.enrollmentsTotal).toBe(detail.summary.enrolledCount);
    expect(detail.enrollmentsPreview).toHaveLength(1);
  });

  it("computes the occupancy from the seats of the class, with two decimals and no cap", () => {
    const rate = (enrolledCount: number, capacity: number): number =>
      toClassDetail(buildInput({ schoolClass: buildClass({ capacity }), enrolledCount })).summary
        .occupancyRate;

    expect(rate(0, 15)).toBe(0);
    expect(rate(1, 3)).toBe(0.33);
    expect(rate(2, 3)).toBe(0.67);
    expect(rate(15, 15)).toBe(1);
    expect(rate(16, 15)).toBe(1.07);
  });

  it("keeps the order of the preview rows and drops a row whose person is gone", () => {
    const detail = toClassDetail(
      buildInput({
        enrolledCount: 3,
        previewRows: [
          buildRow("f2", STUDENT_B_ID, "2026-02-18T10:00:00.000Z"),
          buildRow("f3", STUDENT_C_ID, "2026-02-19T10:00:00.000Z"),
          buildRow("f1", STUDENT_A_ID, "2026-02-20T10:00:00.000Z"),
        ],
        peopleById: peopleOf(
          { id: STUDENT_A_ID, name: "Ana Souza" },
          { id: STUDENT_B_ID, name: "Bruno Lima" },
        ),
      }),
    );

    expect(detail.enrollmentsPreview).toEqual([
      {
        id: "f2",
        student: { id: STUDENT_B_ID, name: "Bruno Lima" },
        enrolledAt: new Date("2026-02-18T10:00:00.000Z"),
      },
      {
        id: "f1",
        student: { id: STUDENT_A_ID, name: "Ana Souza" },
        enrolledAt: new Date("2026-02-20T10:00:00.000Z"),
      },
    ]);
    // A student that is not found does not change the number of enrollments.
    expect(detail.enrollmentsTotal).toBe(3);
  });

  it("copies only the id and the name of each student of the preview", () => {
    const person = {
      id: STUDENT_A_ID,
      name: "Ana Souza",
      email: "ana@example.com",
      ra: "ra123",
    } as PersonRefDto;

    const detail = toClassDetail(
      buildInput({
        previewRows: [buildRow("f1", STUDENT_A_ID)],
        peopleById: peopleOf(person),
      }),
    );

    expect(Object.keys(detail.enrollmentsPreview[0]).sort()).toEqual([
      "enrolledAt",
      "id",
      "student",
    ]);
    expect(Object.keys(detail.enrollmentsPreview[0].student).sort()).toEqual(["id", "name"]);
  });

  it("answers [] and 0 without enrollments", () => {
    const detail = toClassDetail(buildInput({ enrolledCount: 0 }));

    expect(detail.enrollmentsPreview).toEqual([]);
    expect(detail.enrollmentsTotal).toBe(0);
    expect(detail.summary.enrolledCount).toBe(0);
    expect(detail.summary.occupancyRate).toBe(0);
  });

  it("copies only the id and the name of the creator, or null", () => {
    const person = {
      id: CREATOR_ID,
      name: "Carla Menezes",
      email: "carla@example.com",
      role: "director",
    } as PersonRefDto;

    const found = toClassDetail(buildInput({ createdBy: person }));
    expect(found.createdBy).toEqual({ id: CREATOR_ID, name: "Carla Menezes" });
    expect(Object.keys(found.createdBy ?? {}).sort()).toEqual(["id", "name"]);

    const removed = toClassDetail(buildInput({ createdBy: null }));
    expect(removed).toHaveProperty("createdBy", null);
  });

  it("an archived class carries archivedAt, and keeps its status", () => {
    const detail = toClassDetail(
      buildInput({
        schoolClass: buildClass({
          status: ClassStatus.COMPLETED,
          archive: { archivedAt: ARCHIVED_AT, archivedById: CREATOR_ID, archiveReason: "Fim." },
        }),
      }),
    );

    expect(detail.archivedAt).toEqual(ARCHIVED_AT);
    expect(detail.status).toBe("completed");
    expect(detail).not.toHaveProperty("archivedById");
    expect(detail).not.toHaveProperty("archiveReason");
  });

  it("answers archivedAt null for an entity without the embedded archive columns", () => {
    const schoolClass = buildClass();
    (schoolClass as unknown as { archive?: ArchivableColumns }).archive = undefined;

    const detail = toClassDetail(buildInput({ schoolClass }));

    expect(detail.archivedAt).toBeNull();
  });
});
