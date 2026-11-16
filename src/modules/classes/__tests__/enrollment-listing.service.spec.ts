import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import {
  CourseCategory,
  CoursesService,
  CourseStatus,
  CourseSummary,
} from "@modules/catalog/services/courses.service";
import {
  AccessibilityNeed,
  StudentRef,
  StudentsService,
} from "@modules/people/services/students.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { SchoolClass } from "../entities/class.entity";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import { StudentEnrollmentSituation } from "../enums/student-enrollment-situation.enum";
import { EnrollmentListingService } from "../services/enrollment-listing.service";
import {
  ClassEnrollmentRow,
  EnrollmentClassRow,
  StudentEnrollmentRow,
} from "../services/enrollment-response.mapper";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const OTHER_CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c2";
const ANA = "01999a3e-7c1b-7000-8000-000000000001";
const BRUNO = "01999a3e-7c1b-7000-8000-000000000002";
const BASIC_ID = "01999a3e-7c1b-7000-8000-0000000000b1";
const ENROLLED_AT = new Date("2026-03-03T13:00:00.000Z");
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.MEMBER,
  accessEnabled: true,
};

function ref(id: string, name: string): StudentRef {
  return { id, name, age: 68, phone: "43999990000", accessibilityNeed: AccessibilityNeed.VISUAL };
}

function classRow(studentId: string, status = EnrollmentStatus.ACTIVE): ClassEnrollmentRow {
  return {
    id: `enrollment-of-${studentId}`,
    studentId,
    status,
    enrolledAt: ENROLLED_AT,
    statusChangedAt: "2026-03-03",
  };
}

function currentClass(studentId: string, classId: string, code: string) {
  const row: EnrollmentClassRow & { studentId: string } = {
    studentId,
    classId,
    classCode: code,
    className: null,
    editionId: "01999a3e-7c1b-7000-8000-0000000000e1",
    editionName: "2026.1",
  };
  return row;
}

async function httpFailure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error("Expected the promise to reject with an HttpException");
}

