import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, QueryFailedError } from "typeorm";
import { CourseLessonPlansService } from "@modules/catalog/services/course-lesson-plans.service";
import { CoursesService, CourseSummary } from "@modules/catalog/services/courses.service";
import {
  LessonPlansService,
  LessonPlanSummary,
} from "@modules/catalog/services/lesson-plans.service";
import { ClassesService, ClassSummary } from "@modules/classes/services/classes.service";
import { Clock } from "@shared/dates/clock";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import {
  LESSON_CANCELLED_EVENT,
  LessonCancelledEvent,
} from "@shared/events/lesson-cancelled.event";
import { CreateLessonDto } from "../dto/create-lesson.dto";
import { UpdateLessonDto } from "../dto/update-lesson.dto";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";
import { LessonCreationService } from "../services/lesson-creation.service";
import { LessonsService } from "../services/lessons.service";

const NOW = new Date("2026-03-09T12:00:00.000Z");
const LATER = new Date("2026-03-09T12:00:05.000Z");
const CREATED_AT = new Date("2026-03-01T12:00:00.000Z");
const ARCHIVED_AT = new Date("2026-04-01T00:00:00.000Z");

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const OTHER_ID = "01999a3e-0000-7000-8000-0000000000bb";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const EDITION_ID = "01999a3e-7c1b-7000-8000-0000000000e1";
const PLAN_ID = "01999a3e-7c1b-7000-8000-000000000011";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";

type LessonOverrides = Partial<Lesson>;

function buildLesson(overrides: LessonOverrides = {}): Lesson {
  return Object.assign(new Lesson(), {
    id: LESSON_ID,
    classId: CLASS_ID,
    lessonPlanId: null,
    sequenceOrder: null,
    title: "Teclado, mouse e janelas",
    objective: null,
    date: "2026-03-10",
    startTime: "14:00",
    endTime: "15:30",
    location: null,
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
    deletedAt: null,
    ...overrides,
  });
}

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

function buildCourse(): CourseSummary {
  return {
    id: COURSE_ID,
    name: "Informática Básica",
    category: "basic",
    status: "active",
  } as unknown as CourseSummary;
}

function buildPlan(overrides: Partial<LessonPlanSummary> = {}): LessonPlanSummary {
  return {
    id: PLAN_ID,
    title: "Plano: teclado, mouse e janelas",
    objective: "Familiarizar o aluno com o teclado.",
    expectedDurationMinutes: 90,
    archivedAt: null,
    ...overrides,
  };
}

