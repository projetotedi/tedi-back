import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { PeopleService } from "@modules/people/services/people.service";
import { LessonPlanResponseDto } from "../dto/lesson-plan.response.dto";
import { LessonPlan } from "../entities/lesson-plan.entity";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import { LessonPlanUsageStatus } from "../enums/lesson-plan-usage-status.enum";
import { LessonPlanUsageRow } from "../services/lesson-plan-usage.mapper";
import { LessonPlanUsageService } from "../services/lesson-plan-usage.service";
import { LessonPlansService, lessonPlanNotFound } from "../services/lesson-plans.service";

const PLAN_ID = "01999a3e-7c1b-7000-8000-00000000000a";
const UPPER_PLAN_ID = PLAN_ID.toUpperCase();
const CREATOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const COURSE_A_ID = "01999a3e-7c1b-7000-8000-0000000000a1";
const COURSE_B_ID = "01999a3e-7c1b-7000-8000-0000000000b1";
const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");

const PLAN: LessonPlanResponseDto = {
  id: PLAN_ID,
  title: "Teclado, mouse e janelas",
  objective: null,
  expectedDurationMinutes: 90,
  contents: ["Teclado e mouse"],
  materialUrl: null,
  archivedAt: null,
  archivedById: null,
  archiveReason: null,
  createdById: CREATOR_ID,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

const ROW_A: LessonPlanUsageRow = {
  courseId: COURSE_A_ID,
  courseName: "Curso A",
  category: CourseCategory.BASIC,
  courseArchivedAt: null,
  position: 2,
  lessonPlanCount: 4,
  currentWorkloadMinutes: 360,
  newWorkloadMinutes: 390,
};

const ROW_B: LessonPlanUsageRow = {
  courseId: COURSE_B_ID,
  courseName: "Curso B",
  category: CourseCategory.ADVANCED,
  courseArchivedAt: new Date("2026-10-01T13:00:00.000Z"),
  position: 5,
  lessonPlanCount: 6,
  currentWorkloadMinutes: 600,
  newWorkloadMinutes: 630,
};

async function httpFailure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error("Expected the promise to reject with an HttpException");
}

