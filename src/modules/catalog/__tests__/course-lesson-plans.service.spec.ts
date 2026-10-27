import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { CourseLessonPlan } from "../entities/course-lesson-plan.entity";
import { Course } from "../entities/course.entity";
import { LessonPlanContent } from "../entities/lesson-plan-content.entity";
import { LessonPlan } from "../entities/lesson-plan.entity";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseLessonPlanRow } from "../services/course-lesson-plans-response.mapper";
import { CourseLessonPlansService, findDuplicateId } from "../services/course-lesson-plans.service";

const NOW = new Date("2026-10-02T01:30:00.000Z");
const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000009";
const FIRST_ID = "01999a3e-7c1b-7000-8000-000000000001";
const SECOND_ID = "01999a3e-7c1b-7000-8000-000000000002";
const THIRD_ID = "01999a3e-7c1b-7000-8000-000000000003";
const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

type Overrides<T> = Partial<Omit<T, "archive">> & { archive?: Partial<ArchivableColumns> };

function buildArchive(archive: Partial<ArchivableColumns> = {}): ArchivableColumns {
  return Object.assign(new ArchivableColumns(), {
    archivedAt: null,
    archivedById: null,
    archiveReason: null,
    ...archive,
  });
}

function buildCourse(overrides: Overrides<Course> = {}): Course {
  const { archive, ...rest } = overrides;
  return Object.assign(new Course(), {
    id: COURSE_ID,
    name: "Informática Intermediária",
    description: "Planilhas, textos e apresentações.",
    objective: null,
    category: CourseCategory.INTERMEDIATE,
    createdById: ACTOR_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    archive: buildArchive(archive),
    ...rest,
  });
}

function buildPlan(id: string, overrides: Overrides<LessonPlan> = {}): LessonPlan {
  const { archive, ...rest } = overrides;
  return Object.assign(new LessonPlan(), {
    id,
    title: `Plano ${id.slice(-1)}`,
    objective: null,
    expectedDurationMinutes: 90,
    materialUrl: null,
    createdById: ACTOR_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    archive: buildArchive(archive),
    ...rest,
  });
}

function buildLink(lessonPlanId: string, position: number, courseId = COURSE_ID): CourseLessonPlan {
  return Object.assign(new CourseLessonPlan(), {
    id: `link-${courseId}-${lessonPlanId}`,
    courseId,
    lessonPlanId,
    position,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  });
}

function buildRow(
  lessonPlanId: string,
  position: number,
  overrides: Partial<CourseLessonPlanRow> = {},
): CourseLessonPlanRow {
  return {
    position,
    lessonPlanId,
    title: `Plano ${lessonPlanId.slice(-1)}`,
    expectedDurationMinutes: 90,
    materialUrl: null,
    archivedAt: null,
    courseCount: 1,
    ...overrides,
  };
}