describe("EnrollmentListingService", () => {
  let service: EnrollmentListingService;
  let state: {
    schoolClass: SchoolClass | null;
    classRows: ClassEnrollmentRow[];
    liveStudents: Array<{ studentId: string }>;
    activeStudents: Array<{ studentId: string }>;
    currentClasses: Array<EnrollmentClassRow & { studentId: string }>;
    history: StudentEnrollmentRow[];
    courses: CourseSummary[];
  };

  const classRepository = { findOne: jest.fn() };
  const dataSource = { query: jest.fn(), getRepository: jest.fn() };
  const students = { listStudentRefs: jest.fn(), findStudentSummaries: jest.fn() };
  const courses = { getCourseSummaries: jest.fn() };
  const policy = { can: jest.fn() };

  function queriesWith(fragment: string): Array<[string, unknown[]]> {
    return dataSource.query.mock.calls.filter(([sql]: [string]) => sql.includes(fragment));
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    state = {
      schoolClass: Object.assign(new SchoolClass(), { id: CLASS_ID }),
      classRows: [],
      liveStudents: [],
      activeStudents: [],
      currentClasses: [],
      history: [],
      courses: [],
    };

    classRepository.findOne.mockImplementation(async () => state.schoolClass);
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === SchoolClass ? classRepository : undefined,
    );
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes("enrollments_status_enum IS NULL")) return state.classRows;
      if (sql.includes("SELECT DISTINCT student_id")) return state.activeStudents;
      if (sql.includes("ANY($1::uuid[])")) return state.currentClasses;
      if (sql.includes("e.student_id = $1")) return state.history;
      return state.liveStudents;
    });
    students.listStudentRefs.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    students.findStudentSummaries.mockResolvedValue([{ id: ANA, name: "Ana", archivedAt: null }]);
    courses.getCourseSummaries.mockImplementation(async () => state.courses);
    policy.can.mockReturnValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrollmentListingService,
        { provide: DataSource, useValue: dataSource },
        { provide: StudentsService, useValue: students },
        { provide: CoursesService, useValue: courses },
        { provide: PermissionPolicy, useValue: policy },
      ],
    }).compile();

    service = moduleRef.get(EnrollmentListingService);
  });

  describe("listClassEnrollments()", () => {
    it("answers 404 CLASS_NOT_FOUND for an unknown class", async () => {
      state.schoolClass = null;

      const failure = await httpFailure(service.listClassEnrollments(CLASS_ID, {}, ACTOR));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "CLASS_NOT_FOUND",
        message: "Class not found.",
      });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it("answers an empty page without asking people when the class has no enrollment with that status", async () => {
      const page = await service.listClassEnrollments(
        CLASS_ID,
        { status: EnrollmentStatus.DROPPED, page: 2, limit: 10 },
        ACTOR,
      );

      expect(page).toEqual({ data: [], total: 0, page: 2, limit: 10 });
      expect(students.listStudentRefs).not.toHaveBeenCalled();
      const [sql, parameters] = dataSource.query.mock.calls[0];
      expect(sql).toContain("status_changed_at::text");
      expect(sql).toContain("deleted_at IS NULL");
      expect(parameters).toEqual([CLASS_ID, EnrollmentStatus.DROPPED]);

      await service.listClassEnrollments(CLASS_ID, {}, ACTOR);
      expect(dataSource.query.mock.calls[1][1]).toEqual([CLASS_ID, null]);
    });

    it("asks people for the students of the enrollments with the search, archived included, and keeps their page and total", async () => {
      state.classRows = [classRow(ANA), classRow(BRUNO, EnrollmentStatus.DROPPED)];
      students.listStudentRefs.mockResolvedValue({
        data: [ref(BRUNO, "Bruno")],
        total: 2,
        page: 2,
        limit: 1,
      });

      const page = await service.listClassEnrollments(
        CLASS_ID,
        { search: "b", page: 2, limit: 1 },
        ACTOR,
      );

      expect(students.listStudentRefs).toHaveBeenCalledWith(
        { onlyIds: [ANA, BRUNO], search: "b", includeArchived: true },
        { page: 2, limit: 1 },
      );
      expect(page.total).toBe(2);
      expect(page.page).toBe(2);
      expect(page.limit).toBe(1);
      expect(page.data.map((item) => [item.id, item.student.id, item.status])).toEqual([
        [`enrollment-of-${BRUNO}`, BRUNO, EnrollmentStatus.DROPPED],
      ]);
    });

    it("asks the policy once whether the actor can see students", async () => {
      state.classRows = [classRow(ANA), classRow(BRUNO)];
      students.listStudentRefs.mockResolvedValue({
        data: [ref(ANA, "Ana"), ref(BRUNO, "Bruno")],
        total: 2,
        page: 1,
        limit: 20,
      });

      await service.listClassEnrollments(CLASS_ID, {}, ACTOR);

      expect(policy.can).toHaveBeenCalledTimes(1);
      expect(policy.can).toHaveBeenCalledWith(ACTOR, Permission.STUDENTS_VIEW);
    });

    it("fills phone and accessibilityNeed only when the actor can see students, and null otherwise", async () => {
      state.classRows = [classRow(ANA)];
      students.listStudentRefs.mockResolvedValue({
        data: [ref(ANA, "Ana")],
        total: 1,
        page: 1,
        limit: 20,
      });

      const allowed = await service.listClassEnrollments(CLASS_ID, {}, ACTOR);
      expect(allowed.data[0].student).toEqual({
        id: ANA,
        name: "Ana",
        age: 68,
        phone: "43999990000",
        accessibilityNeed: AccessibilityNeed.VISUAL,
      });

      policy.can.mockReturnValue(false);
      const denied = await service.listClassEnrollments(CLASS_ID, {}, ACTOR);
      expect(denied.data[0].student).toEqual({
        id: ANA,
        name: "Ana",
        age: 68,
        phone: null,
        accessibilityNeed: null,
      });
    });

    it("answers attendanceRate null", async () => {
      state.classRows = [classRow(ANA)];
      students.listStudentRefs.mockResolvedValue({
        data: [ref(ANA, "Ana")],
        total: 1,
        page: 1,
        limit: 20,
      });

      const page = await service.listClassEnrollments(CLASS_ID, {}, ACTOR);

      expect(page.data).toEqual([
        {
          id: `enrollment-of-${ANA}`,
          student: expect.objectContaining({ id: ANA }),
          status: EnrollmentStatus.ACTIVE,
          enrolledAt: ENROLLED_AT,
          statusChangedAt: "2026-03-03",
          attendanceRate: null,
        },
      ]);
    });

    it("throws when people answers a student that is not in the enrollments, a broken invariant", async () => {
      state.classRows = [classRow(ANA)];
      students.listStudentRefs.mockResolvedValue({
        data: [ref(BRUNO, "Bruno")],
        total: 1,
        page: 1,
        limit: 20,
      });

      await expect(service.listClassEnrollments(CLASS_ID, {}, ACTOR)).rejects.toThrow(
        `The student ${BRUNO} of the page has no enrollment in the class.`,
      );
    });
  });

  describe("listAvailableStudents()", () => {
    it("excludes every student with a live enrollment in the class, in any status, and the archived", async () => {
      state.liveStudents = [{ studentId: ANA }, { studentId: BRUNO }];

      await service.listAvailableStudents(CLASS_ID, { search: "Car", page: 1, limit: 20 });

      const [sql, parameters] = dataSource.query.mock.calls[0];
      expect(sql).toContain("deleted_at IS NULL");
      expect(sql).not.toContain("status");
      expect(parameters).toEqual([CLASS_ID]);
      expect(students.listStudentRefs).toHaveBeenCalledWith(
        { excludeIds: [ANA, BRUNO], search: "Car", includeArchived: false },
        { search: "Car", page: 1, limit: 20 },
      );
    });

    it("fills currentClasses with one query for the whole page", async () => {
      students.listStudentRefs.mockResolvedValue({
        data: [ref(ANA, "Ana"), ref(BRUNO, "Bruno")],
        total: 2,
        page: 1,
        limit: 20,
      });
      state.currentClasses = [
        currentClass(ANA, OTHER_CLASS_ID, "SMART-B"),
        currentClass(ANA, "01999a3e-7c1b-7000-8000-0000000000c3", "WEB-A"),
      ];

      const page = await service.listAvailableStudents(CLASS_ID, {});

      const current = queriesWith("ANY($1::uuid[])");
      expect(current).toHaveLength(1);
      expect(current[0][0]).toContain("ORDER BY ed.name DESC, LOWER(c.code), c.id");
      expect(current[0][1]).toEqual([[ANA, BRUNO], EnrollmentStatus.ACTIVE]);
      expect(page.data).toEqual([
        {
          id: ANA,
          name: "Ana",
          age: 68,
          currentClasses: [
            {
              id: OTHER_CLASS_ID,
              code: "SMART-B",
              name: null,
              edition: { id: "01999a3e-7c1b-7000-8000-0000000000e1", name: "2026.1" },
            },
            expect.objectContaining({ code: "WEB-A" }),
          ],
        },
        { id: BRUNO, name: "Bruno", age: 68, currentClasses: [] },
      ]);
      // No phone and no accessibility need on the screen of the enrollment.
      expect(page.data[0]).not.toHaveProperty("phone");

      // An empty page asks nothing about the classes.
      dataSource.query.mockClear();
      students.listStudentRefs.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
      await service.listAvailableStudents(CLASS_ID, {});
      expect(queriesWith("ANY($1::uuid[])")).toHaveLength(0);
    });

    it("answers 404 CLASS_NOT_FOUND", async () => {
      state.schoolClass = null;

      const failure = await httpFailure(service.listAvailableStudents(CLASS_ID, {}));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toMatchObject({ error: "CLASS_NOT_FOUND" });
      expect(students.listStudentRefs).not.toHaveBeenCalled();
    });
  });

  describe("listStudentEnrollments()", () => {
    it("answers 404 STUDENT_NOT_FOUND for an id that is not a student", async () => {
      students.findStudentSummaries.mockResolvedValue([]);

      const failure = await httpFailure(service.listStudentEnrollments("not-a-uuid"));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_NOT_FOUND",
        message: "Student not found.",
      });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it("reads the courses of the history in one call", async () => {
      const row = (
        id: string,
        status: EnrollmentStatus,
        courseId: string,
      ): StudentEnrollmentRow => ({
        ...currentClass(ANA, CLASS_ID, "INFO-A"),
        id,
        status,
        enrolledAt: ENROLLED_AT,
        statusChangedAt: "2026-06-27",
        courseId,
      });
      state.history = [
        row("e1", EnrollmentStatus.ACTIVE, "01999a3e-7c1b-7000-8000-0000000000b2"),
        row("e2", EnrollmentStatus.COMPLETED, BASIC_ID),
        row("e3", EnrollmentStatus.DROPPED, BASIC_ID),
      ];
      state.courses = [
        {
          id: BASIC_ID,
          name: "Informática Básica",
          category: CourseCategory.BASIC,
          status: CourseStatus.ACTIVE,
        },
        {
          id: "01999a3e-7c1b-7000-8000-0000000000b2",
          name: "Smartphones",
          category: CourseCategory.INTERMEDIATE,
          status: CourseStatus.ARCHIVED,
        },
      ];

      const history = await service.listStudentEnrollments(ANA);

      expect(courses.getCourseSummaries).toHaveBeenCalledTimes(1);
      expect(courses.getCourseSummaries).toHaveBeenCalledWith([
        "01999a3e-7c1b-7000-8000-0000000000b2",
        BASIC_ID,
      ]);
      const [sql, parameters] = queriesWith("e.student_id = $1")[0];
      expect(sql).toContain("e.status_changed_at::text");
      expect(sql).toContain("ORDER BY e.enrolled_at DESC, e.id DESC");
      expect(parameters).toEqual([ANA]);
      expect(history.enrollments.map((item) => [item.id, item.course.name])).toEqual([
        ["e1", "Smartphones"],
        ["e2", "Informática Básica"],
        ["e3", "Informática Básica"],
      ]);
      expect(history.enrollments[0].course).toEqual({
        id: "01999a3e-7c1b-7000-8000-0000000000b2",
        name: "Smartphones",
        category: CourseCategory.INTERMEDIATE,
        status: CourseStatus.ARCHIVED,
      });
      expect(history.enrollments[0].class.code).toBe("INFO-A");
      expect(history.summary).toEqual({
        activeClasses: 1,
        completedCourses: [
          { courseId: BASIC_ID, name: "Informática Básica", completedAt: "2026-06-27" },
        ],
        firstEnrollmentAt: ENROLLED_AT,
      });

      // A course the catalog does not answer is a broken invariant (the foreign key keeps it).
      state.courses = [];
      await expect(service.listStudentEnrollments(ANA)).rejects.toThrow("of a class is gone");
    });
  });

  describe("listStudentsByEnrollment()", () => {
    it("defaults the situation to enrolled", async () => {
      state.activeStudents = [{ studentId: ANA }];

      await service.listStudentsByEnrollment({});

      expect(students.listStudentRefs).toHaveBeenCalledWith(
        { onlyIds: [ANA], search: undefined, includeArchived: false },
        { page: 1, limit: 20 },
      );
    });

    it("passes the active students as onlyIds for enrolled and as excludeIds for not_enrolled, with or without a class", async () => {
      state.activeStudents = [{ studentId: ANA }, { studentId: BRUNO }];
      students.listStudentRefs.mockResolvedValue({
        data: [ref(ANA, "Ana")],
        total: 1,
        page: 1,
        limit: 20,
      });
      state.currentClasses = [currentClass(ANA, CLASS_ID, "INFO-A")];

      const enrolled = await service.listStudentsByEnrollment({
        classId: CLASS_ID,
        situation: StudentEnrollmentSituation.ENROLLED,
        search: "an",
      });
      await service.listStudentsByEnrollment({
        situation: StudentEnrollmentSituation.NOT_ENROLLED,
      });

      const reads = queriesWith("SELECT DISTINCT student_id");
      expect(reads.map(([, parameters]) => parameters)).toEqual([
        [EnrollmentStatus.ACTIVE, CLASS_ID],
        [EnrollmentStatus.ACTIVE, null],
      ]);
      expect(students.listStudentRefs.mock.calls.map((call) => call[0])).toEqual([
        { onlyIds: [ANA, BRUNO], search: "an", includeArchived: false },
        { excludeIds: [ANA, BRUNO], search: undefined, includeArchived: false },
      ]);
      expect(enrolled.data).toEqual([
        {
          ...ref(ANA, "Ana"),
          currentClasses: [expect.objectContaining({ id: CLASS_ID, code: "INFO-A" })],
        },
      ]);
    });

    it("answers an empty page without asking people for enrolled when nobody is enrolled", async () => {
      const page = await service.listStudentsByEnrollment({ classId: CLASS_ID, page: 3 });

      expect(page).toEqual({ data: [], total: 0, page: 3, limit: 20 });
      expect(students.listStudentRefs).not.toHaveBeenCalled();

      // Nobody enrolled is everybody for not_enrolled: people is asked with nothing to exclude.
      await service.listStudentsByEnrollment({
        classId: CLASS_ID,
        situation: StudentEnrollmentSituation.NOT_ENROLLED,
      });
      expect(students.listStudentRefs).toHaveBeenCalledWith(
        { excludeIds: [], search: undefined, includeArchived: false },
        { page: 1, limit: 20 },
      );
    });
  });
});
