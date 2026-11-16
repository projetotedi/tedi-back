import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, IsNull, Not } from "typeorm";
import {
  CourseLessonPlansService,
  SequencedLessonPlanSummary,
} from "@modules/catalog/services/course-lesson-plans.service";
import { CoursesService, CourseSummary } from "@modules/catalog/services/courses.service";
import { ClassesService, ClassSummary } from "@modules/classes/services/classes.service";
import { Clock } from "@shared/dates/clock";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { GenerateClassLessonsDto } from "../dto/generate-class-lessons.dto";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";
import { Weekday } from "../enums/weekday.enum";
import { LessonCreationService } from "../services/lesson-creation.service";
import { LessonGenerationService } from "../services/lesson-generation.service";

const NOW = new Date("2026-04-01T12:00:00.000Z");
const CREATED_AT = new Date("2026-03-01T12:00:00.000Z");
const ARCHIVED_AT = new Date("2026-03-20T12:00:00.000Z");

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const EDITION_ID = "01999a3e-7c1b-7000-8000-0000000000e1";
const PLAN_IDS = [
  "01999a3e-7c1b-7000-8000-000000000011",
  "01999a3e-7c1b-7000-8000-000000000012",
  "01999a3e-7c1b-7000-8000-000000000013",
  "01999a3e-7c1b-7000-8000-000000000014",
];
const TITLES = [
  "Conhecendo o computador",
  "Teclado, mouse e janelas",
  "Navegando na internet",
  "Senhas e privacidade",
];

/** The body of the modal of the Figma: toda terça, das 9h às 11h, a partir de 07/04. */
const BODY: GenerateClassLessonsDto = {
  weekday: Weekday.TUESDAY,
  startTime: "09:00",
  endTime: "11:00",
  firstDate: "2026-04-07",
  location: "Laboratório 2 — Bloco B",
};

function buildClass(overrides: Partial<ClassSummary> = {}): ClassSummary {
  return {
    id: CLASS_ID,
    code: "INFO-A",
    name: "Informática Básica, turma A",
    courseId: COURSE_ID,
    edition: { id: EDITION_ID, name: "2026.1" },
    startDate: "2026-03-03",
    endDate: "2026-06-27",
    // The enum belongs to the classes module: the test takes the type from the contract.
    status: "in_progress" as ClassSummary["status"],
    archivedAt: null,
    ...overrides,
  };
}

function buildCourse(overrides: Record<string, unknown> = {}): CourseSummary {
  return {
    id: COURSE_ID,
    name: "Informática Básica",
    category: "basic",
    status: "active",
    ...overrides,
  } as unknown as CourseSummary;
}