function buildContent(lessonPlanId: string, position: number, text: string): LessonPlanContent {
  return Object.assign(new LessonPlanContent(), {
    id: `content-${lessonPlanId}-${position}`,
    lessonPlanId,
    position,
    text,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  });
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

describe("findDuplicateId()", () => {
  it("returns the first repeated id and null for a list without repetitions", () => {
    expect(findDuplicateId([FIRST_ID, SECOND_ID, FIRST_ID])).toBe(FIRST_ID);
    expect(findDuplicateId([FIRST_ID, SECOND_ID, SECOND_ID, FIRST_ID])).toBe(SECOND_ID);
    expect(findDuplicateId([FIRST_ID, FIRST_ID])).toBe(FIRST_ID);

    expect(findDuplicateId([FIRST_ID, SECOND_ID, THIRD_ID])).toBeNull();
    expect(findDuplicateId([FIRST_ID])).toBeNull();
    expect(findDuplicateId([])).toBeNull();
  });
});

describe("CourseLessonPlansService", () => {
  let service: CourseLessonPlansService;
  let order: string[];
  let state: {
    course: Course | null;
    links: CourseLessonPlan[];
    plans: LessonPlan[];
    sequenceRows: CourseLessonPlanRow[];
    contents: LessonPlanContent[];
  };

  const manager = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    query: jest.fn(),
  };
  const courseRepository = { findOne: jest.fn() };
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn(), manager };
  const eventEmitter = { emit: jest.fn() };

  function emittedEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls.map((call) => call[1] as AuditableActionEvent);
  }

  /** The ids the service asked the plans lock for: the `In([...])` of the find on LessonPlan. */
  function lockedPlanIds(): string[] {
    const call = manager.find.mock.calls.find((args) => args[0] === LessonPlan);
    if (call === undefined) throw new Error("The lesson plans were not looked up");

    return (call[1] as { where: { id: { value: string[] } } }).where.id.value;
  }

  function insertedLinks(): CourseLessonPlan[] {
    const call = manager.save.mock.calls.find((args) => Array.isArray(args[0]));
    return (call?.[0] ?? []) as CourseLessonPlan[];
  }

  function savedCourses(): Course[] {
    return manager.save.mock.calls
      .filter((args) => args[0] instanceof Course)
      .map((args) => args[0] as Course);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    order = [];
    const course = buildCourse();
    state = {
      course,
      links: [],
      plans: [buildPlan(FIRST_ID), buildPlan(SECOND_ID), buildPlan(THIRD_ID)],
      sequenceRows: [],
      contents: [],
    };

    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), {
        id: `link-${String(data.lessonPlanId)}`,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        deletedAt: null,
        ...data,
      }),
    );
    manager.save.mockImplementation(async (entity: unknown) => {
      order.push(Array.isArray(entity) ? "insert-links" : "save-course");
      return entity;
    });
    manager.find.mockImplementation(
      async (target: unknown, options: { where: { id?: { value: string[] } } }) => {
        if (target === CourseLessonPlan) {
          order.push("load-links");
          return state.links;
        }
        if (target === LessonPlan) {
          order.push("lock-plans");
          const ids = options.where.id?.value ?? [];
          return state.plans.filter((plan) => ids.includes(plan.id));
        }
        if (target === LessonPlanContent) {
          order.push("load-contents");
          return state.contents;
        }
        return [];
      },
    );
    manager.findOne.mockImplementation(async (target: unknown) => {
      if (target !== Course) return null;
      order.push("load-course");
      return state.course;
    });
    manager.delete.mockImplementation(async () => {
      order.push("delete-links");
      return { affected: state.links.length };
    });
    manager.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM course_lesson_plans link")) {
        order.push("read-sequence");
        return state.sequenceRows;
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => Promise<unknown>) => {
        const result = await callback(manager);
        order.push("commit");
        return result;
      },
    );
    dataSource.getRepository.mockReturnValue(courseRepository);
    courseRepository.findOne.mockImplementation(async () => state.course);
    eventEmitter.emit.mockImplementation(() => {
      order.push("emit");
      return true;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        CourseLessonPlansService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: { now: () => NOW } },
      ],
    }).compile();

    service = moduleRef.get(CourseLessonPlansService);
  });

  describe("replace()", () => {
    it("throws 400 DUPLICATE_LESSON_PLAN for [P1, P1] before opening a transaction", async () => {
      const failure = await httpFailure(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID, FIRST_ID] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "DUPLICATE_LESSON_PLAN",
        message: "The same lesson plan appears more than once in the sequence.",
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("answers DUPLICATE_LESSON_PLAN before COURSE_NOT_FOUND and before COURSE_ARCHIVED", async () => {
      state.course = null;
      const unknownCourse = await httpFailure(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID, SECOND_ID, FIRST_ID] }, ACTOR_ID),
      );

      state.course = buildCourse({ archive: { archivedAt: CREATED_AT } });
      const archivedCourse = await httpFailure(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID, SECOND_ID, FIRST_ID] }, ACTOR_ID),
      );

      expect(unknownCourse.getResponse()).toMatchObject({ error: "DUPLICATE_LESSON_PLAN" });
      expect(archivedCourse.getResponse()).toMatchObject({ error: "DUPLICATE_LESSON_PLAN" });
    });

    it("returns 404 COURSE_NOT_FOUND", async () => {
      state.course = null;

      const failure = await httpFailure(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "COURSE_NOT_FOUND",
        message: "Course not found.",
      });
      expect(manager.find).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("locks the course row FOR UPDATE (pessimistic_write)", async () => {
      await service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID] }, ACTOR_ID);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.findOne).toHaveBeenCalledWith(Course, {
        where: { id: COURSE_ID },
        lock: { mode: "pessimistic_write" },
      });
      // The course is the first thing the transaction reads: every other lock comes after it.
      expect(order[0]).toBe("load-course");
    });

    it("returns 409 COURSE_ARCHIVED and writes nothing", async () => {
      state.course = buildCourse({ archive: { archivedAt: CREATED_AT, archivedById: ACTOR_ID } });

      const failure = await httpFailure(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID, SECOND_ID] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "COURSE_ARCHIVED",
        message: "Archived courses are read-only.",
      });
      expect(manager.find).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("returns 409 COURSE_ARCHIVED even when the list is the same as the current one", async () => {
      state.course = buildCourse({ archive: { archivedAt: CREATED_AT } });
      state.links = [buildLink(FIRST_ID, 1)];

      const failure = await httpFailure(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID] }, ACTOR_ID),
      );

      expect(failure.getResponse()).toMatchObject({ error: "COURSE_ARCHIVED" });
      expect(order).not.toContain("read-sequence");
    });

    it("throws 400 LESSON_PLAN_NOT_FOUND when any id is not a lesson plan and writes nothing", async () => {
      const failure = await httpFailure(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID, UNKNOWN_ID] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "LESSON_PLAN_NOT_FOUND",
        message: "One or more lesson plans do not exist.",
      });
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("locks the lesson plans of the list FOR SHARE (pessimistic_read)", async () => {
      await service.replace(COURSE_ID, { lessonPlanIds: [THIRD_ID, FIRST_ID] }, ACTOR_ID);

      const call = manager.find.mock.calls.find((args) => args[0] === LessonPlan);
      expect(call?.[1]).toMatchObject({ lock: { mode: "pessimistic_read" } });
      expect(lockedPlanIds()).toEqual([THIRD_ID, FIRST_ID]);
      // Course first, then the plans, and both before the first write.
      expect(order.indexOf("load-course")).toBeLessThan(order.indexOf("lock-plans"));
      expect(order.indexOf("lock-plans")).toBeLessThan(order.indexOf("delete-links"));
    });

    it("does not look for lesson plans when the list is empty", async () => {
      state.links = [buildLink(FIRST_ID, 1)];

      await service.replace(COURSE_ID, { lessonPlanIds: [] }, ACTOR_ID);

      expect(order).not.toContain("lock-plans");
    });

    it("rejects a newly added archived plan with 400 LESSON_PLAN_ARCHIVED and keeps an already linked archived one", async () => {
      const archive = { archivedAt: CREATED_AT, archivedById: ACTOR_ID };
      state.plans = [buildPlan(FIRST_ID), buildPlan(SECOND_ID), buildPlan(THIRD_ID, { archive })];
      state.links = [buildLink(FIRST_ID, 1)];

      // P3 is archived and not in the sequence yet: refused.
      const failure = await httpFailure(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID, THIRD_ID] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "LESSON_PLAN_ARCHIVED",
        message: "An archived lesson plan cannot be added to a course.",
      });
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();

      // P3 is archived but already in the sequence: it stays, next to a new active plan.
      state.links = [buildLink(THIRD_ID, 1), buildLink(FIRST_ID, 2)];
      await service.replace(
        COURSE_ID,
        { lessonPlanIds: [FIRST_ID, SECOND_ID, THIRD_ID] },
        ACTOR_ID,
      );

      expect(manager.delete).toHaveBeenCalledTimes(1);
      expect(insertedLinks().map((link) => link.lessonPlanId)).toEqual([
        FIRST_ID,
        SECOND_ID,
        THIRD_ID,
      ]);
    });

    it("answers LESSON_PLAN_NOT_FOUND before LESSON_PLAN_ARCHIVED when both happen", async () => {
      state.plans = [buildPlan(FIRST_ID, { archive: { archivedAt: CREATED_AT } })];

      const failure = await httpFailure(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID, UNKNOWN_ID] }, ACTOR_ID),
      );

      expect(failure.getResponse()).toMatchObject({ error: "LESSON_PLAN_NOT_FOUND" });
    });

    it("deletes the links of the course and inserts positions 1, 2 and 3 in the order sent", async () => {
      state.links = [buildLink(SECOND_ID, 1)];

      await service.replace(
        COURSE_ID,
        { lessonPlanIds: [SECOND_ID, FIRST_ID, THIRD_ID] },
        ACTOR_ID,
      );

      expect(manager.delete).toHaveBeenCalledTimes(1);
      expect(manager.delete).toHaveBeenCalledWith(CourseLessonPlan, { courseId: COURSE_ID });
      expect(manager.create.mock.calls.map((call) => [call[0], call[1]])).toEqual([
        [CourseLessonPlan, { courseId: COURSE_ID, lessonPlanId: SECOND_ID, position: 1 }],
        [CourseLessonPlan, { courseId: COURSE_ID, lessonPlanId: FIRST_ID, position: 2 }],
        [CourseLessonPlan, { courseId: COURSE_ID, lessonPlanId: THIRD_ID, position: 3 }],
      ]);
      expect(insertedLinks().map((link) => [link.position, link.lessonPlanId])).toEqual([
        [1, SECOND_ID],
        [2, FIRST_ID],
        [3, THIRD_ID],
      ]);
      // The old rows go first, so the unique indexes never meet a leftover.
      expect(order).toEqual([
        "load-course",
        "load-links",
        "lock-plans",
        "delete-links",
        "insert-links",
        "save-course",
        "read-sequence",
        "commit",
        "emit",
      ]);
    });

    it("clears the links with [] and inserts nothing", async () => {
      state.links = [buildLink(FIRST_ID, 1), buildLink(SECOND_ID, 2)];

      const result = await service.replace(COURSE_ID, { lessonPlanIds: [] }, ACTOR_ID);

      expect(manager.delete).toHaveBeenCalledWith(CourseLessonPlan, { courseId: COURSE_ID });
      expect(manager.create).not.toHaveBeenCalled();
      expect(insertedLinks()).toEqual([]);
      expect(order).toEqual([
        "load-course",
        "load-links",
        "delete-links",
        "save-course",
        "read-sequence",
        "commit",
        "emit",
      ]);
      expect(result).toEqual({ courseId: COURSE_ID, plannedWorkloadMinutes: 0, items: [] });

      const [event] = emittedEvents();
      expect(event.before).toEqual({ lessonPlanIds: [FIRST_ID, SECOND_ID] });
      expect(event.after).toEqual({ lessonPlanIds: [] });
    });

    it("clears a sequence whose plans are archived", async () => {
      const archive = { archivedAt: CREATED_AT, archivedById: ACTOR_ID };
      state.plans = [buildPlan(FIRST_ID, { archive })];
      state.links = [buildLink(FIRST_ID, 1)];

      const result = await service.replace(COURSE_ID, { lessonPlanIds: [] }, ACTOR_ID);

      expect(result.items).toEqual([]);
      expect(manager.delete).toHaveBeenCalledTimes(1);
    });

    it("treats the same ids in another order as a change", async () => {
      state.links = [buildLink(FIRST_ID, 1), buildLink(SECOND_ID, 2)];

      await service.replace(COURSE_ID, { lessonPlanIds: [SECOND_ID, FIRST_ID] }, ACTOR_ID);

      expect(manager.delete).toHaveBeenCalledTimes(1);
      expect(insertedLinks().map((link) => [link.position, link.lessonPlanId])).toEqual([
        [1, SECOND_ID],
        [2, FIRST_ID],
      ]);
      const [event] = emittedEvents();
      expect(event.before).toEqual({ lessonPlanIds: [FIRST_ID, SECOND_ID] });
      expect(event.after).toEqual({ lessonPlanIds: [SECOND_ID, FIRST_ID] });
    });

    it("reorders P1, P2, P3 to P3, P1: P2 leaves the sequence and the workload is 150", async () => {
      state.links = [buildLink(FIRST_ID, 1), buildLink(SECOND_ID, 2), buildLink(THIRD_ID, 3)];
      state.sequenceRows = [
        buildRow(THIRD_ID, 1, { expectedDurationMinutes: 60 }),
        buildRow(FIRST_ID, 2, { expectedDurationMinutes: 90 }),
      ];
      state.contents = [buildContent(FIRST_ID, 0, "Teclado e mouse")];

      const result = await service.replace(
        COURSE_ID,
        { lessonPlanIds: [THIRD_ID, FIRST_ID] },
        ACTOR_ID,
      );

      expect(result.plannedWorkloadMinutes).toBe(150);
      expect(result.items.map((item) => [item.position, item.lessonPlanId])).toEqual([
        [1, THIRD_ID],
        [2, FIRST_ID],
      ]);
      expect(result.items[1].contents).toEqual(["Teclado e mouse"]);
      const [event] = emittedEvents();
      expect(event.before).toEqual({ lessonPlanIds: [FIRST_ID, SECOND_ID, THIRD_ID] });
      expect(event.after).toEqual({ lessonPlanIds: [THIRD_ID, FIRST_ID] });
    });

    it("is a no-op without event when the list is the same in the same order", async () => {
      state.links = [buildLink(FIRST_ID, 1), buildLink(SECOND_ID, 2), buildLink(THIRD_ID, 3)];
      state.sequenceRows = [buildRow(FIRST_ID, 1), buildRow(SECOND_ID, 2), buildRow(THIRD_ID, 3)];

      const result = await service.replace(
        COURSE_ID,
        { lessonPlanIds: [FIRST_ID, SECOND_ID, THIRD_ID] },
        ACTOR_ID,
      );

      expect(result.items.map((item) => item.lessonPlanId)).toEqual([
        FIRST_ID,
        SECOND_ID,
        THIRD_ID,
      ]);
      expect(order).not.toContain("lock-plans");
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(state.course?.updatedAt).toEqual(CREATED_AT);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("is a no-op without event for [] over an empty sequence", async () => {
      const result = await service.replace(COURSE_ID, { lessonPlanIds: [] }, ACTOR_ID);

      expect(result).toEqual({ courseId: COURSE_ID, plannedWorkloadMinutes: 0, items: [] });
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not turn a no-op into a refusal for an archived plan that is already in the sequence", async () => {
      state.plans = [buildPlan(FIRST_ID, { archive: { archivedAt: CREATED_AT } })];
      state.links = [buildLink(FIRST_ID, 1)];
      state.sequenceRows = [buildRow(FIRST_ID, 1, { archivedAt: CREATED_AT })];

      const result = await service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID] }, ACTOR_ID);

      expect(result.items[0].archivedAt).toEqual(CREATED_AT);
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it("uses the id of the database, not the one of the path", async () => {
      // The UUID pipe of the route accepts upper case and Postgres finds the row all the same, but
      // the links of the database and the ids of the body are lower case: the service has to work
      // with the id of the course it loaded, not with the one it received.
      const upperId = COURSE_ID.toUpperCase();
      state.links = [buildLink(FIRST_ID, 1)];
      state.sequenceRows = [buildRow(SECOND_ID, 1), buildRow(FIRST_ID, 2)];

      const result = await service.replace(
        upperId,
        { lessonPlanIds: [SECOND_ID, FIRST_ID] },
        ACTOR_ID,
      );

      // The lookup is the one place that uses the id as it came.
      expect(manager.findOne).toHaveBeenCalledWith(Course, {
        where: { id: upperId },
        lock: { mode: "pessimistic_write" },
      });
      expect(manager.find).toHaveBeenCalledWith(CourseLessonPlan, {
        where: { courseId: COURSE_ID },
        order: { position: "ASC" },
      });
      expect(manager.delete).toHaveBeenCalledWith(CourseLessonPlan, { courseId: COURSE_ID });
      expect(insertedLinks().map((link) => link.courseId)).toEqual([COURSE_ID, COURSE_ID]);
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining("FROM course_lesson_plans link"),
        [COURSE_ID],
      );
      expect(result.courseId).toBe(COURSE_ID);
      const [event] = emittedEvents();
      expect(event.targetId).toBe(COURSE_ID);
    });

    it("compares the list with the current sequence using the id of the database", async () => {
      // Same list, same order: it is a no-op even when the path came in upper case.
      state.links = [buildLink(FIRST_ID, 1)];
      state.sequenceRows = [buildRow(FIRST_ID, 1)];

      await service.replace(COURSE_ID.toUpperCase(), { lessonPlanIds: [FIRST_ID] }, ACTOR_ID);

      expect(manager.delete).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("touches the course updatedAt with the clock when the sequence changes", async () => {
      await service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID, SECOND_ID] }, ACTOR_ID);

      const courses = savedCourses();
      expect(courses).toHaveLength(1);
      expect(courses[0].id).toBe(COURSE_ID);
      expect(courses[0].updatedAt).toEqual(NOW);
      expect(courses[0].createdAt).toEqual(CREATED_AT);
      expect(order.slice(-4)).toEqual(["save-course", "read-sequence", "commit", "emit"]);
    });

    it("reads the plans of the sequence and all their contents once, after the writes", async () => {
      state.sequenceRows = [buildRow(SECOND_ID, 1), buildRow(FIRST_ID, 2)];
      state.contents = [buildContent(SECOND_ID, 0, "Pastas"), buildContent(FIRST_ID, 0, "Teclado")];

      const result = await service.replace(
        COURSE_ID,
        { lessonPlanIds: [SECOND_ID, FIRST_ID] },
        ACTOR_ID,
      );

      const contentCalls = manager.find.mock.calls.filter((args) => args[0] === LessonPlanContent);
      expect(contentCalls).toHaveLength(1);
      expect(contentCalls[0][1]).toMatchObject({
        where: { lessonPlanId: { value: [SECOND_ID, FIRST_ID] } },
        order: { position: "ASC" },
      });
      expect(order.indexOf("insert-links")).toBeLessThan(order.indexOf("read-sequence"));
      expect(result.items.map((item) => item.contents)).toEqual([["Pastas"], ["Teclado"]]);
    });

    it("emits COURSE_LESSON_PLANS_REPLACED after the commit with before and after in order", async () => {
      state.links = [buildLink(FIRST_ID, 1), buildLink(SECOND_ID, 2), buildLink(THIRD_ID, 3)];

      await service.replace(COURSE_ID, { lessonPlanIds: [THIRD_ID, FIRST_ID] }, ACTOR_ID);

      expect(order.slice(-2)).toEqual(["commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(AUDITABLE_ACTION_EVENT, expect.anything());

      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.COURSE_LESSON_PLANS_REPLACED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("course");
      expect(event.targetId).toBe(COURSE_ID);
      // In order, not sorted: here the order is the data. The workload is derived, so it is not logged.
      expect(event.before).toEqual({ lessonPlanIds: [FIRST_ID, SECOND_ID, THIRD_ID] });
      expect(event.after).toEqual({ lessonPlanIds: [THIRD_ID, FIRST_ID] });
      expect(event.occurredAt).toEqual(NOW);
    });

    it("emits an empty list as the before of a course that had no sequence", async () => {
      await service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID] }, ACTOR_ID);

      const [event] = emittedEvents();
      expect(event.before).toEqual({ lessonPlanIds: [] });
      expect(event.after).toEqual({ lessonPlanIds: [FIRST_ID] });
    });

    it("does not emit when the transaction fails", async () => {
      dataSource.transaction.mockRejectedValueOnce(new Error("connection lost"));

      await expect(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID] }, ACTOR_ID),
      ).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not emit when the insert of the links fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID, SECOND_ID] }, ACTOR_ID),
      ).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not emit when the save of the course fails", async () => {
      manager.save
        .mockImplementationOnce(async (entity: unknown) => entity)
        .mockRejectedValueOnce(new Error("connection lost"));

      await expect(
        service.replace(COURSE_ID, { lessonPlanIds: [FIRST_ID] }, ACTOR_ID),
      ).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("keeps any database error as it came", async () => {
      const boom = new Error("deadlock detected");
      manager.delete.mockRejectedValueOnce(boom);
      state.links = [buildLink(FIRST_ID, 1)];

      await expect(
        service.replace(COURSE_ID, { lessonPlanIds: [SECOND_ID] }, ACTOR_ID),
      ).rejects.toBe(boom);
    });
  });

  describe("list()", () => {
    it("returns 404 COURSE_NOT_FOUND for an unknown id", async () => {
      state.course = null;

      const failure = await httpFailure(service.list(UNKNOWN_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "COURSE_NOT_FOUND",
        message: "Course not found.",
      });
      expect(manager.query).not.toHaveBeenCalled();
    });

    it("answers the sequence in order with the workload of P1 (90), P2 (120) and P3 (60)", async () => {
      state.sequenceRows = [
        buildRow(FIRST_ID, 1, { expectedDurationMinutes: 90, courseCount: 2 }),
        buildRow(SECOND_ID, 2, { expectedDurationMinutes: 120 }),
        buildRow(THIRD_ID, 3, { expectedDurationMinutes: 60 }),
      ];
      state.contents = [
        buildContent(SECOND_ID, 0, "Pastas"),
        buildContent(FIRST_ID, 1, "Janelas"),
        buildContent(FIRST_ID, 0, "Teclado"),
      ];

      const result = await service.list(COURSE_ID);

      expect(result.courseId).toBe(COURSE_ID);
      expect(result.plannedWorkloadMinutes).toBe(270);
      expect(
        result.items.map((item) => [item.position, item.lessonPlanId, item.courseCount]),
      ).toEqual([
        [1, FIRST_ID, 2],
        [2, SECOND_ID, 1],
        [3, THIRD_ID, 1],
      ]);
      expect(result.items.map((item) => item.contents)).toEqual([
        ["Teclado", "Janelas"],
        ["Pastas"],
        [],
      ]);
    });

    it("answers an empty sequence with workload 0 and does not look for contents", async () => {
      const result = await service.list(COURSE_ID);

      expect(result).toEqual({ courseId: COURSE_ID, plannedWorkloadMinutes: 0, items: [] });
      expect(order).toEqual(["read-sequence"]);
    });

    it("returns the sequence of an archived course", async () => {
      state.course = buildCourse({ archive: { archivedAt: CREATED_AT, archivedById: ACTOR_ID } });
      state.sequenceRows = [buildRow(FIRST_ID, 1)];

      const result = await service.list(COURSE_ID);

      expect(result.items).toHaveLength(1);
      expect(result.plannedWorkloadMinutes).toBe(90);
    });

    it("takes no transaction, no lock and emits no event", async () => {
      state.sequenceRows = [buildRow(FIRST_ID, 1)];

      await service.list(COURSE_ID);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("reads the sequence with the id of the database", async () => {
      const upperId = COURSE_ID.toUpperCase();
      state.sequenceRows = [buildRow(FIRST_ID, 1)];

      const result = await service.list(upperId);

      expect(courseRepository.findOne).toHaveBeenCalledWith({ where: { id: upperId } });
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining("FROM course_lesson_plans link"),
        [COURSE_ID],
      );
      expect(result.courseId).toBe(COURSE_ID);
    });

    it("reads the sequence ordered by position, counts the courses as int and skips deleted rows", async () => {
      await service.list(COURSE_ID);

      const sql = manager.query.mock.calls[0][0] as string;
      expect(sql).toContain("ORDER BY link.position");
      // COUNT is a bigint, which the driver would hand over as a string.
      expect(sql).toContain("COUNT(*)::int");
      expect(sql).toContain("link.deleted_at IS NULL");
      expect(sql).toContain("plan.deleted_at IS NULL");
      expect(sql).toContain("usage.deleted_at IS NULL");
      expect(sql).toContain("c.deleted_at IS NULL");
    });
  });
});
