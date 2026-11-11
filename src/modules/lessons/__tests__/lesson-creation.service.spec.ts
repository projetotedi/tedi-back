import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { EntityManager } from "typeorm";
import { ClassSummary } from "@modules/classes/services/classes.service";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";
import { LessonCreationService, LessonDraft } from "../services/lesson-creation.service";

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const EDITION_ID = "01999a3e-7c1b-7000-8000-0000000000e1";
const PLAN_ID = "01999a3e-7c1b-7000-8000-000000000011";
const CREATED_AT = new Date("2026-03-01T12:00:00.000Z");

function buildClass(overrides: Partial<ClassSummary> = {}): ClassSummary {
  return {
    id: CLASS_ID,
    code: "INFO-A",
    name: null,
    courseId: COURSE_ID,
    edition: { id: EDITION_ID, name: "2026.1" },
    startDate: "2026-03-03",
    endDate: "2026-06-27",
    // The enum belongs to the classes module: the test takes the type from the contract.
    status: "planned" as ClassSummary["status"],
    archivedAt: null,
    ...overrides,
  };
}

function buildDraft(overrides: Partial<LessonDraft> = {}): LessonDraft {
  return {
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

describe("LessonCreationService", () => {
  let service: LessonCreationService;

  const manager = { create: jest.fn(), save: jest.fn() };
  const asManager = manager as unknown as EntityManager;

  beforeEach(async () => {
    jest.resetAllMocks();

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
    manager.save.mockImplementation(async (entities: unknown) => entities);

    const moduleRef = await Test.createTestingModule({
      providers: [LessonCreationService],
    }).compile();

    service = moduleRef.get(LessonCreationService);
  });

  it("creates one planned lesson of the class, made by the actor, with everything the draft says", async () => {
    const draft = buildDraft({
      lessonPlanId: PLAN_ID,
      sequenceOrder: 2,
      objective: "Familiarizar o aluno com o teclado.",
      location: "Laboratório 3, bloco B",
      expectedStudents: 15,
      expectedMonitors: 2,
      subject: "Primeiro contato",
    });

    const lessons = await service.createMany(asManager, buildClass(), [draft], ACTOR_ID);

    expect(manager.create).toHaveBeenCalledTimes(1);
    expect(manager.create).toHaveBeenCalledWith(Lesson, {
      ...draft,
      classId: CLASS_ID,
      status: LessonStatus.PLANNED,
      createdById: ACTOR_ID,
    });
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toBeInstanceOf(Lesson);
    expect(lessons[0]).toMatchObject({
      classId: CLASS_ID,
      lessonPlanId: PLAN_ID,
      sequenceOrder: 2,
      title: "Teclado, mouse e janelas",
      status: LessonStatus.PLANNED,
      createdById: ACTOR_ID,
    });
  });

  it("creates one lesson per draft, in order, in a single save", async () => {
    const drafts = [
      buildDraft({ title: "Primeira", date: "2026-03-10" }),
      buildDraft({ title: "Segunda", date: "2026-03-17" }),
      buildDraft({ title: "Terceira", date: "2026-03-24" }),
    ];

    const lessons = await service.createMany(asManager, buildClass(), drafts, ACTOR_ID);

    expect(lessons.map((lesson) => lesson.title)).toEqual(["Primeira", "Segunda", "Terceira"]);
    expect(lessons.map((lesson) => lesson.date)).toEqual([
      "2026-03-10",
      "2026-03-17",
      "2026-03-24",
    ]);
    expect(lessons.every((lesson) => lesson.classId === CLASS_ID)).toBe(true);
    expect(lessons.every((lesson) => lesson.status === LessonStatus.PLANNED)).toBe(true);
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(manager.save.mock.calls[0][0]).toHaveLength(3);
  });

  it("writes nothing for an empty list", async () => {
    await expect(service.createMany(asManager, buildClass(), [], ACTOR_ID)).resolves.toEqual([]);

    expect(manager.create).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("createMany rejects the whole batch when one draft is outside the period", async () => {
    const drafts = [
      buildDraft({ date: "2026-03-10" }),
      buildDraft({ date: "2026-06-28" }),
      buildDraft({ date: "2026-03-17" }),
    ];

    const failure = await httpFailure(
      service.createMany(asManager, buildClass(), drafts, ACTOR_ID),
    );

    expect(failure.getStatus()).toBe(400);
    expect(failure.getResponse()).toMatchObject({
      error: "LESSON_OUTSIDE_CLASS_PERIOD",
      details: [expect.objectContaining({ field: "date" })],
    });
    // The good drafts around the bad one are not written either.
    expect(manager.create).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("rejects the day before the start and the day after the end, and takes both ends", async () => {
    for (const date of ["2026-03-02", "2026-06-28"]) {
      const failure = await httpFailure(
        service.createMany(asManager, buildClass(), [buildDraft({ date })], ACTOR_ID),
      );
      expect((failure.getResponse() as { error: string }).error).toBe(
        "LESSON_OUTSIDE_CLASS_PERIOD",
      );
    }

    const lessons = await service.createMany(
      asManager,
      buildClass(),
      [buildDraft({ date: "2026-03-03" }), buildDraft({ date: "2026-06-27" })],
      ACTOR_ID,
    );
    expect(lessons.map((lesson) => lesson.date)).toEqual(["2026-03-03", "2026-06-27"]);
  });

  it("rejects the whole batch when one draft ends at or before its start with INVALID_TIME_RANGE", async () => {
    for (const [startTime, endTime] of [
      ["14:00", "14:00"],
      ["15:30", "14:00"],
    ]) {
      const failure = await httpFailure(
        service.createMany(
          asManager,
          buildClass(),
          [buildDraft(), buildDraft({ startTime, endTime })],
          ACTOR_ID,
        ),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({
        error: "INVALID_TIME_RANGE",
        details: [expect.objectContaining({ field: "endTime" })],
      });
    }
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("throws 409 CLASS_ARCHIVED for an archived class, before it looks at the drafts", async () => {
    const archived = buildClass({ archivedAt: new Date("2026-04-01T00:00:00.000Z") });

    // The draft is outside the period too: the archived class is what is answered.
    const failure = await httpFailure(
      service.createMany(asManager, archived, [buildDraft({ date: "2030-01-01" })], ACTOR_ID),
    );

    expect(failure.getStatus()).toBe(409);
    expect((failure.getResponse() as { error: string }).error).toBe("CLASS_ARCHIVED");
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("throws CLASS_ARCHIVED even for an empty list: the class is what does not take writes", async () => {
    const archived = buildClass({ archivedAt: new Date("2026-04-01T00:00:00.000Z") });

    const failure = await httpFailure(service.createMany(asManager, archived, [], ACTOR_ID));

    expect((failure.getResponse() as { error: string }).error).toBe("CLASS_ARCHIVED");
  });

  it("takes the period from the class it is given, not from a fixed one", async () => {
    const autumn = buildClass({ startDate: "2026-09-30", endDate: "2026-10-01" });

    await expect(
      service.createMany(asManager, autumn, [buildDraft({ date: "2026-10-01" })], ACTOR_ID),
    ).resolves.toHaveLength(1);
    await expect(
      service.createMany(asManager, autumn, [buildDraft({ date: "2026-10-02" })], ACTOR_ID),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("does not open a transaction, lock or emit: the caller owns all of it", async () => {
    // The manager it is given only has `create` and `save`: anything else would throw.
    await expect(
      service.createMany(asManager, buildClass(), [buildDraft()], ACTOR_ID),
    ).resolves.toHaveLength(1);
    expect(Object.keys(manager).sort()).toEqual(["create", "save"]);
  });
});