/** The four plans of the course of the card, in the order of the sequence, positions 1 to 4. */
function buildSequence(
  overrides: Record<number, Partial<SequencedLessonPlanSummary>> = {},
): SequencedLessonPlanSummary[] {
  return TITLES.map((title, index) => ({
    id: PLAN_IDS[index],
    title,
    objective: `Objetivo de "${title}".`,
    expectedDurationMinutes: 90,
    archivedAt: null,
    position: index + 1,
    ...overrides[index + 1],
  }));
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

function codeOf(failure: HttpException): string {
  return (failure.getResponse() as { error: string }).error;
}

describe("LessonGenerationService", () => {
  let service: LessonGenerationService;
  let creation: LessonCreationService;
  let createMany: jest.SpyInstance;
  let order: string[];
  let state: {
    schoolClass: ClassSummary | null;
    course: CourseSummary | null;
    sequence: SequencedLessonPlanSummary[];
    alreadyGenerated: boolean;
  };

  /** The manager of the transaction: the one that writes and locks. */
  const manager = { create: jest.fn(), save: jest.fn(), query: jest.fn(), exists: jest.fn() };
  /** The manager of the data source: the plain reads of the preview. */
  const plainManager = { exists: jest.fn() };
  const dataSource = { transaction: jest.fn(), manager: plainManager };
  const eventEmitter = { emit: jest.fn() };
  const classes = { getClassSummary: jest.fn() };
  const courses = { getCourseSummary: jest.fn() };
  const courseLessonPlans = { getSequenceSummaries: jest.fn() };

  function auditEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls
      .filter((call) => call[0] === AUDITABLE_ACTION_EVENT)
      .map((call) => call[1] as AuditableActionEvent);
  }

  /** What `manager.create` was asked to build, in the order of the lessons. */
  function createdRows(): Array<Record<string, unknown>> {
    return manager.create.mock.calls.map((call) => call[1] as Record<string, unknown>);
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];
    state = {
      schoolClass: buildClass(),
      course: buildCourse(),
      sequence: buildSequence(),
      alreadyGenerated: false,
    };

    let sequence = 0;
    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), {
        id: `lesson-${++sequence}`,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        deletedAt: null,
        ...data,
      }),
    );
    manager.save.mockImplementation(async (entities: unknown) => {
      order.push("insert");
      return entities;
    });
    manager.query.mockImplementation(async () => {
      order.push("advisory-lock");
      return [];
    });
    manager.exists.mockImplementation(async () => {
      order.push("exists");
      return state.alreadyGenerated;
    });
    plainManager.exists.mockImplementation(async () => {
      order.push("exists");
      return state.alreadyGenerated;
    });
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => Promise<unknown>) => {
        const result = await callback(manager);
        order.push("commit");
        return result;
      },
    );
    eventEmitter.emit.mockImplementation(() => {
      order.push("emit");
      return true;
    });
    classes.getClassSummary.mockImplementation(
      async (_id: string, _manager: unknown, options: { forShare?: boolean }) => {
        order.push(`get-class:${String(options.forShare)}`);
        return state.schoolClass;
      },
    );
    courses.getCourseSummary.mockImplementation(
      async (_id: string, _manager: unknown, options: { forShare?: boolean }) => {
        order.push(`get-course:${String(options.forShare)}`);
        return state.course;
      },
    );
    courseLessonPlans.getSequenceSummaries.mockImplementation(
      async (_id: string, _manager: unknown, options: { forShare?: boolean }) => {
        order.push(`get-sequence:${String(options.forShare)}`);
        return state.sequence;
      },
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        LessonGenerationService,
        // The real one: the rules of a lesson at birth are exercised here, with the mocked manager.
        LessonCreationService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: { now: () => NOW } },
        { provide: ClassesService, useValue: classes },
        { provide: CoursesService, useValue: courses },
        { provide: CourseLessonPlansService, useValue: courseLessonPlans },
      ],
    }).compile();

    service = moduleRef.get(LessonGenerationService);
    creation = moduleRef.get(LessonCreationService);
    createMany = jest.spyOn(creation, "createMany");
  });

  describe("generate()", () => {
    it("builds one draft per active plan with title, objective, lessonPlanId and sequenceOrder = position", async () => {
      await service.generate(CLASS_ID, BODY, ACTOR_ID);

      expect(createMany).toHaveBeenCalledTimes(1);
      expect(createMany).toHaveBeenCalledWith(
        manager,
        state.schoolClass,
        TITLES.map((title, index) => ({
          lessonPlanId: PLAN_IDS[index],
          sequenceOrder: index + 1,
          title,
          objective: `Objetivo de "${title}".`,
          date: ["2026-04-07", "2026-04-14", "2026-04-21", "2026-04-28"][index],
          startTime: "09:00",
          endTime: "11:00",
          location: "Laboratório 2 — Bloco B",
          expectedStudents: null,
          expectedMonitors: null,
          subject: null,
        })),
        ACTOR_ID,
      );
      // What is written: planned lessons of the class, made by the actor.
      expect(createdRows()).toHaveLength(4);
      for (const row of createdRows()) {
        expect(row).toMatchObject({
          classId: CLASS_ID,
          status: LessonStatus.PLANNED,
          createdById: ACTOR_ID,
        });
      }
      // All of them in one save: one statement for the whole batch.
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect((manager.save.mock.calls[0][0] as unknown[]).length).toBe(4);
    });

    it("copies the objective of the plan, null included, and keeps the real position of each plan", async () => {
      state.sequence = buildSequence({ 2: { objective: null } });

      await service.generate(CLASS_ID, BODY, ACTOR_ID);

      expect(createdRows().map((row) => [row.sequenceOrder, row.objective])).toEqual([
        [1, `Objetivo de "Conhecendo o computador".`],
        [2, null],
        [3, `Objetivo de "Navegando na internet".`],
        [4, `Objetivo de "Senhas e privacidade".`],
      ]);
    });

    it("applies location to every draft and null when omitted", async () => {
      await service.generate(CLASS_ID, BODY, ACTOR_ID);
      expect(createdRows().map((row) => row.location)).toEqual(Array(4).fill(BODY.location));

      manager.create.mockClear();
      const { location: _location, ...withoutLocation } = BODY;
      await service.generate(CLASS_ID, withoutLocation, ACTOR_ID);
      expect(createdRows().map((row) => row.location)).toEqual(Array(4).fill(null));

      manager.create.mockClear();
      await service.generate(CLASS_ID, { ...BODY, location: null }, ACTOR_ID);
      expect(createdRows().map((row) => row.location)).toEqual(Array(4).fill(null));
    });

    it("gives every lesson the time of the body and leaves the head counts and the subject empty", async () => {
      await service.generate(CLASS_ID, BODY, ACTOR_ID);

      for (const row of createdRows()) {
        expect(row).toMatchObject({
          startTime: "09:00",
          endTime: "11:00",
          expectedStudents: null,
          expectedMonitors: null,
          subject: null,
        });
      }
    });

    it("answers the lessons created, in the order of the sequence, built from what was already read", async () => {
      const result = await service.generate(CLASS_ID, BODY, ACTOR_ID);

      expect(result.classId).toBe(CLASS_ID);
      expect(result.lessons).toHaveLength(4);
      expect(
        result.lessons.map((lesson) => [lesson.sequenceOrder, lesson.title, lesson.date]),
      ).toEqual([
        [1, "Conhecendo o computador", "2026-04-07"],
        [2, "Teclado, mouse e janelas", "2026-04-14"],
        [3, "Navegando na internet", "2026-04-21"],
        [4, "Senhas e privacidade", "2026-04-28"],
      ]);
      expect(result.lessons[0]).toEqual({
        id: "lesson-1",
        class: {
          id: CLASS_ID,
          code: "INFO-A",
          name: "Informática Básica, turma A",
          startDate: "2026-03-03",
          endDate: "2026-06-27",
          archivedAt: null,
        },
        course: { id: COURSE_ID, name: "Informática Básica" },
        edition: { id: EDITION_ID, name: "2026.1" },
        lessonPlan: { id: PLAN_IDS[0], title: "Conhecendo o computador", archivedAt: null },
        sequenceOrder: 1,
        title: "Conhecendo o computador",
        objective: `Objetivo de "Conhecendo o computador".`,
        date: "2026-04-07",
        startTime: "09:00",
        endTime: "11:00",
        durationMinutes: 120,
        location: "Laboratório 2 — Bloco B",
        expectedStudents: null,
        expectedMonitors: null,
        subject: null,
        postNotes: null,
        status: LessonStatus.PLANNED,
        cancelReason: null,
        cancelledAt: null,
        cancelledById: null,
        originalDate: null,
        rescheduleReason: null,
        rescheduleNote: null,
        createdById: ACTOR_ID,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      });
      // The class, the course and the sequence are read once: the answer needs no other read.
      expect(classes.getClassSummary).toHaveBeenCalledTimes(1);
      expect(courses.getCourseSummary).toHaveBeenCalledTimes(1);
      expect(courseLessonPlans.getSequenceSummaries).toHaveBeenCalledTimes(1);
    });

    it("reads and locks in the documented order, inside the transaction, and emits after the commit", async () => {
      await service.generate(CLASS_ID, BODY, ACTOR_ID);

      expect(order).toEqual([
        "get-class:true",
        "advisory-lock",
        "exists",
        "get-course:true",
        "get-sequence:true",
        "insert",
        "commit",
        "emit",
        "emit",
        "emit",
        "emit",
      ]);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(classes.getClassSummary).toHaveBeenCalledWith(CLASS_ID, manager, { forShare: true });
      expect(courses.getCourseSummary).toHaveBeenCalledWith(COURSE_ID, manager, {
        forShare: true,
      });
      expect(courseLessonPlans.getSequenceSummaries).toHaveBeenCalledWith(COURSE_ID, manager, {
        forShare: true,
      });
      // The check of "already generated" is made inside the transaction, never on the data source.
      expect(manager.exists).toHaveBeenCalledTimes(1);
      expect(plainManager.exists).not.toHaveBeenCalled();
    });

    it("takes the advisory lock with the database id only on generate", async () => {
      // The UUID pipe accepts upper case, and the database hands the id back in lower case.
      const requestedId = CLASS_ID.toUpperCase();

      await service.generate(requestedId, BODY, ACTOR_ID);

      expect(manager.query).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `lessons.generate:${CLASS_ID}`,
      ]);
      expect(classes.getClassSummary).toHaveBeenCalledWith(requestedId, manager, {
        forShare: true,
      });
      // Everything after the lookup uses the id of the database: the lock, the check and the lessons.
      expect(manager.exists).toHaveBeenCalledWith(Lesson, {
        where: { classId: CLASS_ID, sequenceOrder: Not(IsNull()) },
      });
      expect(createdRows().every((row) => row.classId === CLASS_ID)).toBe(true);
      expect(auditEvents().every((event) => event.after?.classId === CLASS_ID)).toBe(true);

      manager.query.mockClear();
      await service.preview(requestedId, BODY);

      expect(manager.query).not.toHaveBeenCalled();
    });

    it("throws LESSONS_OUTSIDE_CLASS_PERIOD before createMany", async () => {
      state.schoolClass = buildClass({ endDate: "2026-04-24" });

      const failure = await httpFailure(service.generate(CLASS_ID, BODY, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "LESSONS_OUTSIDE_CLASS_PERIOD",
        message: "Some lessons would fall outside the period of the class.",
        details: [
          { field: "firstDate", message: "lessons 4 fall outside the period of the class" },
        ],
      });
      expect(createMany).not.toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(order).not.toContain("commit");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("names every position that falls outside, and refuses a series that starts before the class", async () => {
      // The class starts on 2026-04-14: the first lesson, on 2026-04-07, is before it.
      state.schoolClass = buildClass({ startDate: "2026-04-14", endDate: "2026-04-21" });

      const failure = await httpFailure(service.generate(CLASS_ID, BODY, ACTOR_ID));

      expect(codeOf(failure)).toBe("LESSONS_OUTSIDE_CLASS_PERIOD");
      expect(failure.getResponse()).toMatchObject({
        details: [
          { field: "firstDate", message: "lessons 1, 4 fall outside the period of the class" },
        ],
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("accepts a series whose first and last lesson are the first and the last day of the class", async () => {
      state.schoolClass = buildClass({ startDate: "2026-04-07", endDate: "2026-04-28" });

      const result = await service.generate(CLASS_ID, BODY, ACTOR_ID);

      expect(result.lessons.map((lesson) => lesson.date)).toEqual([
        "2026-04-07",
        "2026-04-14",
        "2026-04-21",
        "2026-04-28",
      ]);
    });

    it("moves firstDate to the next weekday: a monday with weekday tuesday starts on the tuesday", async () => {
      await service.generate(CLASS_ID, { ...BODY, firstDate: "2026-04-06" }, ACTOR_ID);

      expect(createdRows().map((row) => row.date)).toEqual([
        "2026-04-07",
        "2026-04-14",
        "2026-04-21",
        "2026-04-28",
      ]);
    });

    it("emits one LESSON_CREATED per lesson after the commit, none on failure", async () => {
      await service.generate(CLASS_ID, BODY, ACTOR_ID);

      const events = auditEvents();
      expect(events).toHaveLength(4);
      expect(events.map((event) => event.targetId)).toEqual([
        "lesson-1",
        "lesson-2",
        "lesson-3",
        "lesson-4",
      ]);
      for (const [index, event] of events.entries()) {
        expect(event).toBeInstanceOf(AuditableActionEvent);
        expect(event.action).toBe(AuditableAction.LESSON_CREATED);
        expect(event.actorId).toBe(ACTOR_ID);
        expect(event.targetType).toBe("lesson");
        expect(event.before).toBeNull();
        expect(event.occurredAt).toBe(NOW);
        expect(event.after).toEqual({
          classId: CLASS_ID,
          lessonPlanId: PLAN_IDS[index],
          sequenceOrder: index + 1,
          title: TITLES[index],
          objective: `Objetivo de "${TITLES[index]}".`,
          date: ["2026-04-07", "2026-04-14", "2026-04-21", "2026-04-28"][index],
          startTime: "09:00",
          endTime: "11:00",
          location: "Laboratório 2 — Bloco B",
          expectedStudents: null,
          expectedMonitors: null,
          subject: null,
          status: LessonStatus.PLANNED,
        });
      }
      // Every event goes out after the commit, never before it.
      expect(order.indexOf("commit")).toBeLessThan(order.indexOf("emit"));

      jest.clearAllMocks();
      order = [];
      createMany.mockRejectedValueOnce(new Error("insert failed midway"));

      await expect(service.generate(CLASS_ID, BODY, ACTOR_ID)).rejects.toThrow(
        "insert failed midway",
      );

      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(order).not.toContain("commit");
    });

    it("keeps the failure of the creation as it came, so the transaction rolls back", async () => {
      const failure = new Error("connection lost");
      createMany.mockRejectedValueOnce(failure);

      await expect(service.generate(CLASS_ID, BODY, ACTOR_ID)).rejects.toBe(failure);
    });

    it("does not block on an archived course", async () => {
      state.course = buildCourse({ status: "archived" });

      const result = await service.generate(CLASS_ID, BODY, ACTOR_ID);

      expect(result.lessons).toHaveLength(4);
    });

    it("does not block on a class that is completed or cancelled: only the archive blocks", async () => {
      for (const status of ["completed", "cancelled"]) {
        state.schoolClass = buildClass({ status: status as ClassSummary["status"] });

        await expect(service.generate(CLASS_ID, BODY, ACTOR_ID)).resolves.toMatchObject({
          classId: CLASS_ID,
        });
      }
    });

    it("throws an error, not a 404, when the course of the class is gone: the foreign key requires it", async () => {
      state.course = null;

      await expect(service.generate(CLASS_ID, BODY, ACTOR_ID)).rejects.not.toBeInstanceOf(
        HttpException,
      );
    });
  });

  describe("preview()", () => {
    it("answers the series with the day, the title, the duration of the plan and the period of the class", async () => {
      const result = await service.preview(CLASS_ID, BODY);

      expect(result).toEqual({
        classId: CLASS_ID,
        classStartDate: "2026-03-03",
        classEndDate: "2026-06-27",
        weekday: "tuesday",
        startTime: "09:00",
        endTime: "11:00",
        durationMinutes: 120,
        location: "Laboratório 2 — Bloco B",
        lessonCount: 4,
        outsideClassPeriodCount: 0,
        items: [
          {
            sequenceOrder: 1,
            lessonPlanId: PLAN_IDS[0],
            title: "Conhecendo o computador",
            date: "2026-04-07",
            expectedDurationMinutes: 90,
            outsideClassPeriod: false,
          },
          {
            sequenceOrder: 2,
            lessonPlanId: PLAN_IDS[1],
            title: "Teclado, mouse e janelas",
            date: "2026-04-14",
            expectedDurationMinutes: 90,
            outsideClassPeriod: false,
          },
          {
            sequenceOrder: 3,
            lessonPlanId: PLAN_IDS[2],
            title: "Navegando na internet",
            date: "2026-04-21",
            expectedDurationMinutes: 90,
            outsideClassPeriod: false,
          },
          {
            sequenceOrder: 4,
            lessonPlanId: PLAN_IDS[3],
            title: "Senhas e privacidade",
            date: "2026-04-28",
            expectedDurationMinutes: 90,
            outsideClassPeriod: false,
          },
        ],
        skippedLessonPlans: [],
      });
    });

    it("preview never calls createMany nor emits events", async () => {
      await service.preview(CLASS_ID, BODY);

      expect(createMany).not.toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("takes no transaction and no lock: plain reads of the class, the course and the sequence", async () => {
      await service.preview(CLASS_ID, BODY);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.query).not.toHaveBeenCalled();
      expect(classes.getClassSummary).toHaveBeenCalledWith(CLASS_ID, undefined, {
        forShare: false,
      });
      expect(courses.getCourseSummary).toHaveBeenCalledWith(COURSE_ID, undefined, {
        forShare: false,
      });
      expect(courseLessonPlans.getSequenceSummaries).toHaveBeenCalledWith(COURSE_ID, undefined, {
        forShare: false,
      });
      // "Already generated" is read from the data source, outside any transaction.
      expect(plainManager.exists).toHaveBeenCalledWith(Lesson, {
        where: { classId: CLASS_ID, sequenceOrder: Not(IsNull()) },
      });
      expect(manager.exists).not.toHaveBeenCalled();
      expect(order).toEqual([
        "get-class:false",
        "exists",
        "get-course:false",
        "get-sequence:false",
      ]);
    });

    it("preview marks outside items and still answers", async () => {
      state.schoolClass = buildClass({ endDate: "2026-04-24" });

      const result = await service.preview(CLASS_ID, BODY);

      expect(result.classEndDate).toBe("2026-04-24");
      expect(result.lessonCount).toBe(4);
      expect(result.outsideClassPeriodCount).toBe(1);
      expect(result.items.map((item) => [item.date, item.outsideClassPeriod])).toEqual([
        ["2026-04-07", false],
        ["2026-04-14", false],
        ["2026-04-21", false],
        ["2026-04-28", true],
      ]);
      expect(createMany).not.toHaveBeenCalled();
    });

    it("marks the first lesson outside when firstDate is before the start of the class", async () => {
      state.schoolClass = buildClass({ startDate: "2026-04-10" });

      const result = await service.preview(CLASS_ID, BODY);

      // The class starts on 2026-04-10 (a friday): 2026-04-07 is before it, 2026-04-14 is inside.
      expect(result.items.map((item) => [item.date, item.outsideClassPeriod])).toEqual([
        ["2026-04-07", true],
        ["2026-04-14", false],
        ["2026-04-21", false],
        ["2026-04-28", false],
      ]);
      expect(result.outsideClassPeriodCount).toBe(1);
    });

    it("answers location null when omitted or null, and the duration from the two times", async () => {
      const { location: _location, ...withoutLocation } = BODY;

      const omitted = await service.preview(CLASS_ID, {
        ...withoutLocation,
        startTime: "14:00",
        endTime: "15:30",
      });
      const cleared = await service.preview(CLASS_ID, { ...BODY, location: null });

      expect(omitted.location).toBeNull();
      expect(omitted.durationMinutes).toBe(90);
      expect(cleared.location).toBeNull();
    });
  });

  describe("the errors of both routes", () => {
    const routes = [
      ["preview", (body: GenerateClassLessonsDto) => service.preview(CLASS_ID, body)],
      ["generate", (body: GenerateClassLessonsDto) => service.generate(CLASS_ID, body, ACTOR_ID)],
    ] as const;

    it.each(routes)(
      "%s throws CLASS_NOT_FOUND (404) for a class that does not exist",
      async (_name, run) => {
        state.schoolClass = null;

        const failure = await httpFailure(run(BODY));

        expect(failure.getStatus()).toBe(404);
        expect(failure.getResponse()).toEqual({
          error: "CLASS_NOT_FOUND",
          message: "Class not found.",
        });
        expect(courses.getCourseSummary).not.toHaveBeenCalled();
        expect(createMany).not.toHaveBeenCalled();
      },
    );

    it.each(routes)("%s throws CLASS_ARCHIVED (409) for an archived class", async (_name, run) => {
      state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });

      const failure = await httpFailure(run(BODY));

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("CLASS_ARCHIVED");
      // It is answered before the lock, the check and the course.
      expect(manager.query).not.toHaveBeenCalled();
      expect(manager.exists).not.toHaveBeenCalled();
      expect(plainManager.exists).not.toHaveBeenCalled();
      expect(courses.getCourseSummary).not.toHaveBeenCalled();
    });

    it.each(routes)(
      "%s throws LESSONS_ALREADY_GENERATED when the class has a lesson with sequenceOrder",
      async (_name, run) => {
        state.alreadyGenerated = true;

        const failure = await httpFailure(run(BODY));

        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("LESSONS_ALREADY_GENERATED");
        // It is answered before the course and the sequence are read, and nothing is written.
        expect(courses.getCourseSummary).not.toHaveBeenCalled();
        expect(courseLessonPlans.getSequenceSummaries).not.toHaveBeenCalled();
        expect(createMany).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      },
    );

    it.each(routes)(
      "%s asks for the lessons of the sequence only: a lesson with a sequenceOrder, cancelled or not",
      async (_name, run) => {
        await run(BODY);

        const exists = [...manager.exists.mock.calls, ...plainManager.exists.mock.calls];
        expect(exists).toHaveLength(1);
        expect(exists[0]).toEqual([
          Lesson,
          { where: { classId: CLASS_ID, sequenceOrder: Not(IsNull()) } },
        ]);
        // No filter on the status: a cancelled lesson of the sequence still counts.
        expect(JSON.stringify(exists[0][1])).not.toContain("status");
      },
    );

    it.each(routes)(
      "%s throws COURSE_WITHOUT_SEQUENCE for an empty sequence and when every plan is archived",
      async (_name, run) => {
        state.sequence = [];
        const empty = await httpFailure(run(BODY));

        state.sequence = buildSequence({
          1: { archivedAt: ARCHIVED_AT },
          2: { archivedAt: ARCHIVED_AT },
          3: { archivedAt: ARCHIVED_AT },
          4: { archivedAt: ARCHIVED_AT },
        });
        const archived = await httpFailure(run(BODY));

        for (const failure of [empty, archived]) {
          expect(failure.getStatus()).toBe(409);
          expect(failure.getResponse()).toEqual({
            error: "COURSE_WITHOUT_SEQUENCE",
            message: "The course of this class has no active lesson plan in its sequence.",
          });
        }
        expect(createMany).not.toHaveBeenCalled();
      },
    );

    it.each(routes)(
      "%s throws INVALID_TIME_RANGE before opening the transaction",
      async (_name, run) => {
        for (const times of [
          { startTime: "11:00", endTime: "09:00" },
          { startTime: "09:00", endTime: "09:00" },
        ]) {
          const failure = await httpFailure(run({ ...BODY, ...times }));

          expect(failure.getStatus()).toBe(400);
          expect(failure.getResponse()).toEqual({
            error: "INVALID_TIME_RANGE",
            message: "endTime must be after startTime.",
            details: [{ field: "endTime", message: "endTime must be after startTime" }],
          });
        }

        // Not even the class was looked at.
        expect(dataSource.transaction).not.toHaveBeenCalled();
        expect(classes.getClassSummary).not.toHaveBeenCalled();
      },
    );

    it("answers the errors in the same order on both routes: class, archive, already generated, sequence", async () => {
      for (const [, run] of routes) {
        order = [];
        state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });
        state.alreadyGenerated = true;
        state.sequence = [];
        expect(codeOf(await httpFailure(run(BODY)))).toBe("CLASS_ARCHIVED");

        state.schoolClass = buildClass();
        expect(codeOf(await httpFailure(run(BODY)))).toBe("LESSONS_ALREADY_GENERATED");

        state.alreadyGenerated = false;
        expect(codeOf(await httpFailure(run(BODY)))).toBe("COURSE_WITHOUT_SEQUENCE");
      }
    });
  });

  describe("an archived plan in the sequence", () => {
    it("skips archived plans, keeps their position out and lists them in skippedLessonPlans", async () => {
      state.sequence = buildSequence({ 2: { archivedAt: ARCHIVED_AT } });

      const result = await service.preview(CLASS_ID, BODY);

      expect(result.lessonCount).toBe(3);
      expect(result.items.map((item) => [item.sequenceOrder, item.title, item.date])).toEqual([
        [1, "Conhecendo o computador", "2026-04-07"],
        [3, "Navegando na internet", "2026-04-14"],
        [4, "Senhas e privacidade", "2026-04-21"],
      ]);
      expect(result.skippedLessonPlans).toEqual([
        {
          sequenceOrder: 2,
          lessonPlanId: PLAN_IDS[1],
          title: "Teclado, mouse e janelas",
          archivedAt: ARCHIVED_AT,
        },
      ]);
    });

    it("generates no lesson for an archived plan, and the others keep their real position (a gap)", async () => {
      state.sequence = buildSequence({ 2: { archivedAt: ARCHIVED_AT } });

      const result = await service.generate(CLASS_ID, BODY, ACTOR_ID);

      expect(createdRows().map((row) => [row.sequenceOrder, row.lessonPlanId, row.date])).toEqual([
        [1, PLAN_IDS[0], "2026-04-07"],
        [3, PLAN_IDS[2], "2026-04-14"],
        [4, PLAN_IDS[3], "2026-04-21"],
      ]);
      expect(result.lessons.map((lesson) => lesson.sequenceOrder)).toEqual([1, 3, 4]);
      expect(auditEvents()).toHaveLength(3);
    });

    it("generates from the active plans alone when several are archived, including the first", async () => {
      state.sequence = buildSequence({
        1: { archivedAt: ARCHIVED_AT },
        4: { archivedAt: ARCHIVED_AT },
      });

      const result = await service.preview(CLASS_ID, BODY);

      expect(result.items.map((item) => [item.sequenceOrder, item.date])).toEqual([
        [2, "2026-04-07"],
        [3, "2026-04-14"],
      ]);
      expect(result.skippedLessonPlans.map((plan) => plan.sequenceOrder)).toEqual([1, 4]);
    });
  });
});