describe("LessonPlanUsageService", () => {
  let service: LessonPlanUsageService;

  const planRepository = { findOne: jest.fn() };
  const dataSource = { query: jest.fn(), getRepository: jest.fn(), transaction: jest.fn() };
  const lessonPlansService = { findById: jest.fn() };
  const peopleService = { findRefsByIds: jest.fn() };
  const eventEmitter = { emit: jest.fn() };

  /** The parameters `[lessonPlanId, newDurationMinutes]` of the one usage query that ran. */
  function usageQueryParams(): unknown[] {
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    return dataSource.query.mock.calls[0][1] as unknown[];
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    lessonPlansService.findById.mockResolvedValue(PLAN);
    peopleService.findRefsByIds.mockResolvedValue([{ id: CREATOR_ID, name: "Carla Menezes" }]);
    dataSource.query.mockResolvedValue([ROW_B, ROW_A]);
    dataSource.getRepository.mockReturnValue(planRepository);
    planRepository.findOne.mockResolvedValue({ id: PLAN_ID, expectedDurationMinutes: 90 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LessonPlanUsageService,
        { provide: DataSource, useValue: dataSource },
        { provide: LessonPlansService, useValue: lessonPlansService },
        { provide: PeopleService, useValue: peopleService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = moduleRef.get(LessonPlanUsageService);
  });

  describe("getDetail()", () => {
    it("reads the usage with the id from the database and no new duration", async () => {
      await service.getDetail(UPPER_PLAN_ID);

      expect(lessonPlansService.findById).toHaveBeenCalledWith(UPPER_PLAN_ID);
      expect(usageQueryParams()).toEqual([PLAN_ID, null]);
    });

    it("answers the plan, its usedIn in the order of the course names and the status in_use", async () => {
      const detail = await service.getDetail(PLAN_ID);

      expect(detail).toEqual({
        ...PLAN,
        status: LessonPlanUsageStatus.IN_USE,
        createdBy: { id: CREATOR_ID, name: "Carla Menezes" },
        usedIn: [
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
            courseStatus: CourseStatus.ARCHIVED,
          },
        ],
      });
    });

    it("answers usedIn [] and status unused when no course uses the plan", async () => {
      dataSource.query.mockResolvedValue([]);

      const detail = await service.getDetail(PLAN_ID);

      expect(detail.usedIn).toEqual([]);
      expect(detail.status).toBe(LessonPlanUsageStatus.UNUSED);
    });

    it("answers createdBy from PeopleService and null when the person is not found", async () => {
      const found = await service.getDetail(PLAN_ID);

      expect(peopleService.findRefsByIds).toHaveBeenCalledWith([CREATOR_ID]);
      expect(found.createdBy).toEqual({ id: CREATOR_ID, name: "Carla Menezes" });

      peopleService.findRefsByIds.mockResolvedValue([]);

      const notFound = await service.getDetail(PLAN_ID);

      expect(notFound.createdBy).toBeNull();
    });

    it("propagates 404 LESSON_PLAN_NOT_FOUND without querying the usage or people", async () => {
      lessonPlansService.findById.mockRejectedValue(lessonPlanNotFound());

      const failure = await httpFailure(service.getDetail(UPPER_PLAN_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toMatchObject({ error: "LESSON_PLAN_NOT_FOUND" });
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(peopleService.findRefsByIds).not.toHaveBeenCalled();
    });
  });

  describe("getUsage()", () => {
    it("passes the new duration to the query and answers both durations", async () => {
      const usage = await service.getUsage(PLAN_ID, 120);

      expect(usageQueryParams()).toEqual([PLAN_ID, 120]);
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

    it("without a new duration passes null and answers newDurationMinutes equal to the current one", async () => {
      const usage = await service.getUsage(PLAN_ID);

      expect(usageQueryParams()).toEqual([PLAN_ID, null]);
      expect(usage.currentDurationMinutes).toBe(90);
      expect(usage.newDurationMinutes).toBe(90);
    });

    it("looks the plan up by the requested id and uses the id from the database from then on", async () => {
      const usage = await service.getUsage(UPPER_PLAN_ID, 120);

      expect(dataSource.getRepository).toHaveBeenCalledWith(LessonPlan);
      expect(planRepository.findOne).toHaveBeenCalledWith({
        where: { id: UPPER_PLAN_ID },
        select: { id: true, expectedDurationMinutes: true },
      });
      expect(usageQueryParams()).toEqual([PLAN_ID, 120]);
      expect(usage.lessonPlanId).toBe(PLAN_ID);
    });

    it("answers courses [] for a plan in no course", async () => {
      dataSource.query.mockResolvedValue([]);

      const usage = await service.getUsage(PLAN_ID, 120);

      expect(usage.courses).toEqual([]);
      expect(usage.newDurationMinutes).toBe(120);
    });

    it("throws 404 LESSON_PLAN_NOT_FOUND without running the usage query", async () => {
      planRepository.findOne.mockResolvedValue(null);

      const failure = await httpFailure(service.getUsage(PLAN_ID, 120));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toMatchObject({
        error: "LESSON_PLAN_NOT_FOUND",
        message: "Lesson plan not found.",
      });
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  it("reads without a transaction, a lock or an audit event", async () => {
    await service.getDetail(PLAN_ID);
    await service.getUsage(PLAN_ID, 120);

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(planRepository.findOne.mock.calls[0][0]).not.toHaveProperty("lock");
    for (const [sql] of dataSource.query.mock.calls as Array<[string, unknown[]]>) {
      expect(sql).toMatch(/^\s*SELECT\b/);
      expect(sql).not.toMatch(/\bFOR\s+(NO\s+KEY\s+)?(UPDATE|SHARE)\b/i);
    }
  });
});
