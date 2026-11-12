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
import { SchoolClass } from "../entities/class.entity";
import { Edition } from "../entities/edition.entity";
import { ClassStatus } from "../enums/class-status.enum";
import { CourseClassesService } from "../services/course-classes.service";
import { EnrollmentCountsService } from "../services/enrollment-counts.service";

const BASIC_ID = "01999a3e-7c1b-7000-8000-000000000001";
const SMARTPHONES_ID = "01999a3e-7c1b-7000-8000-000000000002";
const ADVANCED_ID = "01999a3e-7c1b-7000-8000-000000000003";
const CLASS_A_ID = "01999a3e-7c1b-7000-8000-0000000000a1";
const CLASS_B_ID = "01999a3e-7c1b-7000-8000-0000000000b1";
const EDITION_ID = "01999a3e-7c1b-7000-8000-0000000000e1";

function buildCourse(overrides: Partial<CourseSummary> = {}): CourseSummary {
  return {
    id: BASIC_ID,
    name: "Informática Básica",
    category: CourseCategory.BASIC,
    status: CourseStatus.ACTIVE,
    ...overrides,
  };
}

function buildRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CLASS_A_ID,
    code: "INFO-A",
    name: null,
    editionId: EDITION_ID,
    editionName: "2026.1",
    startDate: "2026-03-03",
    endDate: "2026-06-27",
    capacity: 15,
    status: ClassStatus.PLANNED,
    ...overrides,
  };
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

