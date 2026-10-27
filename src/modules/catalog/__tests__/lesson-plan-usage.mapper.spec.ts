import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { LessonPlanResponseDto } from "../dto/lesson-plan.response.dto";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import { LessonPlanUsageStatus } from "../enums/lesson-plan-usage-status.enum";
import {
  LessonPlanUsageRow,
  toLessonPlanDetail,
  toLessonPlanUsage,
} from "../services/lesson-plan-usage.mapper";

const PLAN_ID = "01999a3e-7c1b-7000-8000-000000000001";
const COURSE_A_ID = "01999a3e-7c1b-7000-8000-00000000000a";
const COURSE_B_ID = "01999a3e-7c1b-7000-8000-00000000000b";
const CREATOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
const UPDATED_AT = new Date("2026-09-02T12:00:00.000Z");
const ARCHIVED_AT = new Date("2026-10-01T13:00:00.000Z");

const PLAN: LessonPlanResponseDto = {
  id: PLAN_ID,
  title: "Teclado, mouse e janelas",
  objective: "Familiarizar o aluno com o teclado.",
  expectedDurationMinutes: 90,
  contents: ["Teclado e mouse", "Janelas do sistema"],
  materialUrl: "https://drive.google.com/file/d/exemplo/view",
  archivedAt: null,
  archivedById: null,
  archiveReason: null,
  createdById: CREATOR_ID,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const CREATOR: PersonRefDto = { id: CREATOR_ID, name: "Carla Menezes" };

function buildRow(overrides: Partial<LessonPlanUsageRow> = {}): LessonPlanUsageRow {
  return {
    courseId: COURSE_A_ID,
    courseName: "Curso A",
    category: CourseCategory.BASIC,
    courseArchivedAt: null,
    position: 2,
    lessonPlanCount: 4,
    currentWorkloadMinutes: 360,
    newWorkloadMinutes: 390,
    ...overrides,
  };
}

describe("toLessonPlanDetail()", () => {
  it("maps each row to a usedIn item with position, lessonPlanCount, category and courseStatus", () => {
    const rows = [
      buildRow(),
      buildRow({
        courseId: COURSE_B_ID,
        courseName: "Curso B",
        category: CourseCategory.ADVANCED,
        position: 5,
        lessonPlanCount: 6,
        currentWorkloadMinutes: 600,
        newWorkloadMinutes: 630,
      }),
    ];

    const detail = toLessonPlanDetail(PLAN, CREATOR, rows);

    expect(detail.usedIn).toEqual([
      {
        courseId: COURSE_A_ID,
        courseName: "Curso A",
        category: CourseCategory.BASIC,
        position: 2,
        lessonPlanCount: 4,
        courseStatus: CourseStatus.ACTIVE,
      },
      {
        courseId: COURSE_B_ID,
        courseName: "Curso B",
        category: CourseCategory.ADVANCED,
        position: 5,
        lessonPlanCount: 6,
        courseStatus: CourseStatus.ACTIVE,
      },
    ]);
  });

  it("derives status unused for no rows and in_use otherwise", () => {
    expect(toLessonPlanDetail(PLAN, CREATOR, [])).toMatchObject({
      status: LessonPlanUsageStatus.UNUSED,
      usedIn: [],
    });
    expect(toLessonPlanDetail(PLAN, CREATOR, [buildRow()]).status).toBe(
      LessonPlanUsageStatus.IN_USE,
    );
  });

  it("keeps the status independent of the archiving of the plan", () => {
    const archivedPlan = { ...PLAN, archivedAt: ARCHIVED_AT, archivedById: CREATOR_ID };

    expect(toLessonPlanDetail(archivedPlan, CREATOR, [buildRow()]).status).toBe(
      LessonPlanUsageStatus.IN_USE,
    );
    expect(toLessonPlanDetail(archivedPlan, CREATOR, []).status).toBe(LessonPlanUsageStatus.UNUSED);
  });

  it("marks courseStatus archived when the course has archivedAt", () => {
    const detail = toLessonPlanDetail(PLAN, CREATOR, [
      buildRow({ courseId: COURSE_A_ID, courseName: "Curso A", courseArchivedAt: ARCHIVED_AT }),
      buildRow({ courseId: COURSE_B_ID, courseName: "Curso B", courseArchivedAt: null }),
    ]);

    expect(detail.usedIn.map((item) => [item.courseName, item.courseStatus])).toEqual([
      ["Curso A", CourseStatus.ARCHIVED],
      ["Curso B", CourseStatus.ACTIVE],
    ]);
  });

  it("orders by course name in pt-BR, accents included ('Álgebra' before 'Banco'), then by id", () => {
    const detail = toLessonPlanDetail(PLAN, CREATOR, [
      buildRow({ courseId: "id-3", courseName: "Banco de dados" }),
      buildRow({ courseId: "id-2", courseName: "Zoologia" }),
      buildRow({ courseId: "id-1", courseName: "Álgebra" }),
      buildRow({ courseId: "id-5", courseName: "Excel" }),
      buildRow({ courseId: "id-4", courseName: "Excel" }),
    ]);

    expect(detail.usedIn.map((item) => [item.courseName, item.courseId])).toEqual([
      ["Álgebra", "id-1"],
      ["Banco de dados", "id-3"],
      ["Excel", "id-4"],
      ["Excel", "id-5"],
      ["Zoologia", "id-2"],
    ]);
  });

  it("does not reorder the rows it was given", () => {
    const rows = [
      buildRow({ courseId: "id-2", courseName: "Zoologia" }),
      buildRow({ courseId: "id-1", courseName: "Álgebra" }),
    ];

    toLessonPlanDetail(PLAN, CREATOR, rows);

    expect(rows.map((row) => row.courseName)).toEqual(["Zoologia", "Álgebra"]);
  });

  it("keeps every field of the plan and adds createdBy, null when given null", () => {
    const detail = toLessonPlanDetail(PLAN, CREATOR, [buildRow()]);

    expect(detail).toEqual({
      ...PLAN,
      status: LessonPlanUsageStatus.IN_USE,
      createdBy: { id: CREATOR_ID, name: "Carla Menezes" },
      usedIn: expect.any(Array),
    });
    expect(toLessonPlanDetail(PLAN, null, []).createdBy).toBeNull();
  });

  it("projects only the fields of the DTO: nothing else of the plan or of the row gets through", () => {
    const planWithExtras = { ...PLAN, passwordHash: "secret" } as LessonPlanResponseDto;
    const rowWithExtras = { ...buildRow(), deletedAt: null };
    const creatorWithExtras = { ...CREATOR, email: "carla@example.com" } as PersonRefDto;

    const detail = toLessonPlanDetail(planWithExtras, creatorWithExtras, [rowWithExtras]);

    expect(Object.keys(detail).sort()).toEqual(
      [...Object.keys(PLAN), "status", "createdBy", "usedIn"].sort(),
    );
    expect(Object.keys(detail.createdBy ?? {}).sort()).toEqual(["id", "name"]);
    expect(Object.keys(detail.usedIn[0]).sort()).toEqual([
      "category",
      "courseId",
      "courseName",
      "courseStatus",
      "lessonPlanCount",
      "position",
    ]);
  });
});

describe("toLessonPlanUsage()", () => {
  it("maps the usage with current and new workload of each course, in name order", () => {
    const usage = toLessonPlanUsage(PLAN_ID, 90, 120, [
      buildRow({
        courseId: COURSE_B_ID,
        courseName: "Curso B",
        position: 5,
        lessonPlanCount: 6,
        currentWorkloadMinutes: 600,
        newWorkloadMinutes: 630,
      }),
      buildRow(),
    ]);

    expect(usage).toEqual({
      lessonPlanId: PLAN_ID,
      currentDurationMinutes: 90,
      newDurationMinutes: 120,
      courses: [
        {
          courseId: COURSE_A_ID,
          courseName: "Curso A",
          position: 2,
          lessonPlanCount: 4,
          currentWorkloadMinutes: 360,
          newWorkloadMinutes: 390,
        },
        {
          courseId: COURSE_B_ID,
          courseName: "Curso B",
          position: 5,
          lessonPlanCount: 6,
          currentWorkloadMinutes: 600,
          newWorkloadMinutes: 630,
        },
      ],
    });
  });

  it("answers courses [] for a plan in no course", () => {
    expect(toLessonPlanUsage(PLAN_ID, 90, 90, [])).toEqual({
      lessonPlanId: PLAN_ID,
      currentDurationMinutes: 90,
      newDurationMinutes: 90,
      courses: [],
    });
  });

  it("projects only the fields of the DTO from each row", () => {
    // The row also carries category and courseArchivedAt, which the usage does not answer.
    const usage = toLessonPlanUsage(PLAN_ID, 90, 120, [
      buildRow({ courseArchivedAt: ARCHIVED_AT }),
    ]);

    expect(Object.keys(usage.courses[0]).sort()).toEqual([
      "courseId",
      "courseName",
      "currentWorkloadMinutes",
      "lessonPlanCount",
      "newWorkloadMinutes",
      "position",
    ]);
  });

  it("orders by course name in pt-BR, accents included, then by id", () => {
    const usage = toLessonPlanUsage(PLAN_ID, 90, 90, [
      buildRow({ courseId: "id-2", courseName: "Banco de dados" }),
      buildRow({ courseId: "id-1", courseName: "Álgebra" }),
    ]);

    expect(usage.courses.map((course) => course.courseName)).toEqual(["Álgebra", "Banco de dados"]);
  });
});
