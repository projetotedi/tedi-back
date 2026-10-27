import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { PeopleService } from "@modules/people/services/people.service";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import { CourseLessonPlanItemResponseDto } from "../dto/course-lesson-plan-item.response.dto";
import { CourseLessonPlansResponseDto } from "../dto/course-lesson-plans.response.dto";
import { Course } from "../entities/course.entity";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import { RelatedCourseRow } from "../services/course-detail.mapper";
import { CourseDetailService } from "../services/course-detail.service";
import { CourseLessonPlansService } from "../services/course-lesson-plans.service";

const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
const ARCHIVED_AT = new Date("2026-10-10T12:00:00.000Z");

const CREATOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000002";
const BASIC_ID = "01999a3e-7c1b-7000-8000-000000000001";
const ADVANCED_ID = "01999a3e-7c1b-7000-8000-000000000003";
const FIRST_PLAN_ID = "01999a3e-7c1b-7000-8000-000000000011";
const SECOND_PLAN_ID = "01999a3e-7c1b-7000-8000-000000000012";
const THIRD_PLAN_ID = "01999a3e-7c1b-7000-8000-000000000013";
const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

type CourseOverrides = Partial<Omit<Course, "archive">> & { archive?: Partial<ArchivableColumns> };

function buildCourse(overrides: CourseOverrides = {}): Course {
  const { archive, ...rest } = overrides;
  return Object.assign(new Course(), {
    id: COURSE_ID,
    name: "Informática Intermediária",
    description: "Planilhas, textos e apresentações.",
    objective: "Preparar o aluno para as ferramentas de escritório.",
    category: CourseCategory.INTERMEDIATE,
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
): CourseLessonPlansResponseDto {
  return {
    courseId: COURSE_ID,
    plannedWorkloadMinutes: items.reduce((sum, item) => sum + item.expectedDurationMinutes, 0),
    items,
  };
}

function buildRow(overrides: Partial<RelatedCourseRow> = {}): RelatedCourseRow {
  return {
    relation: "prerequisite",
    id: BASIC_ID,
    name: "Informática Básica",
    category: CourseCategory.BASIC,
    archivedAt: null,
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

describe("CourseDetailService", () => {
  let service: CourseDetailService;
  let state: {
    course: Course | null;
    related: RelatedCourseRow[];
    sequence: CourseLessonPlansResponseDto;
    person: Record<string, unknown> | null;
  };

  const manager = { query: jest.fn() };
  const courseRepository = { findOne: jest.fn() };
  const dataSource = { getRepository: jest.fn(), transaction: jest.fn(), manager };
  const courseLessonPlansService = { readSequence: jest.fn() };
  const peopleService = { findById: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    state = {
      course: buildCourse(),
      related: [],
      sequence: buildSequence(),
      person: { id: CREATOR_ID, name: "Carla Menezes" },
    };

    dataSource.getRepository.mockReturnValue(courseRepository);
    courseRepository.findOne.mockImplementation(async () => state.course);
    manager.query.mockImplementation(async () => state.related);
    courseLessonPlansService.readSequence.mockImplementation(async () => state.sequence);
    peopleService.findById.mockImplementation(async () => state.person);

    const moduleRef = await Test.createTestingModule({
      providers: [
        CourseDetailService,
        { provide: DataSource, useValue: dataSource },
        { provide: CourseLessonPlansService, useValue: courseLessonPlansService },
        { provide: PeopleService, useValue: peopleService },
      ],
    }).compile();

    service = moduleRef.get(CourseDetailService);
  });

  describe("findDetail()", () => {
    it("throws 404 COURSE_NOT_FOUND and reads nothing else", async () => {
      state.course = null;

      const failure = await httpFailure(service.findDetail(UNKNOWN_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "COURSE_NOT_FOUND",
        message: "Course not found.",
      });
      expect(courseRepository.findOne).toHaveBeenCalledTimes(1);
      expect(manager.query).not.toHaveBeenCalled();
      expect(courseLessonPlansService.readSequence).not.toHaveBeenCalled();
      expect(peopleService.findById).not.toHaveBeenCalled();
    });

    it("reads the course once, the related courses once, the sequence once and the creator once", async () => {
      await service.findDetail(COURSE_ID);

      expect(dataSource.getRepository).toHaveBeenCalledWith(Course);
      expect(courseRepository.findOne).toHaveBeenCalledTimes(1);
      expect(courseRepository.findOne).toHaveBeenCalledWith({ where: { id: COURSE_ID } });
      expect(manager.query).toHaveBeenCalledTimes(1);
      expect(courseLessonPlansService.readSequence).toHaveBeenCalledTimes(1);
      expect(peopleService.findById).toHaveBeenCalledTimes(1);
      expect(peopleService.findById).toHaveBeenCalledWith(CREATOR_ID);
    });

    it("uses the id stored in the database, not the requested one, for the related courses and the sequence", async () => {
      const requestedId = COURSE_ID.toUpperCase();

      const detail = await service.findDetail(requestedId);

      // The requested id is only the key of the lookup...
      expect(courseRepository.findOne).toHaveBeenCalledWith({ where: { id: requestedId } });
      // ...and everything after it uses the id the row has.
      expect(manager.query).toHaveBeenCalledWith(expect.any(String), [COURSE_ID]);
      expect(courseLessonPlansService.readSequence).toHaveBeenCalledWith(manager, COURSE_ID);
      expect(detail.id).toBe(COURSE_ID);
    });

    it("returns an archived course with status archived", async () => {
      state.course = buildCourse({ archive: { archivedAt: ARCHIVED_AT } });

      const detail = await service.findDetail(COURSE_ID);

      expect(detail.status).toBe(CourseStatus.ARCHIVED);
      expect(detail.id).toBe(COURSE_ID);
      expect(manager.query).toHaveBeenCalledTimes(1);
      expect(courseLessonPlansService.readSequence).toHaveBeenCalledTimes(1);
    });

    it("answers status active for a course that is not archived", async () => {
      const detail = await service.findDetail(COURSE_ID);

      expect(detail.status).toBe(CourseStatus.ACTIVE);
    });

    it("answers createdBy { id, name } of the creator and null when the person is not found", async () => {
      const found = await service.findDetail(COURSE_ID);

      expect(found.createdBy).toEqual({ id: CREATOR_ID, name: "Carla Menezes" });

      state.person = null;
      const removed = await service.findDetail(COURSE_ID);

      expect(removed.createdBy).toBeNull();
      expect(removed.id).toBe(COURSE_ID);
    });

    it("answers only the id and the name of the creator, whatever else the person has", async () => {
      state.person = {
        id: CREATOR_ID,
        name: "Carla Menezes",
        email: "carla@example.com",
        ra: "ra123",
        passwordHash: "hash",
        role: "director",
      };

      const detail = await service.findDetail(COURSE_ID);

      expect(Object.keys(detail.createdBy ?? {}).sort()).toEqual(["id", "name"]);
    });

    it("maps the rows of the related query into prerequisites and requiredBy", async () => {
      state.related = [
        buildRow({
          relation: "requiredBy",
          id: ADVANCED_ID,
          name: "Informática Avançada",
          category: CourseCategory.ADVANCED,
        }),
        buildRow({ relation: "prerequisite", id: BASIC_ID, name: "Informática Básica" }),
      ];

      const detail = await service.findDetail(COURSE_ID);

      expect(detail.prerequisites).toEqual([
        { id: BASIC_ID, name: "Informática Básica", category: "basic", status: "active" },
      ]);
      expect(detail.requiredBy).toEqual([
        { id: ADVANCED_ID, name: "Informática Avançada", category: "advanced", status: "active" },
      ]);
    });

    it("keeps an archived prerequisite and an archived course that requires this one, with status archived", async () => {
      state.related = [
        buildRow({ relation: "prerequisite", archivedAt: ARCHIVED_AT }),
        buildRow({
          relation: "requiredBy",
          id: ADVANCED_ID,
          name: "Informática Avançada",
          category: CourseCategory.ADVANCED,
          archivedAt: ARCHIVED_AT,
        }),
      ];

      const detail = await service.findDetail(COURSE_ID);

      expect(detail.prerequisites.map((course) => course.status)).toEqual([CourseStatus.ARCHIVED]);
      expect(detail.requiredBy.map((course) => course.status)).toEqual([CourseStatus.ARCHIVED]);
    });

    it("answers the sequence as read, with the workload and the count of lesson plans", async () => {
      const items = [
        buildItem(THIRD_PLAN_ID, 1, 60),
        buildItem(FIRST_PLAN_ID, 2, 90),
        buildItem(SECOND_PLAN_ID, 3, 120),
      ];
      state.sequence = buildSequence(items);

      const detail = await service.findDetail(COURSE_ID);

      expect(detail.lessonPlans).toEqual(items);
      expect(detail.plannedWorkloadMinutes).toBe(270);
      expect(detail.lessonPlanCount).toBe(3);
    });

    it("answers empty lists and workload 0 for a course with no prerequisites, no one requiring it and no plans", async () => {
      const detail = await service.findDetail(COURSE_ID);

      expect(detail.prerequisites).toEqual([]);
      expect(detail.requiredBy).toEqual([]);
      expect(detail.lessonPlans).toEqual([]);
      expect(detail.plannedWorkloadMinutes).toBe(0);
      expect(detail.lessonPlanCount).toBe(0);
    });

    it("reads without a transaction and without a lock", async () => {
      await service.findDetail(COURSE_ID);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      const options = courseRepository.findOne.mock.calls[0][0] as Record<string, unknown>;
      expect(options).not.toHaveProperty("lock");
    });

    it("asks for the related courses in both directions, archived ones included and deleted rows skipped", async () => {
      await service.findDetail(COURSE_ID);

      const [sql, parameters] = manager.query.mock.calls[0] as [string, unknown[]];
      expect(parameters).toEqual([COURSE_ID]);
      // One half for the courses that this one requires, the other for the courses that require it.
      expect(sql).toContain("UNION ALL");
      expect(sql).toContain("link.course_id = $1");
      expect(sql).toContain("link.prerequisite_id = $1");
      expect(sql.match(/FROM course_prerequisites link/g)).toHaveLength(2);
      expect(sql.match(/link\.deleted_at IS NULL/g)).toHaveLength(2);
      expect(sql.match(/c\.deleted_at IS NULL/g)).toHaveLength(2);
      // The status is read, never filtered on: an archived course stays in both lists.
      expect(sql).toContain('c.archived_at AS "archivedAt"');
      expect(sql).not.toMatch(/archived_at\s+IS/i);
    });

    it("keeps any error of the reads as it came", async () => {
      const failure = new Error("connection lost");
      courseLessonPlansService.readSequence.mockRejectedValueOnce(failure);

      await expect(service.findDetail(COURSE_ID)).rejects.toBe(failure);
    });
  });
});
