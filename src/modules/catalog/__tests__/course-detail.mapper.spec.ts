import "reflect-metadata";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import { CourseLessonPlanItemResponseDto } from "../dto/course-lesson-plan-item.response.dto";
import { CourseLessonPlansResponseDto } from "../dto/course-lesson-plans.response.dto";
import { Course } from "../entities/course.entity";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import { RelatedCourseRow, toCourseDetail } from "../services/course-detail.mapper";

const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
const UPDATED_AT = new Date("2026-09-15T18:30:00.000Z");
const ARCHIVED_AT = new Date("2026-10-10T12:00:00.000Z");

const CREATOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000002";
const FIRST_PLAN_ID = "01999a3e-7c1b-7000-8000-000000000011";
const SECOND_PLAN_ID = "01999a3e-7c1b-7000-8000-000000000012";
const THIRD_PLAN_ID = "01999a3e-7c1b-7000-8000-000000000013";

type CourseOverrides = Partial<Omit<Course, "archive">> & { archive?: Partial<ArchivableColumns> };

function buildCourse(overrides: CourseOverrides = {}): Course {
  const { archive, ...rest } = overrides;
  return Object.assign(new Course(), {
    id: COURSE_ID,
    name: "Informática Básica",
    description: "Fundamentos do uso do computador.",
    objective: "Deixar o aluno à vontade para usar o computador.",
    category: CourseCategory.BASIC,
    createdById: CREATOR_ID,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
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

function buildRow(overrides: Partial<RelatedCourseRow> = {}): RelatedCourseRow {
  return {
    relation: "prerequisite",
    id: "01999a3e-7c1b-7000-8000-000000000001",
    name: "Informática Introdutória",
    category: CourseCategory.BASIC,
    archivedAt: null,
    ...overrides,
  };
}

function buildItem(
  lessonPlanId: string,
  position: number,
  expectedDurationMinutes: number,
): CourseLessonPlanItemResponseDto {
  return {
    position,
    lessonPlanId,
    title: `Plano ${position}`,
    contents: [`Conteúdo ${position}`],
    expectedDurationMinutes,
    materialUrl: null,
    courseCount: 1,
    archivedAt: null,
  };
}

function buildSequence(
  items: CourseLessonPlanItemResponseDto[] = [],
  plannedWorkloadMinutes = items.reduce((sum, item) => sum + item.expectedDurationMinutes, 0),
): CourseLessonPlansResponseDto {
  return { courseId: COURSE_ID, plannedWorkloadMinutes, items };
}

describe("toCourseDetail()", () => {
  it("splits prerequisite and requiredBy rows and sorts each list by name (pt-BR)", () => {
    const rows = [
      buildRow({
        relation: "requiredBy",
        id: "01999a3e-7c1b-7000-8000-000000000031",
        name: "Zeta",
      }),
      buildRow({
        relation: "prerequisite",
        id: "01999a3e-7c1b-7000-8000-000000000021",
        name: "Banco",
      }),
      buildRow({
        relation: "requiredBy",
        id: "01999a3e-7c1b-7000-8000-000000000032",
        name: "Árvore",
      }),
      buildRow({
        relation: "prerequisite",
        id: "01999a3e-7c1b-7000-8000-000000000022",
        name: "Árvore",
      }),
      buildRow({
        relation: "requiredBy",
        id: "01999a3e-7c1b-7000-8000-000000000033",
        name: "Banco",
      }),
      buildRow({
        relation: "prerequisite",
        id: "01999a3e-7c1b-7000-8000-000000000023",
        name: "Zeta",
      }),
    ];

    const detail = toCourseDetail(buildCourse(), rows, buildSequence(), null);

    expect(detail.prerequisites.map((course) => course.name)).toEqual(["Árvore", "Banco", "Zeta"]);
    expect(detail.requiredBy.map((course) => course.name)).toEqual(["Árvore", "Banco", "Zeta"]);
    expect(detail.prerequisites.map((course) => course.id)).toEqual([
      "01999a3e-7c1b-7000-8000-000000000022",
      "01999a3e-7c1b-7000-8000-000000000021",
      "01999a3e-7c1b-7000-8000-000000000023",
    ]);
    expect(detail.requiredBy.map((course) => course.id)).toEqual([
      "01999a3e-7c1b-7000-8000-000000000032",
      "01999a3e-7c1b-7000-8000-000000000033",
      "01999a3e-7c1b-7000-8000-000000000031",
    ]);
  });

  it("answers empty prerequisites and requiredBy when there are no rows", () => {
    const detail = toCourseDetail(buildCourse(), [], buildSequence(), null);

    expect(detail.prerequisites).toEqual([]);
    expect(detail.requiredBy).toEqual([]);
  });

  it("puts a row in one list only, according to its relation", () => {
    const rows = [
      buildRow({
        relation: "prerequisite",
        id: "01999a3e-7c1b-7000-8000-000000000021",
        name: "Base",
      }),
      buildRow({
        relation: "requiredBy",
        id: "01999a3e-7c1b-7000-8000-000000000031",
        name: "Topo",
      }),
    ];

    const detail = toCourseDetail(buildCourse(), rows, buildSequence(), null);

    expect(detail.prerequisites.map((course) => course.name)).toEqual(["Base"]);
    expect(detail.requiredBy.map((course) => course.name)).toEqual(["Topo"]);
  });

  it("breaks a tie between equal names by id", () => {
    const rows = [
      buildRow({ id: "01999a3e-7c1b-7000-8000-00000000000b", name: "Igual" }),
      buildRow({ id: "01999a3e-7c1b-7000-8000-00000000000a", name: "Igual" }),
    ];

    const detail = toCourseDetail(buildCourse(), rows, buildSequence(), null);

    expect(detail.prerequisites.map((course) => course.id)).toEqual([
      "01999a3e-7c1b-7000-8000-00000000000a",
      "01999a3e-7c1b-7000-8000-00000000000b",
    ]);
  });

  it("copies id, name and category of a related course and answers status active when it is not archived", () => {
    const rows = [
      buildRow({
        relation: "requiredBy",
        id: "01999a3e-7c1b-7000-8000-000000000031",
        name: "Informática Intermediária",
        category: CourseCategory.INTERMEDIATE,
      }),
    ];

    const detail = toCourseDetail(buildCourse(), rows, buildSequence(), null);

    expect(detail.requiredBy).toEqual([
      {
        id: "01999a3e-7c1b-7000-8000-000000000031",
        name: "Informática Intermediária",
        category: "intermediate",
        status: CourseStatus.ACTIVE,
      },
    ]);
    expect(Object.keys(detail.requiredBy[0]).sort()).toEqual(["category", "id", "name", "status"]);
  });

  it("derives status archived for a related course with archivedAt", () => {
    const rows = [
      buildRow({
        relation: "prerequisite",
        id: "01999a3e-7c1b-7000-8000-000000000021",
        name: "Arquivado",
        archivedAt: ARCHIVED_AT,
      }),
      buildRow({
        relation: "requiredBy",
        id: "01999a3e-7c1b-7000-8000-000000000031",
        name: "Também arquivado",
        archivedAt: ARCHIVED_AT,
      }),
      buildRow({
        relation: "requiredBy",
        id: "01999a3e-7c1b-7000-8000-000000000032",
        name: "Ativo",
        archivedAt: null,
      }),
    ];

    const detail = toCourseDetail(buildCourse(), rows, buildSequence(), null);

    expect(detail.prerequisites.map((course) => course.status)).toEqual([CourseStatus.ARCHIVED]);
    expect(detail.requiredBy.map((course) => [course.name, course.status])).toEqual([
      ["Ativo", CourseStatus.ACTIVE],
      ["Também arquivado", CourseStatus.ARCHIVED],
    ]);
  });

  it("keeps the items of the sequence as read and counts them in lessonPlanCount", () => {
    const items = [
      buildItem(THIRD_PLAN_ID, 1, 60),
      buildItem(FIRST_PLAN_ID, 2, 90),
      buildItem(SECOND_PLAN_ID, 3, 120),
    ];

    const detail = toCourseDetail(buildCourse(), [], buildSequence(items), null);

    expect(detail.lessonPlans).toEqual(items);
    expect(detail.lessonPlans.map((item) => [item.position, item.lessonPlanId])).toEqual([
      [1, THIRD_PLAN_ID],
      [2, FIRST_PLAN_ID],
      [3, SECOND_PLAN_ID],
    ]);
    expect(detail.plannedWorkloadMinutes).toBe(270);
    expect(detail.lessonPlanCount).toBe(3);
  });

  it("takes plannedWorkloadMinutes from the sequence it receives and does not add it up again", () => {
    const items = [buildItem(FIRST_PLAN_ID, 1, 90)];

    const detail = toCourseDetail(buildCourse(), [], buildSequence(items, 1234), null);

    expect(detail.plannedWorkloadMinutes).toBe(1234);
    expect(detail.lessonPlanCount).toBe(1);
  });

  it("answers lessonPlanCount 0 for an empty sequence", () => {
    const detail = toCourseDetail(buildCourse(), [], buildSequence([]), null);

    expect(detail.lessonPlans).toEqual([]);
    expect(detail.plannedWorkloadMinutes).toBe(0);
    expect(detail.lessonPlanCount).toBe(0);
  });

  it("answers status archived for an archived course and createdBy null when there is no creator", () => {
    const course = buildCourse({ archive: { archivedAt: ARCHIVED_AT } });

    const detail = toCourseDetail(course, [], buildSequence(), null);

    expect(detail.status).toBe(CourseStatus.ARCHIVED);
    expect(detail.createdBy).toBeNull();
  });

  it("answers status active for a course that is not archived", () => {
    const detail = toCourseDetail(buildCourse(), [], buildSequence(), null);

    expect(detail.status).toBe(CourseStatus.ACTIVE);
  });

  it("answers objective null when the course has none", () => {
    const detail = toCourseDetail(buildCourse({ objective: null }), [], buildSequence(), null);

    expect(detail.objective).toBeNull();
  });

  it("copies the data of the course and answers exactly the fields of the page", () => {
    const course = buildCourse();
    const items = [buildItem(FIRST_PLAN_ID, 1, 90)];

    const detail = toCourseDetail(
      course,
      [buildRow({ id: "01999a3e-7c1b-7000-8000-000000000021", name: "Base" })],
      buildSequence(items),
      { id: CREATOR_ID, name: "Carla Menezes" },
    );

    expect(detail).toEqual({
      id: COURSE_ID,
      name: "Informática Básica",
      description: "Fundamentos do uso do computador.",
      objective: "Deixar o aluno à vontade para usar o computador.",
      category: "basic",
      status: "active",
      createdAt: CREATED_AT,
      createdBy: { id: CREATOR_ID, name: "Carla Menezes" },
      updatedAt: UPDATED_AT,
      prerequisites: [
        {
          id: "01999a3e-7c1b-7000-8000-000000000021",
          name: "Base",
          category: "basic",
          status: "active",
        },
      ],
      requiredBy: [],
      lessonPlans: items,
      plannedWorkloadMinutes: 90,
      lessonPlanCount: 1,
    });
    expect(Object.keys(detail).sort()).toEqual([
      "category",
      "createdAt",
      "createdBy",
      "description",
      "id",
      "lessonPlanCount",
      "lessonPlans",
      "name",
      "objective",
      "plannedWorkloadMinutes",
      "prerequisites",
      "requiredBy",
      "status",
      "updatedAt",
    ]);
    // Nothing of the entity that is not part of the page: who archived it, why, the soft delete.
    expect(detail).not.toHaveProperty("createdById");
    expect(detail).not.toHaveProperty("archivedAt");
    expect(detail).not.toHaveProperty("deletedAt");
  });

  it("copies only the id and the name of the creator", () => {
    const person = {
      id: CREATOR_ID,
      name: "Carla Menezes",
      email: "carla@example.com",
      ra: "ra123",
      passwordHash: "hash",
    };

    const detail = toCourseDetail(buildCourse(), [], buildSequence(), person);

    expect(detail.createdBy).toEqual({ id: CREATOR_ID, name: "Carla Menezes" });
    expect(Object.keys(detail.createdBy ?? {}).sort()).toEqual(["id", "name"]);
  });

  it("does not change the rows it receives", () => {
    const rows = [
      buildRow({
        relation: "requiredBy",
        id: "01999a3e-7c1b-7000-8000-000000000031",
        name: "Zeta",
      }),
      buildRow({
        relation: "prerequisite",
        id: "01999a3e-7c1b-7000-8000-000000000021",
        name: "Banco",
      }),
      buildRow({
        relation: "requiredBy",
        id: "01999a3e-7c1b-7000-8000-000000000032",
        name: "Árvore",
      }),
    ];
    const before = rows.map((row) => row.name);

    toCourseDetail(buildCourse(), rows, buildSequence(), null);

    expect(rows.map((row) => row.name)).toEqual(before);
  });
});