function violation(code: string, constraint: string): QueryFailedError {
  const driverError = Object.assign(new Error(`violates constraint ${constraint}`), {
    code,
    constraint,
  });
  return new QueryFailedError("INSERT INTO lessons", [], driverError);
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

describe("LessonsService", () => {
  let service: LessonsService;
  let order: string[];
  let state: {
    lesson: Lesson | null;
    schoolClass: ClassSummary | null;
    course: CourseSummary | null;
    plan: LessonPlanSummary | null;
    position: number | null;
  };

  const manager = { create: jest.fn(), save: jest.fn(), findOne: jest.fn() };
  const lessonRepository = { findOne: jest.fn() };
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  // Fixed at NOW. A test that needs to tell two reads of the clock apart makes the next ones LATER.
  const clock = { now: jest.fn() };
  const classes = { getClassSummary: jest.fn() };
  const courses = { getCourseSummary: jest.fn() };
  const lessonPlans = { getLessonPlanSummary: jest.fn() };
  const courseLessonPlans = { findPosition: jest.fn() };

  function auditEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls
      .filter((call) => call[0] === AUDITABLE_ACTION_EVENT)
      .map((call) => call[1] as AuditableActionEvent);
  }

  function cancelledEvents(): LessonCancelledEvent[] {
    return eventEmitter.emit.mock.calls
      .filter((call) => call[0] === LESSON_CANCELLED_EVENT)
      .map((call) => call[1] as LessonCancelledEvent);
  }

  /** The lessons that were saved one by one (an edit, a cancel, a reschedule). */
  function savedLessons(): Lesson[] {
    return manager.save.mock.calls
      .filter((call) => call[0] instanceof Lesson)
      .map((call) => call[0] as Lesson);
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];
    state = {
      lesson: buildLesson(),
      schoolClass: buildClass(),
      course: buildCourse(),
      plan: buildPlan(),
      position: 1,
    };

    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), {
        id: LESSON_ID,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        deletedAt: null,
        ...data,
      }),
    );
    manager.save.mockImplementation(async (entity: unknown) => {
      order.push(Array.isArray(entity) ? "insert-lessons" : "save-lesson");
      return entity;
    });
    manager.findOne.mockImplementation(async (target: unknown) => {
      if (target !== Lesson) return null;
      order.push("load-lesson");
      return state.lesson;
    });
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => Promise<unknown>) => {
        const result = await callback(manager);
        order.push("commit");
        return result;
      },
    );
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === Lesson ? lessonRepository : undefined,
    );
    lessonRepository.findOne.mockImplementation(async () => state.lesson);
    eventEmitter.emit.mockImplementation((channel: string) => {
      order.push(channel === AUDITABLE_ACTION_EVENT ? "emit-audit" : "emit-cancelled");
      return true;
    });
    clock.now.mockReturnValue(NOW);
    classes.getClassSummary.mockImplementation(async () => {
      order.push("get-class");
      return state.schoolClass;
    });
    courses.getCourseSummary.mockImplementation(async () => {
      order.push("get-course");
      return state.course;
    });
    lessonPlans.getLessonPlanSummary.mockImplementation(async () => {
      order.push("get-plan");
      return state.plan;
    });
    courseLessonPlans.findPosition.mockImplementation(async () => {
      order.push("find-position");
      return state.position;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LessonsService,
        // The real one: the rules of a lesson at birth are exercised here, with the mocked manager.
        LessonCreationService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: ClassesService, useValue: classes },
        { provide: CoursesService, useValue: courses },
        { provide: LessonPlansService, useValue: lessonPlans },
        { provide: CourseLessonPlansService, useValue: courseLessonPlans },
      ],
    }).compile();

    service = moduleRef.get(LessonsService);
  });

  describe("create()", () => {
    const dto: CreateLessonDto = {
      classId: CLASS_ID,
      title: "Teclado, mouse e janelas",
      date: "2026-03-10",
      startTime: "14:00",
      endTime: "15:30",
    };
    const { title: _title, ...bodyWithoutTitle } = dto;

    it("creates a lesson on its own: planned, made by the actor, with the class read FOR SHARE in the transaction", async () => {
      const result = await service.create(dto, ACTOR_ID);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(classes.getClassSummary).toHaveBeenCalledWith(CLASS_ID, manager, { forShare: true });
      expect(lessonPlans.getLessonPlanSummary).not.toHaveBeenCalled();
      expect(courseLessonPlans.findPosition).not.toHaveBeenCalled();
      expect(manager.create).toHaveBeenCalledWith(Lesson, {
        lessonPlanId: null,
        sequenceOrder: null,
        title: "Teclado, mouse e janelas",
        objective: null,
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        location: null,
        expectedStudents: null,
        expectedMonitors: null,
        subject: null,
        classId: CLASS_ID,
        status: LessonStatus.PLANNED,
        createdById: ACTOR_ID,
      });
      expect(order).toEqual(["get-class", "insert-lessons", "get-course", "commit", "emit-audit"]);

      expect(result).toEqual({
        id: LESSON_ID,
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
        lessonPlan: null,
        sequenceOrder: null,
        title: "Teclado, mouse e janelas",
        objective: null,
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        durationMinutes: 90,
        location: null,
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
    });

    it("stores the optional fields it receives", async () => {
      const result = await service.create(
        {
          ...dto,
          objective: "Objetivo da aula.",
          location: "Laboratório 3, bloco B",
          expectedStudents: 15,
          expectedMonitors: 2,
          subject: "Primeiro contato",
        },
        ACTOR_ID,
      );

      expect(manager.create).toHaveBeenCalledWith(
        Lesson,
        expect.objectContaining({
          objective: "Objetivo da aula.",
          location: "Laboratório 3, bloco B",
          expectedStudents: 15,
          expectedMonitors: 2,
          subject: "Primeiro contato",
        }),
      );
      expect(result.location).toBe("Laboratório 3, bloco B");
      expect(result.expectedStudents).toBe(15);
      expect(result.expectedMonitors).toBe(2);
      expect(result.subject).toBe("Primeiro contato");
    });

    it("keeps a head count of zero: 0 is a number, not an absence", async () => {
      await service.create({ ...dto, expectedStudents: 0, expectedMonitors: 0 }, ACTOR_ID);

      expect(manager.create).toHaveBeenCalledWith(
        Lesson,
        expect.objectContaining({ expectedStudents: 0, expectedMonitors: 0 }),
      );
    });

    it("copies title and objective from the lesson plan when the body omits them", async () => {
      const result = await service.create({ ...bodyWithoutTitle, lessonPlanId: PLAN_ID }, ACTOR_ID);

      expect(lessonPlans.getLessonPlanSummary).toHaveBeenCalledWith(PLAN_ID, manager, {
        forShare: true,
      });
      expect(manager.create).toHaveBeenCalledWith(
        Lesson,
        expect.objectContaining({
          lessonPlanId: PLAN_ID,
          sequenceOrder: null,
          title: "Plano: teclado, mouse e janelas",
          objective: "Familiarizar o aluno com o teclado.",
        }),
      );
      expect(result.title).toBe("Plano: teclado, mouse e janelas");
      expect(result.objective).toBe("Familiarizar o aluno com o teclado.");
      expect(result.lessonPlan).toEqual({
        id: PLAN_ID,
        title: "Plano: teclado, mouse e janelas",
        archivedAt: null,
      });
      // Without a position, the plan is an extra lesson: the sequence is not even asked.
      expect(courseLessonPlans.findPosition).not.toHaveBeenCalled();
      expect(order).toEqual([
        "get-class",
        "get-plan",
        "insert-lessons",
        "get-course",
        "commit",
        "emit-audit",
      ]);
    });

    it("body title and objective win over the plan", async () => {
      const result = await service.create(
        {
          ...dto,
          lessonPlanId: PLAN_ID,
          title: "Título da turma",
          objective: "Objetivo da turma.",
        },
        ACTOR_ID,
      );

      expect(manager.create).toHaveBeenCalledWith(
        Lesson,
        expect.objectContaining({
          lessonPlanId: PLAN_ID,
          title: "Título da turma",
          objective: "Objetivo da turma.",
        }),
      );
      expect(result.title).toBe("Título da turma");
      expect(result.objective).toBe("Objetivo da turma.");
    });

    it("leaves the objective empty when the body sends null, instead of copying the one of the plan", async () => {
      const result = await service.create(
        { ...bodyWithoutTitle, lessonPlanId: PLAN_ID, objective: null },
        ACTOR_ID,
      );

      expect(result.objective).toBeNull();
      // The title was omitted, so it is still copied.
      expect(result.title).toBe("Plano: teclado, mouse e janelas");
    });

    it("leaves the objective empty when the plan has none and the body omits it", async () => {
      state.plan = buildPlan({ objective: null });

      const result = await service.create({ ...bodyWithoutTitle, lessonPlanId: PLAN_ID }, ACTOR_ID);

      expect(result.objective).toBeNull();
    });

    it("keeps the title and the objective as a copy: nothing in the lesson points back at the text of the plan", async () => {
      await service.create({ ...bodyWithoutTitle, lessonPlanId: PLAN_ID }, ACTOR_ID);

      // What is stored is the text, on the lesson. The plan is only referenced by id (the origin).
      const [, stored] = manager.create.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(stored.title).toBe("Plano: teclado, mouse e janelas");
      expect(stored.objective).toBe("Familiarizar o aluno com o teclado.");
      expect(stored.lessonPlanId).toBe(PLAN_ID);
    });

    it("stores the id of the plan as the database has it, not as the body spells it", async () => {
      await service.create({ ...bodyWithoutTitle, lessonPlanId: PLAN_ID.toUpperCase() }, ACTOR_ID);

      expect(manager.create).toHaveBeenCalledWith(
        Lesson,
        expect.objectContaining({ lessonPlanId: PLAN_ID }),
      );
    });

    it("checks the position of the plan in the sequence of the course of the class when sequenceOrder is sent", async () => {
      state.position = 2;

      const result = await service.create(
        { ...bodyWithoutTitle, lessonPlanId: PLAN_ID, sequenceOrder: 2 },
        ACTOR_ID,
      );

      expect(courseLessonPlans.findPosition).toHaveBeenCalledWith(COURSE_ID, PLAN_ID, manager);
      expect(manager.create).toHaveBeenCalledWith(
        Lesson,
        expect.objectContaining({ lessonPlanId: PLAN_ID, sequenceOrder: 2 }),
      );
      expect(result.sequenceOrder).toBe(2);
      expect(order).toEqual([
        "get-class",
        "get-plan",
        "find-position",
        "insert-lessons",
        "get-course",
        "commit",
        "emit-audit",
      ]);
    });

    it("throws LESSON_PLAN_NOT_IN_COURSE_SEQUENCE when the position differs", async () => {
      state.position = 3;

      const failure = await httpFailure(
        service.create({ ...dto, lessonPlanId: PLAN_ID, sequenceOrder: 2 }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({
        error: "LESSON_PLAN_NOT_IN_COURSE_SEQUENCE",
        details: [expect.objectContaining({ field: "sequenceOrder" })],
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws LESSON_PLAN_NOT_IN_COURSE_SEQUENCE when the plan is not in the sequence of the course at all", async () => {
      state.position = null;

      const failure = await httpFailure(
        service.create({ ...dto, lessonPlanId: PLAN_ID, sequenceOrder: 1 }, ACTOR_ID),
      );

      expect(codeOf(failure)).toBe("LESSON_PLAN_NOT_IN_COURSE_SEQUENCE");
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws CLASS_NOT_FOUND (400) for an unknown classId, and reads no plan", async () => {
      state.schoolClass = null;

      const failure = await httpFailure(
        service.create({ ...dto, lessonPlanId: PLAN_ID }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({
        error: "CLASS_NOT_FOUND",
        details: [expect.objectContaining({ field: "classId" })],
      });
      expect(lessonPlans.getLessonPlanSummary).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws CLASS_ARCHIVED for an archived class, and reads no plan", async () => {
      state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });

      const failure = await httpFailure(
        service.create({ ...dto, lessonPlanId: PLAN_ID }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("CLASS_ARCHIVED");
      expect(lessonPlans.getLessonPlanSummary).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws LESSON_OUTSIDE_CLASS_PERIOD with details.field date, for the day before the start and the day after the end", async () => {
      for (const date of ["2026-03-02", "2026-06-28"]) {
        const failure = await httpFailure(service.create({ ...dto, date }, ACTOR_ID));

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({
          error: "LESSON_OUTSIDE_CLASS_PERIOD",
          details: [expect.objectContaining({ field: "date" })],
        });
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("accepts the first and the last day of the class", async () => {
      await expect(service.create({ ...dto, date: "2026-03-03" }, ACTOR_ID)).resolves.toMatchObject(
        {
          date: "2026-03-03",
        },
      );
      await expect(service.create({ ...dto, date: "2026-06-27" }, ACTOR_ID)).resolves.toMatchObject(
        {
          date: "2026-06-27",
        },
      );
    });

    it("reads no plan when the day is outside the period", async () => {
      await httpFailure(
        service.create({ ...dto, date: "2027-01-01", lessonPlanId: PLAN_ID }, ACTOR_ID),
      );

      expect(lessonPlans.getLessonPlanSummary).not.toHaveBeenCalled();
    });

    it("throws INVALID_TIME_RANGE before opening the transaction", async () => {
      for (const [startTime, endTime] of [
        ["14:00", "14:00"],
        ["15:30", "14:00"],
      ]) {
        const failure = await httpFailure(service.create({ ...dto, startTime, endTime }, ACTOR_ID));

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({
          error: "INVALID_TIME_RANGE",
          details: [expect.objectContaining({ field: "endTime" })],
        });
      }
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(classes.getClassSummary).not.toHaveBeenCalled();
    });

    it("throws LESSON_PLAN_NOT_FOUND (400) when the plan does not exist", async () => {
      state.plan = null;

      const failure = await httpFailure(
        service.create({ ...dto, lessonPlanId: PLAN_ID }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({
        error: "LESSON_PLAN_NOT_FOUND",
        details: [expect.objectContaining({ field: "lessonPlanId" })],
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws LESSON_PLAN_ARCHIVED (400) for an archived plan, without asking for its position", async () => {
      state.plan = buildPlan({ archivedAt: ARCHIVED_AT });

      const failure = await httpFailure(
        service.create({ ...dto, lessonPlanId: PLAN_ID, sequenceOrder: 1 }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({
        error: "LESSON_PLAN_ARCHIVED",
        details: [expect.objectContaining({ field: "lessonPlanId" })],
      });
      expect(courseLessonPlans.findPosition).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    describe("order of the errors", () => {
      const withPlan: CreateLessonDto = { ...dto, lessonPlanId: PLAN_ID, sequenceOrder: 2 };

      it("answers INVALID_TIME_RANGE before looking for the class", async () => {
        state.schoolClass = null;

        const failure = await httpFailure(
          service.create({ ...withPlan, startTime: "16:00", endTime: "15:00" }, ACTOR_ID),
        );

        expect(codeOf(failure)).toBe("INVALID_TIME_RANGE");
      });

      it("answers CLASS_NOT_FOUND before everything about the class and the plan", async () => {
        state.schoolClass = null;
        state.plan = null;

        const failure = await httpFailure(
          service.create({ ...withPlan, date: "2030-01-01" }, ACTOR_ID),
        );

        expect(codeOf(failure)).toBe("CLASS_NOT_FOUND");
      });

      it("answers CLASS_ARCHIVED before the period and the plan", async () => {
        state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });
        state.plan = buildPlan({ archivedAt: ARCHIVED_AT });

        const failure = await httpFailure(
          service.create({ ...withPlan, date: "2030-01-01" }, ACTOR_ID),
        );

        expect(codeOf(failure)).toBe("CLASS_ARCHIVED");
      });

      it("answers LESSON_OUTSIDE_CLASS_PERIOD before the plan", async () => {
        state.plan = null;

        const failure = await httpFailure(
          service.create({ ...withPlan, date: "2030-01-01" }, ACTOR_ID),
        );

        expect(codeOf(failure)).toBe("LESSON_OUTSIDE_CLASS_PERIOD");
      });

      it("answers LESSON_PLAN_NOT_FOUND before LESSON_PLAN_ARCHIVED and the sequence", async () => {
        state.plan = null;
        state.position = 5;

        const failure = await httpFailure(service.create(withPlan, ACTOR_ID));

        expect(codeOf(failure)).toBe("LESSON_PLAN_NOT_FOUND");
      });

      it("answers LESSON_PLAN_ARCHIVED before the sequence", async () => {
        state.plan = buildPlan({ archivedAt: ARCHIVED_AT });
        state.position = 5;

        const failure = await httpFailure(service.create(withPlan, ACTOR_ID));

        expect(codeOf(failure)).toBe("LESSON_PLAN_ARCHIVED");
      });
    });

    it("emits LESSON_CREATED once, after the commit, with what was created and no notes", async () => {
      await service.create(
        { ...dto, lessonPlanId: PLAN_ID, sequenceOrder: 1, location: "Sala 2" },
        ACTOR_ID,
      );

      expect(order).toEqual([
        "get-class",
        "get-plan",
        "find-position",
        "insert-lessons",
        "get-course",
        "commit",
        "emit-audit",
      ]);
      const events = auditEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(AuditableActionEvent);
      expect(events[0].action).toBe(AuditableAction.LESSON_CREATED);
      expect(events[0].actorId).toBe(ACTOR_ID);
      expect(events[0].targetType).toBe("lesson");
      expect(events[0].targetId).toBe(LESSON_ID);
      expect(events[0].before).toBeNull();
      expect(events[0].after).toEqual({
        classId: CLASS_ID,
        lessonPlanId: PLAN_ID,
        sequenceOrder: 1,
        title: "Teclado, mouse e janelas",
        // Not in the body, so it is the copy of the objective of the plan (RN-18).
        objective: "Familiarizar o aluno com o teclado.",
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        location: "Sala 2",
        expectedStudents: null,
        expectedMonitors: null,
        subject: null,
        status: LessonStatus.PLANNED,
      });
      expect(events[0].after).not.toHaveProperty("postNotes");
      expect(events[0].occurredAt).toEqual(NOW);
      // The creation announces nothing on the channel of the hours.
      expect(cancelledEvents()).toHaveLength(0);
    });

    it("does not emit when the transaction fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.create(dto, ACTOR_ID)).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("maps 23514 ck_lessons_time_range to INVALID_TIME_RANGE", async () => {
      manager.save.mockRejectedValueOnce(violation("23514", "ck_lessons_time_range"));

      const failure = await httpFailure(service.create(dto, ACTOR_ID));

      expect(failure.getStatus()).toBe(400);
      expect(codeOf(failure)).toBe("INVALID_TIME_RANGE");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("maps 23503 fk_lessons_class_id to CLASS_NOT_FOUND and fk_lessons_lesson_plan_id to LESSON_PLAN_NOT_FOUND", async () => {
      manager.save.mockRejectedValueOnce(violation("23503", "fk_lessons_class_id"));
      const missingClass = await httpFailure(service.create(dto, ACTOR_ID));
      expect(missingClass.getStatus()).toBe(400);
      expect(codeOf(missingClass)).toBe("CLASS_NOT_FOUND");

      manager.save.mockRejectedValueOnce(violation("23503", "fk_lessons_lesson_plan_id"));
      const missingPlan = await httpFailure(
        service.create({ ...dto, lessonPlanId: PLAN_ID }, ACTOR_ID),
      );
      expect(missingPlan.getStatus()).toBe(400);
      expect(codeOf(missingPlan)).toBe("LESSON_PLAN_NOT_FOUND");
    });

    it("lets any other constraint violation through, as it came", async () => {
      const other = violation("23514", "ck_lessons_cancellation");
      manager.save.mockRejectedValueOnce(other);

      await expect(service.create(dto, ACTOR_ID)).rejects.toBe(other);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("fails loudly, with no HTTP error, for a body with neither a title nor a plan: the DTO prevents it", async () => {
      await expect(service.create(bodyWithoutTitle, ACTOR_ID)).rejects.toThrow(/needs a title/);

      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws an Error when the course of the class is missing: the foreign key requires it", async () => {
      state.course = null;

      await expect(service.create(dto, ACTOR_ID)).rejects.toThrow(/Course .* was not found/);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("findById()", () => {
    beforeEach(() => {
      state.lesson = buildLesson({ lessonPlanId: PLAN_ID, sequenceOrder: 1 });
    });

    it("returns the lesson with its class, course, edition and the lesson plan it came from", async () => {
      const result = await service.findById(LESSON_ID);

      expect(lessonRepository.findOne).toHaveBeenCalledWith({ where: { id: LESSON_ID } });
      expect(result).toMatchObject({
        id: LESSON_ID,
        class: { id: CLASS_ID, code: "INFO-A", startDate: "2026-03-03", endDate: "2026-06-27" },
        course: { id: COURSE_ID, name: "Informática Básica" },
        edition: { id: EDITION_ID, name: "2026.1" },
        lessonPlan: { id: PLAN_ID, title: "Plano: teclado, mouse e janelas", archivedAt: null },
        sequenceOrder: 1,
        title: "Teclado, mouse e janelas",
        durationMinutes: 90,
        status: LessonStatus.PLANNED,
      });
    });

    it("shows the title the lesson has, not the one the plan has now (RN-18)", async () => {
      const result = await service.findById(LESSON_ID);

      expect(result.title).toBe("Teclado, mouse e janelas");
      expect(result.lessonPlan?.title).toBe("Plano: teclado, mouse e janelas");
    });

    it("answers lessonPlan null for a lesson on its own, without reading any plan", async () => {
      state.lesson = buildLesson();

      const result = await service.findById(LESSON_ID);

      expect(result.lessonPlan).toBeNull();
      expect(lessonPlans.getLessonPlanSummary).not.toHaveBeenCalled();
    });

    it("throws 404 LESSON_NOT_FOUND and reads nothing else when the lesson does not exist", async () => {
      state.lesson = null;

      const failure = await httpFailure(service.findById(LESSON_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "LESSON_NOT_FOUND",
        message: "Lesson not found.",
      });
      expect(classes.getClassSummary).not.toHaveBeenCalled();
      expect(courses.getCourseSummary).not.toHaveBeenCalled();
      expect(lessonPlans.getLessonPlanSummary).not.toHaveBeenCalled();
    });

    it("shows a lesson of an archived class and one whose plan was archived later, with archivedAt", async () => {
      state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });
      state.plan = buildPlan({ archivedAt: ARCHIVED_AT });

      const result = await service.findById(LESSON_ID);

      expect(result.class.archivedAt).toEqual(ARCHIVED_AT);
      expect(result.lessonPlan?.archivedAt).toEqual(ARCHIVED_AT);
    });

    it("shows a cancelled lesson with its reason", async () => {
      state.lesson = buildLesson({
        status: LessonStatus.CANCELLED,
        cancelReason: "Feriado.",
        cancelledAt: NOW,
        cancelledById: OTHER_ID,
      });

      const result = await service.findById(LESSON_ID);

      expect(result.status).toBe(LessonStatus.CANCELLED);
      expect(result.cancelReason).toBe("Feriado.");
      expect(result.cancelledAt).toEqual(NOW);
      expect(result.cancelledById).toBe(OTHER_ID);
    });

    it("takes no transaction, no lock and emits no event", async () => {
      await service.findById(LESSON_ID);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      // The class and the plan are read plainly: no manager and no lock.
      expect(classes.getClassSummary).toHaveBeenCalledWith(CLASS_ID, undefined);
      expect(lessonPlans.getLessonPlanSummary).toHaveBeenCalledWith(PLAN_ID, undefined);
      expect(courses.getCourseSummary).toHaveBeenCalledWith(COURSE_ID, undefined);
    });

    it("throws an Error when a reference of the lesson is missing: the foreign keys require them", async () => {
      state.schoolClass = null;
      await expect(service.findById(LESSON_ID)).rejects.toThrow(/Class .* was not found/);

      state.schoolClass = buildClass();
      state.plan = null;
      await expect(service.findById(LESSON_ID)).rejects.toThrow(/Lesson plan .* was not found/);
    });
  });

  describe("update()", () => {
    beforeEach(() => {
      state.lesson = buildLesson({ lessonPlanId: PLAN_ID });
    });

    it("throws 404 LESSON_NOT_FOUND when the lesson does not exist, and reads no class", async () => {
      state.lesson = null;

      const failure = await httpFailure(service.update(LESSON_ID, { title: "Novo" }, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("LESSON_NOT_FOUND");
      expect(classes.getClassSummary).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("update throws LESSON_CANCELLED for a cancelled lesson, before looking at the class", async () => {
      state.lesson = buildLesson({
        status: LessonStatus.CANCELLED,
        cancelReason: "Feriado.",
        cancelledAt: NOW,
        cancelledById: OTHER_ID,
      });

      const failure = await httpFailure(service.update(LESSON_ID, { title: "Novo" }, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("LESSON_CANCELLED");
      expect(classes.getClassSummary).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws CLASS_ARCHIVED for an archived class, even for a body that changes nothing", async () => {
      state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });

      for (const body of [{ title: "Novo" }, {}, { title: "Teclado, mouse e janelas" }]) {
        const failure = await httpFailure(service.update(LESSON_ID, body, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("CLASS_ARCHIVED");
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("answers LESSON_CANCELLED before CLASS_ARCHIVED", async () => {
      state.lesson = buildLesson({
        status: LessonStatus.CANCELLED,
        cancelledAt: NOW,
        cancelledById: OTHER_ID,
      });
      state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });

      const failure = await httpFailure(service.update(LESSON_ID, { title: "Novo" }, ACTOR_ID));

      expect(codeOf(failure)).toBe("LESSON_CANCELLED");
    });

    it("locks the lesson FOR UPDATE first and the class FOR SHARE after it", async () => {
      await service.update(LESSON_ID, { title: "Novo título" }, ACTOR_ID);

      expect(manager.findOne).toHaveBeenCalledWith(Lesson, {
        where: { id: LESSON_ID },
        lock: { mode: "pessimistic_write" },
      });
      expect(classes.getClassSummary).toHaveBeenCalledWith(CLASS_ID, manager, { forShare: true });
      expect(order).toEqual([
        "load-lesson",
        "get-class",
        "save-lesson",
        "get-course",
        "get-plan",
        "commit",
        "emit-audit",
      ]);
    });

    it("edits title, objective, location, head counts, subject, notes and status, and takes updatedAt from the clock", async () => {
      clock.now.mockReturnValueOnce(NOW).mockReturnValue(LATER);

      const result = await service.update(
        LESSON_ID,
        {
          title: "Novo título",
          objective: "Novo objetivo.",
          location: "Sala 2",
          expectedStudents: 12,
          expectedMonitors: 3,
          subject: "Novo assunto",
          postNotes: "A turma terminou antes do previsto.",
          status: LessonStatus.CONFIRMED,
        },
        ACTOR_ID,
      );

      const [saved] = savedLessons();
      expect(saved.id).toBe(LESSON_ID);
      expect(saved).toMatchObject({
        title: "Novo título",
        objective: "Novo objetivo.",
        location: "Sala 2",
        expectedStudents: 12,
        expectedMonitors: 3,
        subject: "Novo assunto",
        postNotes: "A turma terminou antes do previsto.",
        status: LessonStatus.CONFIRMED,
      });
      expect(saved.updatedAt).toEqual(NOW);
      expect(result).toMatchObject({
        id: LESSON_ID,
        title: "Novo título",
        objective: "Novo objetivo.",
        location: "Sala 2",
        expectedStudents: 12,
        expectedMonitors: 3,
        subject: "Novo assunto",
        postNotes: "A turma terminou antes do previsto.",
        status: LessonStatus.CONFIRMED,
        updatedAt: NOW,
        createdAt: CREATED_AT,
      });
      expect(auditEvents()[0].occurredAt).toEqual(LATER);
    });

    it("never writes the fields that are not editable: the class, the plan, the day and the times stay as they are", async () => {
      await service.update(LESSON_ID, { title: "Novo título" }, ACTOR_ID);

      const [saved] = savedLessons();
      expect(saved).toMatchObject({
        classId: CLASS_ID,
        lessonPlanId: PLAN_ID,
        sequenceOrder: null,
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        originalDate: null,
      });
    });

    it("ignores the day, the times, the class and the plan even when they reach the service", async () => {
      const body = {
        date: "2026-03-17",
        startTime: "09:00",
        endTime: "10:00",
        classId: OTHER_ID,
        lessonPlanId: OTHER_ID,
        sequenceOrder: 4,
        originalDate: "2026-01-01",
      } as unknown as UpdateLessonDto;

      const result = await service.update(LESSON_ID, body, ACTOR_ID);

      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        originalDate: null,
      });
    });

    it("emits LESSON_UPDATED once, after the commit, with only the fields that changed", async () => {
      state.lesson = buildLesson({ location: "Sala 1", expectedStudents: 10 });

      await service.update(
        LESSON_ID,
        { title: "Novo título", location: "Sala 2", expectedStudents: 10, subject: "Assunto" },
        ACTOR_ID,
      );

      expect(order.slice(-2)).toEqual(["commit", "emit-audit"]);
      const events = auditEvents();
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe(AuditableAction.LESSON_UPDATED);
      expect(events[0].actorId).toBe(ACTOR_ID);
      expect(events[0].targetType).toBe("lesson");
      expect(events[0].targetId).toBe(LESSON_ID);
      expect(events[0].before).toEqual({
        title: "Teclado, mouse e janelas",
        location: "Sala 1",
        subject: null,
      });
      expect(events[0].after).toEqual({
        title: "Novo título",
        location: "Sala 2",
        subject: "Assunto",
        changedFields: ["title", "location", "subject"],
      });
      expect(events[0].occurredAt).toEqual(NOW);
    });

    it("update with nothing changed does not save nor emit", async () => {
      state.lesson = buildLesson({ location: "Sala 1", status: LessonStatus.CONFIRMED });

      for (const body of [
        {},
        { title: "Teclado, mouse e janelas", location: "Sala 1", status: LessonStatus.CONFIRMED },
        { objective: null, subject: null, postNotes: null },
      ]) {
        const result = await service.update(LESSON_ID, body, ACTOR_ID);

        expect(result.updatedAt).toEqual(CREATED_AT);
      }

      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("update event carries postNotes only in changedFields", async () => {
      await service.update(
        LESSON_ID,
        { title: "Novo título", postNotes: "A aluna passou mal no fim da aula." },
        ACTOR_ID,
      );

      const [event] = auditEvents();
      expect(event.after.changedFields).toEqual(["title", "postNotes"]);
      expect(event.after).not.toHaveProperty("postNotes");
      expect(event.before).not.toHaveProperty("postNotes");
      // The text of the notes is nowhere in the event.
      expect(JSON.stringify(event)).not.toContain("passou mal");
      // It was saved, all the same.
      expect(savedLessons()[0].postNotes).toBe("A aluna passou mal no fim da aula.");
    });

    it("emits an edit of the notes alone with the field named and no value", async () => {
      await service.update(LESSON_ID, { postNotes: "Notas." }, ACTOR_ID);

      const [event] = auditEvents();
      expect(event.before).toEqual({});
      expect(event.after).toEqual({ changedFields: ["postNotes"] });
    });

    it("clears the fields that take null, and the event shows what they had", async () => {
      state.lesson = buildLesson({
        objective: "Objetivo.",
        location: "Sala 1",
        expectedStudents: 10,
        expectedMonitors: 2,
        subject: "Assunto",
        postNotes: "Notas.",
      });

      const result = await service.update(
        LESSON_ID,
        {
          objective: null,
          location: null,
          expectedStudents: null,
          expectedMonitors: null,
          subject: null,
          postNotes: null,
        },
        ACTOR_ID,
      );

      expect(result).toMatchObject({
        objective: null,
        location: null,
        expectedStudents: null,
        expectedMonitors: null,
        subject: null,
        postNotes: null,
      });
      const [event] = auditEvents();
      expect(event.before).toEqual({
        objective: "Objetivo.",
        location: "Sala 1",
        expectedStudents: 10,
        expectedMonitors: 2,
        subject: "Assunto",
      });
      expect(event.after).toEqual({
        objective: null,
        location: null,
        expectedStudents: null,
        expectedMonitors: null,
        subject: null,
        changedFields: [
          "objective",
          "location",
          "expectedStudents",
          "expectedMonitors",
          "subject",
          "postNotes",
        ],
      });
    });

    it("moves between planned, confirmed and done in any direction: no rule limits it yet", async () => {
      for (const [from, to] of [
        [LessonStatus.PLANNED, LessonStatus.CONFIRMED],
        [LessonStatus.CONFIRMED, LessonStatus.DONE],
        [LessonStatus.DONE, LessonStatus.PLANNED],
        [LessonStatus.PLANNED, LessonStatus.DONE],
      ]) {
        state.lesson = buildLesson({ status: from });

        const result = await service.update(LESSON_ID, { status: to }, ACTOR_ID);

        expect(result.status).toBe(to);
      }
      expect(auditEvents()).toHaveLength(4);
    });

    it("emits the id of the database when the path has it in upper case", async () => {
      await service.update(LESSON_ID.toUpperCase(), { title: "Novo título" }, ACTOR_ID);

      expect(manager.findOne).toHaveBeenCalledWith(
        Lesson,
        expect.objectContaining({ where: { id: LESSON_ID.toUpperCase() } }),
      );
      expect(auditEvents()[0].targetId).toBe(LESSON_ID);
    });

    it("does not emit when the save fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.update(LESSON_ID, { title: "Novo título" }, ACTOR_ID)).rejects.toThrow(
        "connection lost",
      );

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws an Error, not an HTTP error, when the class of the lesson is missing: the foreign key requires it", async () => {
      state.schoolClass = null;

      await expect(service.update(LESSON_ID, { title: "Novo" }, ACTOR_ID)).rejects.toThrow(
        /Class .* of a lesson was not found/,
      );
      await expect(service.cancel(LESSON_ID, { reason: "Feriado." }, ACTOR_ID)).rejects.toThrow(
        /Class .* of a lesson was not found/,
      );
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("reads the plan only to show it: it asks for no lock and writes nothing of it", async () => {
      await service.update(LESSON_ID, { title: "Novo título" }, ACTOR_ID);

      expect(lessonPlans.getLessonPlanSummary).toHaveBeenCalledWith(PLAN_ID, manager);
      expect(courseLessonPlans.findPosition).not.toHaveBeenCalled();
    });
  });

  describe("cancel()", () => {
    it("throws 404 LESSON_NOT_FOUND when the lesson does not exist", async () => {
      state.lesson = null;

      const failure = await httpFailure(
        service.cancel(LESSON_ID, { reason: "Feriado." }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("LESSON_NOT_FOUND");
      expect(classes.getClassSummary).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("cancel sets status, reason, cancelledAt and cancelledById from the clock", async () => {
      // The first read is the instant of the cancellation; the event reads the clock again, later.
      clock.now.mockReturnValueOnce(NOW).mockReturnValue(LATER);

      const result = await service.cancel(LESSON_ID, { reason: "Feriado municipal." }, ACTOR_ID);

      const [saved] = savedLessons();
      expect(saved.id).toBe(LESSON_ID);
      expect(saved).toMatchObject({
        status: LessonStatus.CANCELLED,
        cancelReason: "Feriado municipal.",
        cancelledById: ACTOR_ID,
      });
      expect(saved.cancelledAt).toEqual(NOW);
      expect(saved.updatedAt).toEqual(NOW);
      expect(result).toMatchObject({
        id: LESSON_ID,
        status: LessonStatus.CANCELLED,
        cancelReason: "Feriado municipal.",
        cancelledById: ACTOR_ID,
        cancelledAt: NOW,
        updatedAt: NOW,
      });
      expect(auditEvents()[0].occurredAt).toEqual(LATER);
    });

    it("keeps the lesson: it saves the same row, and nothing is deleted", async () => {
      const result = await service.cancel(LESSON_ID, { reason: "Feriado." }, ACTOR_ID);

      // The manager of the test has no delete or remove: calling one would throw.
      expect(Object.keys(manager).sort()).toEqual(["create", "findOne", "save"]);
      expect(savedLessons()).toHaveLength(1);
      expect(result.id).toBe(LESSON_ID);
      // The schedule and the origin stay as they were.
      expect(result).toMatchObject({ date: "2026-03-10", startTime: "14:00", endTime: "15:30" });
    });

    it("locks the lesson FOR UPDATE first and the class FOR SHARE after it", async () => {
      await service.cancel(LESSON_ID, { reason: "Feriado." }, ACTOR_ID);

      expect(manager.findOne).toHaveBeenCalledWith(Lesson, {
        where: { id: LESSON_ID },
        lock: { mode: "pessimistic_write" },
      });
      expect(classes.getClassSummary).toHaveBeenCalledWith(CLASS_ID, manager, { forShare: true });
      expect(order.slice(0, 3)).toEqual(["load-lesson", "get-class", "save-lesson"]);
    });

    it.each([LessonStatus.PLANNED, LessonStatus.CONFIRMED, LessonStatus.DONE])(
      "cancels a %s lesson, and the audit event says what it was",
      async (status) => {
        state.lesson = buildLesson({ status });

        const result = await service.cancel(LESSON_ID, { reason: "Feriado." }, ACTOR_ID);

        expect(result.status).toBe(LessonStatus.CANCELLED);
        const [event] = auditEvents();
        expect(event.action).toBe(AuditableAction.LESSON_CANCELLED);
        expect(event.before).toEqual({ status });
        expect(event.after).toEqual({ status: LessonStatus.CANCELLED, cancelledAt: NOW });
      },
    );

    it("keeps the reason out of the audit event: it is free text (RNF-13)", async () => {
      await service.cancel(LESSON_ID, { reason: "A aluna foi internada." }, ACTOR_ID);

      const [event] = auditEvents();
      expect(event.targetType).toBe("lesson");
      expect(event.targetId).toBe(LESSON_ID);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(JSON.stringify(event)).not.toContain("internada");
      expect(event.after).not.toHaveProperty("cancelReason");
    });

    it("cancel emits LessonCancelledEvent after the commit, only when it changed", async () => {
      await service.cancel(LESSON_ID, { reason: "Feriado." }, ACTOR_ID);

      // The audit trail first, then the hook of the hours, both after the commit.
      expect(order.slice(-3)).toEqual(["commit", "emit-audit", "emit-cancelled"]);
      const events = cancelledEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(LessonCancelledEvent);
      expect(events[0]).toEqual({
        lessonId: LESSON_ID,
        classId: CLASS_ID,
        date: "2026-03-10",
        cancelledById: ACTOR_ID,
        cancelledAt: NOW,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(LESSON_CANCELLED_EVENT, events[0]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
    });

    it("tells the hours about the day the lesson has now, after a reschedule", async () => {
      state.lesson = buildLesson({ date: "2026-03-17", originalDate: "2026-03-10" });

      await service.cancel(LESSON_ID, { reason: "Feriado." }, ACTOR_ID);

      expect(cancelledEvents()[0].date).toBe("2026-03-17");
    });

    it("cancel of a cancelled lesson is a no-op that keeps the first reason", async () => {
      state.lesson = buildLesson({
        status: LessonStatus.CANCELLED,
        cancelReason: "Primeiro motivo.",
        cancelledAt: new Date("2026-03-05T12:00:00.000Z"),
        cancelledById: OTHER_ID,
        updatedAt: new Date("2026-03-05T12:00:00.000Z"),
      });

      const result = await service.cancel(LESSON_ID, { reason: "Segundo motivo." }, ACTOR_ID);

      expect(result).toMatchObject({
        id: LESSON_ID,
        status: LessonStatus.CANCELLED,
        cancelReason: "Primeiro motivo.",
        cancelledById: OTHER_ID,
        cancelledAt: new Date("2026-03-05T12:00:00.000Z"),
        updatedAt: new Date("2026-03-05T12:00:00.000Z"),
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("answers 200 for a cancelled lesson of an archived class: the no-op comes before the check of the class", async () => {
      state.lesson = buildLesson({
        status: LessonStatus.CANCELLED,
        cancelReason: "Primeiro motivo.",
        cancelledAt: NOW,
        cancelledById: OTHER_ID,
      });
      state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });

      const result = await service.cancel(LESSON_ID, { reason: "Segundo motivo." }, ACTOR_ID);

      expect(result.status).toBe(LessonStatus.CANCELLED);
      expect(result.class.archivedAt).toEqual(ARCHIVED_AT);
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      // The class is only read to answer: no lock.
      expect(classes.getClassSummary).not.toHaveBeenCalledWith(CLASS_ID, manager, {
        forShare: true,
      });
    });

    it("throws CLASS_ARCHIVED for an archived class and writes nothing", async () => {
      state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });

      const failure = await httpFailure(
        service.cancel(LESSON_ID, { reason: "Feriado." }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("CLASS_ARCHIVED");
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not emit either event when the save fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.cancel(LESSON_ID, { reason: "Feriado." }, ACTOR_ID)).rejects.toThrow(
        "connection lost",
      );

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits the id of the database when the path has it in upper case", async () => {
      await service.cancel(LESSON_ID.toUpperCase(), { reason: "Feriado." }, ACTOR_ID);

      expect(auditEvents()[0].targetId).toBe(LESSON_ID);
      expect(cancelledEvents()[0].lessonId).toBe(LESSON_ID);
    });
  });

  describe("reschedule()", () => {
    const body = { date: "2026-03-17", startTime: "14:00", endTime: "15:30" };

    it("throws INVALID_TIME_RANGE before opening the transaction", async () => {
      for (const [startTime, endTime] of [
        ["14:00", "14:00"],
        ["15:30", "14:00"],
      ]) {
        const failure = await httpFailure(
          service.reschedule(LESSON_ID, { ...body, startTime, endTime }, ACTOR_ID),
        );

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({
          error: "INVALID_TIME_RANGE",
          details: [expect.objectContaining({ field: "endTime" })],
        });
      }
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("throws 404 LESSON_NOT_FOUND when the lesson does not exist", async () => {
      state.lesson = null;

      const failure = await httpFailure(service.reschedule(LESSON_ID, body, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("LESSON_NOT_FOUND");
      expect(classes.getClassSummary).not.toHaveBeenCalled();
    });

    it("reschedule throws LESSON_CANCELLED for a cancelled lesson", async () => {
      state.lesson = buildLesson({
        status: LessonStatus.CANCELLED,
        cancelledAt: NOW,
        cancelledById: OTHER_ID,
      });

      const failure = await httpFailure(service.reschedule(LESSON_ID, body, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("LESSON_CANCELLED");
      expect(classes.getClassSummary).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws CLASS_ARCHIVED for an archived class, even for the schedule it already has", async () => {
      state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });

      for (const date of ["2026-03-17", "2026-03-10"]) {
        const failure = await httpFailure(
          service.reschedule(LESSON_ID, { ...body, date }, ACTOR_ID),
        );

        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("CLASS_ARCHIVED");
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws LESSON_OUTSIDE_CLASS_PERIOD with details.field date, for the day before the start and the day after the end", async () => {
      for (const date of ["2026-03-02", "2026-06-28"]) {
        const failure = await httpFailure(
          service.reschedule(LESSON_ID, { ...body, date }, ACTOR_ID),
        );

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({
          error: "LESSON_OUTSIDE_CLASS_PERIOD",
          details: [expect.objectContaining({ field: "date" })],
        });
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("accepts the first and the last day of the class", async () => {
      await expect(
        service.reschedule(LESSON_ID, { ...body, date: "2026-03-03" }, ACTOR_ID),
      ).resolves.toMatchObject({ date: "2026-03-03" });
      state.lesson = buildLesson();
      await expect(
        service.reschedule(LESSON_ID, { ...body, date: "2026-06-27" }, ACTOR_ID),
      ).resolves.toMatchObject({ date: "2026-06-27" });
    });

    describe("order of the errors", () => {
      it("answers LESSON_CANCELLED before CLASS_ARCHIVED and the period", async () => {
        state.lesson = buildLesson({
          status: LessonStatus.CANCELLED,
          cancelledAt: NOW,
          cancelledById: OTHER_ID,
        });
        state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });

        const failure = await httpFailure(
          service.reschedule(LESSON_ID, { ...body, date: "2030-01-01" }, ACTOR_ID),
        );

        expect(codeOf(failure)).toBe("LESSON_CANCELLED");
      });

      it("answers CLASS_ARCHIVED before the period", async () => {
        state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });

        const failure = await httpFailure(
          service.reschedule(LESSON_ID, { ...body, date: "2030-01-01" }, ACTOR_ID),
        );

        expect(codeOf(failure)).toBe("CLASS_ARCHIVED");
      });

      it("answers INVALID_TIME_RANGE before everything that needs the lesson", async () => {
        state.lesson = null;

        const failure = await httpFailure(
          service.reschedule(
            LESSON_ID,
            { ...body, date: "2030-01-01", startTime: "16:00", endTime: "15:00" },
            ACTOR_ID,
          ),
        );

        expect(codeOf(failure)).toBe("INVALID_TIME_RANGE");
      });
    });

    it("reschedule keeps the id and stores the previous date in originalDate", async () => {
      const result = await service.reschedule(
        LESSON_ID,
        { date: "2026-03-17", startTime: "09:00", endTime: "10:30" },
        ACTOR_ID,
      );

      const [saved] = savedLessons();
      expect(saved.id).toBe(LESSON_ID);
      expect(saved).toMatchObject({
        date: "2026-03-17",
        startTime: "09:00",
        endTime: "10:30",
        originalDate: "2026-03-10",
        status: LessonStatus.PLANNED,
      });
      expect(result).toMatchObject({
        id: LESSON_ID,
        date: "2026-03-17",
        startTime: "09:00",
        endTime: "10:30",
        durationMinutes: 90,
        originalDate: "2026-03-10",
        status: LessonStatus.PLANNED,
      });
      expect(manager.create).not.toHaveBeenCalled();
    });

    it("a second reschedule keeps the first originalDate", async () => {
      state.lesson = buildLesson({ date: "2026-03-17", originalDate: "2026-03-10" });

      const result = await service.reschedule(
        LESSON_ID,
        { date: "2026-03-24", startTime: "14:00", endTime: "15:30" },
        ACTOR_ID,
      );

      expect(result.date).toBe("2026-03-24");
      expect(result.originalDate).toBe("2026-03-10");
    });

    it("keeps the first originalDate even when the lesson goes back to it", async () => {
      state.lesson = buildLesson({ date: "2026-03-17", originalDate: "2026-03-10" });

      const result = await service.reschedule(
        LESSON_ID,
        { date: "2026-03-10", startTime: "14:00", endTime: "15:30" },
        ACTOR_ID,
      );

      expect(result.date).toBe("2026-03-10");
      expect(result.originalDate).toBe("2026-03-10");
    });

    it("a reschedule that only moves the time still sets originalDate: it marks the lesson as rescheduled", async () => {
      const result = await service.reschedule(
        LESSON_ID,
        { date: "2026-03-10", startTime: "16:00", endTime: "17:30" },
        ACTOR_ID,
      );

      expect(result).toMatchObject({
        date: "2026-03-10",
        startTime: "16:00",
        endTime: "17:30",
        originalDate: "2026-03-10",
      });
      expect(auditEvents()).toHaveLength(1);
    });

    it("reschedule with the same schedule is a no-op", async () => {
      const result = await service.reschedule(
        LESSON_ID,
        { date: "2026-03-10", startTime: "14:00", endTime: "15:30" },
        ACTOR_ID,
      );

      expect(result).toMatchObject({
        id: LESSON_ID,
        date: "2026-03-10",
        originalDate: null,
        updatedAt: CREATED_AT,
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("is a no-op too when the place sent is the one the lesson has, and when only a reason or a note is new", async () => {
      state.lesson = buildLesson({ location: "Sala 1" });

      await service.reschedule(
        LESSON_ID,
        {
          date: "2026-03-10",
          startTime: "14:00",
          endTime: "15:30",
          location: "Sala 1",
          reason: "Motivo novo.",
          note: "Nota nova.",
        },
        ACTOR_ID,
      );

      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(state.lesson).toMatchObject({ rescheduleReason: null, rescheduleNote: null });
    });

    it("is a no-op for a schedule equal to the one a lesson already rescheduled has", async () => {
      state.lesson = buildLesson({
        date: "2026-03-17",
        originalDate: "2026-03-10",
        rescheduleReason: "Motivo antigo.",
      });

      await service.reschedule(
        LESSON_ID,
        { date: "2026-03-17", startTime: "14:00", endTime: "15:30" },
        ACTOR_ID,
      );

      expect(manager.save).not.toHaveBeenCalled();
      // The reason of the last reschedule is not wiped by a request that changed nothing.
      expect(state.lesson?.rescheduleReason).toBe("Motivo antigo.");
    });

    it("reschedule replaces location when sent and keeps it when omitted", async () => {
      state.lesson = buildLesson({ location: "Sala 1" });
      const replaced = await service.reschedule(
        LESSON_ID,
        { ...body, location: "Laboratório 2" },
        ACTOR_ID,
      );
      expect(replaced.location).toBe("Laboratório 2");

      state.lesson = buildLesson({ location: "Sala 1" });
      const kept = await service.reschedule(LESSON_ID, body, ACTOR_ID);
      expect(kept.location).toBe("Sala 1");

      state.lesson = buildLesson({ location: "Sala 1" });
      const cleared = await service.reschedule(LESSON_ID, { ...body, location: null }, ACTOR_ID);
      expect(cleared.location).toBeNull();
    });

    it("counts a change of place alone as a change", async () => {
      state.lesson = buildLesson({ location: "Sala 1" });

      const result = await service.reschedule(
        LESSON_ID,
        { date: "2026-03-10", startTime: "14:00", endTime: "15:30", location: "Sala 2" },
        ACTOR_ID,
      );

      expect(result).toMatchObject({ location: "Sala 2", originalDate: "2026-03-10" });
      expect(savedLessons()).toHaveLength(1);
      expect(auditEvents()).toHaveLength(1);
    });

    it("stores the reason and the note of this reschedule, and an omitted one becomes null", async () => {
      const first = await service.reschedule(
        LESSON_ID,
        { ...body, reason: "Laboratório em manutenção.", note: "Avisar a turma." },
        ACTOR_ID,
      );
      expect(first.rescheduleReason).toBe("Laboratório em manutenção.");
      expect(first.rescheduleNote).toBe("Avisar a turma.");

      // A second reschedule that states neither describes itself: it does not inherit the first.
      const second = await service.reschedule(
        LESSON_ID,
        { date: "2026-03-24", startTime: "14:00", endTime: "15:30" },
        ACTOR_ID,
      );
      expect(second.rescheduleReason).toBeNull();
      expect(second.rescheduleNote).toBeNull();
      expect(second.originalDate).toBe("2026-03-10");
    });

    it("takes null for the reason and the note as null", async () => {
      state.lesson = buildLesson({ rescheduleReason: "Antigo.", rescheduleNote: "Antiga." });

      const result = await service.reschedule(
        LESSON_ID,
        { ...body, reason: null, note: null },
        ACTOR_ID,
      );

      expect(result.rescheduleReason).toBeNull();
      expect(result.rescheduleNote).toBeNull();
    });

    it("does not change the status: a confirmed lesson stays confirmed, a done one stays done", async () => {
      for (const status of [LessonStatus.CONFIRMED, LessonStatus.DONE]) {
        state.lesson = buildLesson({ status });

        const result = await service.reschedule(LESSON_ID, body, ACTOR_ID);

        expect(result.status).toBe(status);
      }
    });

    it("does not change the class, the plan or the title", async () => {
      state.lesson = buildLesson({
        lessonPlanId: PLAN_ID,
        sequenceOrder: 3,
        title: "Título da aula",
      });

      const result = await service.reschedule(LESSON_ID, body, ACTOR_ID);

      expect(result.sequenceOrder).toBe(3);
      expect(result.title).toBe("Título da aula");
      expect(result.class.id).toBe(CLASS_ID);
      expect(result.lessonPlan?.id).toBe(PLAN_ID);
    });

    it("takes updatedAt from the clock", async () => {
      clock.now.mockReturnValue(NOW);

      const result = await service.reschedule(LESSON_ID, body, ACTOR_ID);

      expect(savedLessons()[0].updatedAt).toEqual(NOW);
      expect(result.updatedAt).toEqual(NOW);
    });

    it("locks the lesson FOR UPDATE first and the class FOR SHARE after it", async () => {
      await service.reschedule(LESSON_ID, body, ACTOR_ID);

      expect(manager.findOne).toHaveBeenCalledWith(Lesson, {
        where: { id: LESSON_ID },
        lock: { mode: "pessimistic_write" },
      });
      expect(classes.getClassSummary).toHaveBeenCalledWith(CLASS_ID, manager, { forShare: true });
      expect(order.slice(0, 3)).toEqual(["load-lesson", "get-class", "save-lesson"]);
    });

    it("emits LESSON_RESCHEDULED once, after the commit, with the schedule before and after and no reason or note", async () => {
      state.lesson = buildLesson({ location: "Sala 1" });

      await service.reschedule(
        LESSON_ID,
        {
          date: "2026-03-17",
          startTime: "09:00",
          endTime: "10:30",
          location: "Sala 2",
          reason: "Laboratório em manutenção.",
          note: "A aluna não pode vir.",
        },
        ACTOR_ID,
      );

      expect(order.slice(-2)).toEqual(["commit", "emit-audit"]);
      const events = auditEvents();
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe(AuditableAction.LESSON_RESCHEDULED);
      expect(events[0].actorId).toBe(ACTOR_ID);
      expect(events[0].targetType).toBe("lesson");
      expect(events[0].targetId).toBe(LESSON_ID);
      expect(events[0].before).toEqual({
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        location: "Sala 1",
        originalDate: null,
      });
      expect(events[0].after).toEqual({
        date: "2026-03-17",
        startTime: "09:00",
        endTime: "10:30",
        location: "Sala 2",
        originalDate: "2026-03-10",
      });
      expect(events[0].occurredAt).toEqual(NOW);
      expect(JSON.stringify(events[0])).not.toContain("manutenção");
      expect(JSON.stringify(events[0])).not.toContain("não pode vir");
      // A reschedule is not a cancellation: nothing goes to the hours.
      expect(cancelledEvents()).toHaveLength(0);
    });

    it("keeps the first original date in the event of a second reschedule", async () => {
      state.lesson = buildLesson({ date: "2026-03-17", originalDate: "2026-03-10" });

      await service.reschedule(
        LESSON_ID,
        { date: "2026-03-24", startTime: "14:00", endTime: "15:30" },
        ACTOR_ID,
      );

      const [event] = auditEvents();
      expect((event.before as Record<string, unknown>).originalDate).toBe("2026-03-10");
      expect(event.after.originalDate).toBe("2026-03-10");
    });

    it("emits the id of the database when the path has it in upper case", async () => {
      await service.reschedule(LESSON_ID.toUpperCase(), body, ACTOR_ID);

      expect(auditEvents()[0].targetId).toBe(LESSON_ID);
    });

    it("does not emit when the save fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.reschedule(LESSON_ID, body, ACTOR_ID)).rejects.toThrow(
        "connection lost",
      );

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("maps 23514 ck_lessons_time_range to INVALID_TIME_RANGE", async () => {
      manager.save.mockRejectedValueOnce(violation("23514", "ck_lessons_time_range"));

      const failure = await httpFailure(service.reschedule(LESSON_ID, body, ACTOR_ID));

      expect(failure.getStatus()).toBe(400);
      expect(codeOf(failure)).toBe("INVALID_TIME_RANGE");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("create(), update(), cancel() and reschedule() on an archived class", () => {
    it("create, update, cancel and reschedule throw CLASS_ARCHIVED for an archived class", async () => {
      state.schoolClass = buildClass({ archivedAt: ARCHIVED_AT });
      state.lesson = buildLesson({ status: LessonStatus.PLANNED });

      const attempts = [
        service.create(
          {
            classId: CLASS_ID,
            title: "Teclado",
            date: "2026-03-10",
            startTime: "14:00",
            endTime: "15:30",
          },
          ACTOR_ID,
        ),
        service.update(LESSON_ID, { title: "Novo" }, ACTOR_ID),
        service.cancel(LESSON_ID, { reason: "Feriado." }, ACTOR_ID),
        service.reschedule(
          LESSON_ID,
          { date: "2026-03-17", startTime: "14:00", endTime: "15:30" },
          ACTOR_ID,
        ),
      ];

      for (const attempt of attempts) {
        const failure = await httpFailure(attempt);

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "CLASS_ARCHIVED",
          message: "Archived classes are read-only.",
        });
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