describe("CourseClassesService", () => {
  let service: CourseClassesService;
  let state: { course: CourseSummary | null; rows: Array<Record<string, unknown>>; total: number };

  /** A builder whose every step answers itself, as the real one does, so the calls can be read. */
  const builder = {
    innerJoin: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    clone: jest.fn(),
    offset: jest.fn(),
    limit: jest.fn(),
    getRawMany: jest.fn(),
    getCount: jest.fn(),
  };
  const repository = { createQueryBuilder: jest.fn() };
  const manager = { name: "the manager of the data source" };
  const dataSource = { getRepository: jest.fn(), query: jest.fn(), manager };
  const courses = { getCourseSummary: jest.fn() };
  const enrollmentCounts = { countActiveByClass: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    state = { course: buildCourse(), rows: [buildRow()], total: 1 };

    for (const step of [
      builder.innerJoin,
      builder.select,
      builder.addSelect,
      builder.where,
      builder.andWhere,
      builder.orderBy,
      builder.addOrderBy,
      builder.clone,
      builder.offset,
      builder.limit,
    ]) {
      step.mockReturnValue(builder);
    }
    builder.getRawMany.mockImplementation(async () => state.rows);
    builder.getCount.mockImplementation(async () => state.total);
    repository.createQueryBuilder.mockReturnValue(builder);
    dataSource.getRepository.mockReturnValue(repository);
    courses.getCourseSummary.mockImplementation(async () => state.course);
    enrollmentCounts.countActiveByClass.mockResolvedValue(new Map());

    const moduleRef = await Test.createTestingModule({
      providers: [
        CourseClassesService,
        { provide: DataSource, useValue: dataSource },
        { provide: CoursesService, useValue: courses },
        { provide: EnrollmentCountsService, useValue: enrollmentCounts },
      ],
    }).compile();

    service = moduleRef.get(CourseClassesService);
  });

  describe("listCourseClasses()", () => {
    it("answers 404 COURSE_NOT_FOUND when the course does not exist, and reads no class", async () => {
      state.course = null;

      const failure = await httpFailure(service.listCourseClasses(BASIC_ID, {}));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "COURSE_NOT_FOUND",
        message: "Course not found.",
      });
      expect(dataSource.getRepository).not.toHaveBeenCalled();
      expect(builder.getRawMany).not.toHaveBeenCalled();
      expect(enrollmentCounts.countActiveByClass).not.toHaveBeenCalled();
    });

    it("asks the catalog for the course with no manager and no lock: a plain read", async () => {
      await service.listCourseClasses(BASIC_ID, {});

      expect(courses.getCourseSummary).toHaveBeenCalledTimes(1);
      expect(courses.getCourseSummary).toHaveBeenCalledWith(BASIC_ID);
    });

    it("lists an archived course's classes (200)", async () => {
      state.course = buildCourse({ status: CourseStatus.ARCHIVED });

      const result = await service.listCourseClasses(BASIC_ID, {});

      expect(result.total).toBe(1);
      expect(result.data.map((item) => item.id)).toEqual([CLASS_A_ID]);
    });

    it("filters by course, leaves archived classes out, orders by edition desc then code, and paginates", async () => {
      await service.listCourseClasses(BASIC_ID, { page: 3, limit: 10 });

      expect(dataSource.getRepository).toHaveBeenCalledWith(SchoolClass);
      expect(repository.createQueryBuilder).toHaveBeenCalledWith("school_class");
      expect(builder.innerJoin).toHaveBeenCalledWith(
        Edition,
        "edition",
        "edition.id = school_class.edition_id",
      );
      expect(builder.where).toHaveBeenCalledWith("school_class.course_id = :courseId", {
        courseId: BASIC_ID,
      });
      expect(builder.andWhere).toHaveBeenCalledWith("school_class.archived_at IS NULL");
      expect(builder.orderBy).toHaveBeenCalledTimes(1);
      expect(builder.orderBy).toHaveBeenCalledWith("edition.name", "DESC");
      expect(builder.addOrderBy.mock.calls).toEqual([
        ["LOWER(school_class.code)", "ASC"],
        ["school_class.id", "ASC"],
      ]);
      // Page 3 of 10 starts after 20 rows.
      expect(builder.offset).toHaveBeenCalledWith(20);
      expect(builder.limit).toHaveBeenCalledWith(10);
      expect(builder.getCount).toHaveBeenCalledTimes(1);
    });

    it("counts with the same filters as the page, so total is the number of classes of the course", async () => {
      state.total = 42;

      const result = await service.listCourseClasses(BASIC_ID, { page: 2, limit: 10 });

      // Page and count are two clones of one builder: they cannot filter differently.
      expect(builder.clone).toHaveBeenCalledTimes(2);
      expect(builder.where).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ total: 42, page: 2, limit: 10 });
    });

    it("defaults to the first page of 20, and caps the limit at 100", async () => {
      const first = await service.listCourseClasses(BASIC_ID, {});
      expect(first).toMatchObject({ page: 1, limit: 20 });
      expect(builder.offset).toHaveBeenLastCalledWith(0);
      expect(builder.limit).toHaveBeenLastCalledWith(20);

      const capped = await service.listCourseClasses(BASIC_ID, { limit: 500 });
      expect(capped.limit).toBe(100);
      expect(builder.limit).toHaveBeenLastCalledWith(100);
    });

    it("applies the status filter only when sent", async () => {
      await service.listCourseClasses(BASIC_ID, {});
      expect(builder.andWhere).toHaveBeenCalledTimes(1);
      expect(builder.andWhere).not.toHaveBeenCalledWith(
        "school_class.status = :status",
        expect.anything(),
      );

      builder.andWhere.mockClear();
      await service.listCourseClasses(BASIC_ID, { status: ClassStatus.IN_PROGRESS });
      expect(builder.andWhere).toHaveBeenCalledTimes(2);
      expect(builder.andWhere).toHaveBeenCalledWith("school_class.archived_at IS NULL");
      expect(builder.andWhere).toHaveBeenCalledWith("school_class.status = :status", {
        status: ClassStatus.IN_PROGRESS,
      });
    });

    it("reads the dates as text, so they stay YYYY-MM-DD with no time zone", async () => {
      await service.listCourseClasses(BASIC_ID, {});

      expect(builder.addSelect).toHaveBeenCalledWith("school_class.start_date::text", "startDate");
      expect(builder.addSelect).toHaveBeenCalledWith("school_class.end_date::text", "endDate");
    });

    it("asks the enrollment counts once for the whole page and defaults to 0", async () => {
      state.rows = [
        buildRow({ id: CLASS_A_ID, code: "INFO-A" }),
        buildRow({ id: CLASS_B_ID, code: "INFO-B" }),
      ];
      state.total = 2;
      enrollmentCounts.countActiveByClass.mockResolvedValue(new Map([[CLASS_A_ID, 7]]));

      const result = await service.listCourseClasses(BASIC_ID, {});

      // One call, for both classes of the page, on the manager of the data source: no N+1.
      expect(enrollmentCounts.countActiveByClass).toHaveBeenCalledTimes(1);
      expect(enrollmentCounts.countActiveByClass).toHaveBeenCalledWith(manager, [
        CLASS_A_ID,
        CLASS_B_ID,
      ]);
      expect(result.data.map((item) => [item.id, item.enrolledCount])).toEqual([
        [CLASS_A_ID, 7],
        [CLASS_B_ID, 0],
      ]);
    });

    it("answers 0 for everybody while the enrollments do not exist: the map comes empty", async () => {
      state.rows = [buildRow({ id: CLASS_A_ID }), buildRow({ id: CLASS_B_ID, code: "INFO-B" })];

      const result = await service.listCourseClasses(BASIC_ID, {});

      expect(result.data.map((item) => item.enrolledCount)).toEqual([0, 0]);
    });

    it("does not ask the enrollment counts for an empty page", async () => {
      state.rows = [];
      state.total = 0;

      const result = await service.listCourseClasses(BASIC_ID, {});

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
      expect(enrollmentCounts.countActiveByClass).not.toHaveBeenCalled();
    });

    it("maps each row to the item of the contract, and to nothing else", async () => {
      state.rows = [
        buildRow({
          id: CLASS_B_ID,
          code: "INFO-B",
          name: "Informática Básica, turma B",
          editionId: EDITION_ID,
          editionName: "2026.2",
          startDate: "2026-08-03",
          endDate: "2026-12-12",
          capacity: 20,
          status: ClassStatus.IN_PROGRESS,
          // What the query never selects, but a row from elsewhere could carry.
          courseId: BASIC_ID,
          location: "Sala 2",
          archivedAt: null,
        }),
      ];
      enrollmentCounts.countActiveByClass.mockResolvedValue(new Map([[CLASS_B_ID, 12]]));

      const result = await service.listCourseClasses(BASIC_ID, {});

      expect(result.data).toEqual([
        {
          id: CLASS_B_ID,
          code: "INFO-B",
          name: "Informática Básica, turma B",
          edition: { id: EDITION_ID, name: "2026.2" },
          startDate: "2026-08-03",
          endDate: "2026-12-12",
          enrolledCount: 12,
          capacity: 20,
          status: ClassStatus.IN_PROGRESS,
        },
      ]);
    });

    it("keeps the order of the rows it got", async () => {
      state.rows = [
        buildRow({ id: CLASS_B_ID, code: "INFO-B", editionName: "2026.2" }),
        buildRow({ id: CLASS_A_ID, code: "INFO-A", editionName: "2026.1" }),
      ];

      const result = await service.listCourseClasses(BASIC_ID, {});

      expect(result.data.map((item) => item.id)).toEqual([CLASS_B_ID, CLASS_A_ID]);
    });
  });

  describe("summarizeByCourse()", () => {
    it("answers one item per requested id, in request order, without duplicates, zero for a course without classes", async () => {
      dataSource.query.mockResolvedValue([{ courseId: BASIC_ID, total: 2, active: 2 }]);

      const result = await service.summarizeByCourse([
        BASIC_ID,
        SMARTPHONES_ID,
        BASIC_ID,
        ADVANCED_ID,
        SMARTPHONES_ID,
      ]);

      expect(result).toEqual([
        { courseId: BASIC_ID, total: 2, active: 2 },
        { courseId: SMARTPHONES_ID, total: 0, active: 0 },
        { courseId: ADVANCED_ID, total: 0, active: 0 },
      ]);
    });

    it("follows the order of the request and not the one of the rows", async () => {
      dataSource.query.mockResolvedValue([
        { courseId: ADVANCED_ID, total: 1, active: 0 },
        { courseId: BASIC_ID, total: 3, active: 2 },
      ]);

      const result = await service.summarizeByCourse([BASIC_ID, ADVANCED_ID]);

      expect(result.map((item) => item.courseId)).toEqual([BASIC_ID, ADVANCED_ID]);
      expect(result).toEqual([
        { courseId: BASIC_ID, total: 3, active: 2 },
        { courseId: ADVANCED_ID, total: 1, active: 0 },
      ]);
    });

    it("asks the database once, with the ids that are left after the duplicates go", async () => {
      dataSource.query.mockResolvedValue([]);

      await service.summarizeByCourse([BASIC_ID, SMARTPHONES_ID, BASIC_ID]);

      expect(dataSource.query).toHaveBeenCalledTimes(1);
      const [sql, parameters] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(parameters).toEqual([
        [BASIC_ID, SMARTPHONES_ID],
        ["planned", "in_progress"],
      ]);
      expect(sql).toContain("course_id = ANY($1::uuid[])");
      expect(sql).toContain("GROUP BY course_id");
    });

    it("counts only what is not archived and not deleted, and calls active the planned and in progress ones", async () => {
      dataSource.query.mockResolvedValue([]);

      await service.summarizeByCourse([BASIC_ID]);

      const [sql, parameters] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("archived_at IS NULL");
      expect(sql).toContain("deleted_at IS NULL");
      expect(sql).toContain("COUNT(*) FILTER (WHERE status = ANY($2::classes_status_enum[]))::int");
      expect(parameters[1]).toEqual([ClassStatus.PLANNED, ClassStatus.IN_PROGRESS]);
      expect(sql).toContain("COUNT(*)::int AS total");
    });

    it("does not ask the catalog: an id that is not a course answers zeros", async () => {
      dataSource.query.mockResolvedValue([]);

      const result = await service.summarizeByCourse([BASIC_ID]);

      expect(result).toEqual([{ courseId: BASIC_ID, total: 0, active: 0 }]);
      expect(courses.getCourseSummary).not.toHaveBeenCalled();
    });

    it("answers an empty list for no ids, without asking the database", async () => {
      await expect(service.summarizeByCourse([])).resolves.toEqual([]);

      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it("answers only total and active next to the course, whatever the row carries", async () => {
      dataSource.query.mockResolvedValue([
        { courseId: BASIC_ID, total: 4, active: 3, extra: "not for the contract" },
      ]);

      const [item] = await service.summarizeByCourse([BASIC_ID]);

      expect(Object.keys(item).sort()).toEqual(["active", "courseId", "total"]);
    });
  });
});
