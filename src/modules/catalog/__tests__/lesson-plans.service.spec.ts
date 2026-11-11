import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, EntityManager } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { LessonPlanContent } from "../entities/lesson-plan-content.entity";
import { LessonPlan } from "../entities/lesson-plan.entity";
import { LessonPlansService } from "../services/lesson-plans.service";

const NOW = new Date("2026-10-02T01:30:00.000Z");
const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const OTHER_ACTOR_ID = "01999a3e-0000-7000-8000-0000000000bb";
const PLAN_ID = "01999a3e-7c1b-7000-8000-000000000001";
const COPY_ID = "01999a3e-7c1b-7000-8000-000000000002";

function buildPlan(
  overrides: Partial<Omit<LessonPlan, "archive">> & { archive?: Partial<ArchivableColumns> } = {},
): LessonPlan {
  const { archive, ...rest } = overrides;
  return Object.assign(new LessonPlan(), {
    id: PLAN_ID,
    title: "Teclado, mouse e janelas",
    objective: "Familiarizar o aluno com o teclado.",
    expectedDurationMinutes: 90,
    materialUrl: "https://drive.google.com/file/d/exemplo/view",
    createdById: ACTOR_ID,
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

function buildContents(texts: readonly string[]): LessonPlanContent[] {
  return texts.map((text, position) =>
    Object.assign(new LessonPlanContent(), {
      id: `content-${position}`,
      lessonPlanId: PLAN_ID,
      position,
      text,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      deletedAt: null,
    }),
  );
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

describe("LessonPlansService", () => {
  let service: LessonPlansService;
  let order: string[];
  let state: { plan: LessonPlan | null; contents: LessonPlanContent[] };

  const manager = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    delete: jest.fn(),
  };
  const planRepository = { findOne: jest.fn() };
  const contentRepository = { find: jest.fn() };
  // `manager` is what a read that opens no transaction goes through (getLessonPlanSummary).
  const dataSource = {
    transaction: jest.fn(),
    getRepository: jest.fn(),
    manager: { findOne: jest.fn() },
  };
  const eventEmitter = { emit: jest.fn() };

  function emittedEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls.map((call) => call[1] as AuditableActionEvent);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    order = [];
    state = {
      plan: buildPlan(),
      contents: buildContents(["Teclado e mouse", "Janelas do sistema"]),
    };

    manager.create.mockImplementation((target: unknown, data: Record<string, unknown>) => {
      if (target === LessonPlan) {
        return Object.assign(new LessonPlan(), {
          id: PLAN_ID,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
          deletedAt: null,
          ...data,
        });
      }
      return Object.assign(new LessonPlanContent(), {
        id: `new-content-${String(data.position)}`,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        deletedAt: null,
        ...data,
      });
    });
    manager.save.mockImplementation(async (entity: unknown) => {
      order.push(Array.isArray(entity) ? "insert-contents" : "save-plan");
      return entity;
    });
    manager.findOne.mockImplementation(async (target: unknown) =>
      target === LessonPlan ? state.plan : null,
    );
    manager.find.mockImplementation(async (target: unknown) =>
      target === LessonPlanContent ? state.contents : [],
    );
    manager.delete.mockImplementation(async () => {
      order.push("delete-contents");
      return { affected: state.contents.length };
    });
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => Promise<unknown>) => {
        const result = await callback(manager);
        order.push("commit");
        return result;
      },
    );
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === LessonPlan ? planRepository : contentRepository,
    );
    contentRepository.find.mockResolvedValue(state.contents);
    planRepository.findOne.mockResolvedValue(state.plan);
    eventEmitter.emit.mockImplementation(() => {
      order.push("emit");
      return true;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LessonPlansService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: { now: () => NOW } },
      ],
    }).compile();

    service = moduleRef.get(LessonPlansService);
  });

  describe("create()", () => {
    const dto = {
      title: "Teclado, mouse e janelas",
      objective: "Familiarizar o aluno com o teclado.",
      expectedDurationMinutes: 90,
      materialUrl: "https://drive.google.com/file/d/exemplo/view",
      contents: ["Teclado e mouse", "Janelas do sistema"],
    };

    it("creates the plan and its contents in one transaction with createdById = actor", async () => {
      const result = await service.create(dto, ACTOR_ID);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenNthCalledWith(1, LessonPlan, {
        title: "Teclado, mouse e janelas",
        objective: "Familiarizar o aluno com o teclado.",
        expectedDurationMinutes: 90,
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        createdById: ACTOR_ID,
      });
      expect(manager.create).toHaveBeenNthCalledWith(2, LessonPlanContent, {
        lessonPlanId: PLAN_ID,
        position: 0,
        text: "Teclado e mouse",
      });
      expect(manager.create).toHaveBeenNthCalledWith(3, LessonPlanContent, {
        lessonPlanId: PLAN_ID,
        position: 1,
        text: "Janelas do sistema",
      });
      expect(order).toEqual(["save-plan", "insert-contents", "commit", "emit"]);

      expect(result).toEqual({
        id: PLAN_ID,
        title: "Teclado, mouse e janelas",
        objective: "Familiarizar o aluno com o teclado.",
        expectedDurationMinutes: 90,
        contents: ["Teclado e mouse", "Janelas do sistema"],
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: ACTOR_ID,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      });
    });

    it("stores objective and materialUrl as null when they are not informed", async () => {
      const result = await service.create(
        { title: "Janelas", expectedDurationMinutes: 45, contents: ["Janelas do sistema"] },
        ACTOR_ID,
      );

      expect(manager.create).toHaveBeenNthCalledWith(
        1,
        LessonPlan,
        expect.objectContaining({ objective: null, materialUrl: null }),
      );
      expect(result.objective).toBeNull();
      expect(result.materialUrl).toBeNull();
    });

    it("keeps the contents in the order received", async () => {
      const result = await service.create(
        { ...dto, contents: ["Pastas", "Janelas", "Teclado"] },
        ACTOR_ID,
      );

      expect(result.contents).toEqual(["Pastas", "Janelas", "Teclado"]);
      expect(
        manager.create.mock.calls
          .filter((call) => call[0] === LessonPlanContent)
          .map((call) => [call[1].position, call[1].text]),
      ).toEqual([
        [0, "Pastas"],
        [1, "Janelas"],
        [2, "Teclado"],
      ]);
    });

    it("emits LESSON_PLAN_CREATED after the commit with the plan and its contents", async () => {
      await service.create(dto, ACTOR_ID);

      expect(order).toEqual(["save-plan", "insert-contents", "commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(AUDITABLE_ACTION_EVENT, expect.anything());

      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.LESSON_PLAN_CREATED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("lesson_plan");
      expect(event.targetId).toBe(PLAN_ID);
      expect(event.before).toBeNull();
      expect(event.after).toEqual({
        title: "Teclado, mouse e janelas",
        objective: "Familiarizar o aluno com o teclado.",
        expectedDurationMinutes: 90,
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        contents: ["Teclado e mouse", "Janelas do sistema"],
      });
      expect(event.occurredAt).toEqual(NOW);
    });

    it("does not emit when the transaction fails", async () => {
      dataSource.transaction.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.create(dto, ACTOR_ID)).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("findById()", () => {
    it("returns the plan with its contents ordered by position", async () => {
      planRepository.findOne.mockResolvedValue(buildPlan());
      contentRepository.find.mockResolvedValue(
        buildContents(["Teclado e mouse", "Janelas do sistema", "Pastas"]).reverse(),
      );

      const result = await service.findById(PLAN_ID);

      expect(result.id).toBe(PLAN_ID);
      expect(result.contents).toEqual(["Teclado e mouse", "Janelas do sistema", "Pastas"]);
      expect(planRepository.findOne).toHaveBeenCalledWith({ where: { id: PLAN_ID } });
      expect(contentRepository.find).toHaveBeenCalledWith({
        where: { lessonPlanId: PLAN_ID },
        order: { position: "ASC" },
      });
    });

    it("keeps an archived plan readable", async () => {
      planRepository.findOne.mockResolvedValue(
        buildPlan({
          archive: { archivedAt: NOW, archivedById: ACTOR_ID, archiveReason: "Conteúdo revisado." },
        }),
      );

      const result = await service.findById(PLAN_ID);

      expect(result.archivedAt).toEqual(NOW);
      expect(result.archivedById).toBe(ACTOR_ID);
      expect(result.archiveReason).toBe("Conteúdo revisado.");
    });

    it("throws 404 LESSON_PLAN_NOT_FOUND without loading the contents", async () => {
      planRepository.findOne.mockResolvedValue(null);

      const failure = await httpFailure(service.findById(PLAN_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "LESSON_PLAN_NOT_FOUND",
        message: "Lesson plan not found.",
      });
      expect(contentRepository.find).not.toHaveBeenCalled();
    });

    it("reads without a transaction, a lock or an audit event", async () => {
      await service.findById(PLAN_ID);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(planRepository.findOne.mock.calls[0][0]).not.toHaveProperty("lock");
    });
  });

  describe("update()", () => {
    it("returns 404 LESSON_PLAN_NOT_FOUND when the plan does not exist", async () => {
      state.plan = null;

      const failure = await httpFailure(service.update(PLAN_ID, { title: "Outro" }, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "LESSON_PLAN_NOT_FOUND",
        message: "Lesson plan not found.",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("locks the plan row for the whole edit", async () => {
      await service.update(PLAN_ID, {}, ACTOR_ID);

      expect(manager.findOne).toHaveBeenCalledWith(LessonPlan, {
        where: { id: PLAN_ID },
        lock: { mode: "pessimistic_write" },
      });
    });

    it("returns 409 LESSON_PLAN_ARCHIVED when the plan is archived", async () => {
      state.plan = buildPlan({ archive: { archivedAt: CREATED_AT, archivedById: ACTOR_ID } });

      const failure = await httpFailure(
        service.update(PLAN_ID, { expectedDurationMinutes: 120, contents: ["Novo"] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "LESSON_PLAN_ARCHIVED",
        message: "Archived lesson plans are read-only.",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("changes the duration from 90 to 120 and leaves everything else alone", async () => {
      const result = await service.update(PLAN_ID, { expectedDurationMinutes: 120 }, ACTOR_ID);

      expect(result.expectedDurationMinutes).toBe(120);
      expect(result.title).toBe("Teclado, mouse e janelas");
      expect(result.objective).toBe("Familiarizar o aluno com o teclado.");
      expect(result.materialUrl).toBe("https://drive.google.com/file/d/exemplo/view");
      expect(result.contents).toEqual(["Teclado e mouse", "Janelas do sistema"]);
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.save).toHaveBeenCalledWith(expect.any(LessonPlan));
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it("clears objective and materialUrl sent as null", async () => {
      const result = await service.update(
        PLAN_ID,
        { objective: null, materialUrl: null },
        ACTOR_ID,
      );

      expect(result.objective).toBeNull();
      expect(result.materialUrl).toBeNull();
      expect(result.title).toBe("Teclado, mouse e janelas");
    });

    it("replaces the whole list of contents, in order, inside the transaction", async () => {
      const result = await service.update(
        PLAN_ID,
        { contents: ["Pastas", "Teclado e mouse", "Janelas do sistema"] },
        ACTOR_ID,
      );

      expect(order).toEqual(["delete-contents", "insert-contents", "save-plan", "commit", "emit"]);
      expect(manager.delete).toHaveBeenCalledWith(LessonPlanContent, { lessonPlanId: PLAN_ID });
      expect(
        manager.create.mock.calls
          .filter((call) => call[0] === LessonPlanContent)
          .map((call) => [call[1].lessonPlanId, call[1].position, call[1].text]),
      ).toEqual([
        [PLAN_ID, 0, "Pastas"],
        [PLAN_ID, 1, "Teclado e mouse"],
        [PLAN_ID, 2, "Janelas do sistema"],
      ]);
      expect(result.contents).toEqual(["Pastas", "Teclado e mouse", "Janelas do sistema"]);
    });

    it("reorders the contents when the same texts come in another order", async () => {
      const result = await service.update(
        PLAN_ID,
        { contents: ["Janelas do sistema", "Teclado e mouse"] },
        ACTOR_ID,
      );

      expect(manager.delete).toHaveBeenCalledTimes(1);
      expect(result.contents).toEqual(["Janelas do sistema", "Teclado e mouse"]);
    });

    it("touches updatedAt with the clock when only the contents change", async () => {
      const result = await service.update(PLAN_ID, { contents: ["Pastas"] }, ACTOR_ID);

      expect(manager.save).toHaveBeenCalledWith(expect.any(LessonPlan));
      expect(result.updatedAt).toEqual(NOW);
      expect(result.createdAt).toEqual(CREATED_AT);
    });

    it("emits LESSON_PLAN_UPDATED after the commit with only the changed fields", async () => {
      await service.update(
        PLAN_ID,
        {
          title: "Janelas e pastas",
          expectedDurationMinutes: 120,
          materialUrl: null,
          contents: ["Pastas"],
          objective: "Familiarizar o aluno com o teclado.",
        },
        ACTOR_ID,
      );

      expect(order[order.length - 2]).toBe("commit");
      expect(order[order.length - 1]).toBe("emit");
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);

      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.LESSON_PLAN_UPDATED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("lesson_plan");
      expect(event.targetId).toBe(PLAN_ID);
      expect(event.before).toEqual({
        title: "Teclado, mouse e janelas",
        expectedDurationMinutes: 90,
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        contents: ["Teclado e mouse", "Janelas do sistema"],
      });
      expect(event.after).toEqual({
        title: "Janelas e pastas",
        expectedDurationMinutes: 120,
        materialUrl: null,
        contents: ["Pastas"],
        changedFields: ["title", "expectedDurationMinutes", "materialUrl", "contents"],
      });
    });

    it("is a no-op without event when nothing changed", async () => {
      const unchanged = await service.update(
        PLAN_ID,
        {
          title: "Teclado, mouse e janelas",
          expectedDurationMinutes: 90,
          objective: "Familiarizar o aluno com o teclado.",
          materialUrl: "https://drive.google.com/file/d/exemplo/view",
          contents: ["Teclado e mouse", "Janelas do sistema"],
        },
        ACTOR_ID,
      );
      const empty = await service.update(PLAN_ID, {}, ACTOR_ID);

      expect(unchanged.id).toBe(PLAN_ID);
      expect(unchanged.updatedAt).toEqual(CREATED_AT);
      expect(empty.id).toBe(PLAN_ID);
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not emit when the transaction fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(
        service.update(PLAN_ID, { expectedDurationMinutes: 120 }, ACTOR_ID),
      ).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("archive()", () => {
    it("archives with actor, date and reason and emits LESSON_PLAN_ARCHIVED", async () => {
      const result = await service.archive(PLAN_ID, { reason: "Conteúdo revisado." }, ACTOR_ID);

      expect(result.archivedAt).toEqual(NOW);
      expect(result.archivedById).toBe(ACTOR_ID);
      expect(result.archiveReason).toBe("Conteúdo revisado.");
      expect(result.contents).toEqual(["Teclado e mouse", "Janelas do sistema"]);
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.delete).not.toHaveBeenCalled();

      expect(order).toEqual(["save-plan", "commit", "emit"]);
      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.LESSON_PLAN_ARCHIVED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("lesson_plan");
      expect(event.targetId).toBe(PLAN_ID);
      expect(event.before).toEqual({ archivedAt: null });
      expect(event.after).toEqual({ archivedAt: NOW, archiveReason: "Conteúdo revisado." });
    });

    it("archives without a body and records a null reason", async () => {
      const result = await service.archive(PLAN_ID, undefined, ACTOR_ID);

      expect(result.archivedAt).toEqual(NOW);
      expect(result.archiveReason).toBeNull();
    });

    it("keeps the first archive and emits nothing when already archived", async () => {
      const firstDate = new Date("2026-09-15T10:00:00.000Z");
      state.plan = buildPlan({
        archive: { archivedAt: firstDate, archivedById: "first-actor", archiveReason: "first" },
      });

      const result = await service.archive(PLAN_ID, { reason: "second" }, ACTOR_ID);

      expect(result.archivedAt).toEqual(firstDate);
      expect(result.archivedById).toBe("first-actor");
      expect(result.archiveReason).toBe("first");
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("returns 404 LESSON_PLAN_NOT_FOUND for an unknown plan", async () => {
      state.plan = null;

      const failure = await httpFailure(service.archive(PLAN_ID, {}, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "LESSON_PLAN_NOT_FOUND",
        message: "Lesson plan not found.",
      });
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("unarchive()", () => {
    it("clears the archive columns and emits LESSON_PLAN_UNARCHIVED", async () => {
      const archivedAt = new Date("2026-09-15T10:00:00.000Z");
      state.plan = buildPlan({
        archive: { archivedAt, archivedById: ACTOR_ID, archiveReason: "Conteúdo revisado." },
      });

      const result = await service.unarchive(PLAN_ID, ACTOR_ID);

      expect(result.archivedAt).toBeNull();
      expect(result.archivedById).toBeNull();
      expect(result.archiveReason).toBeNull();
      expect(result.contents).toEqual(["Teclado e mouse", "Janelas do sistema"]);
      expect(manager.save).toHaveBeenCalledTimes(1);

      expect(order).toEqual(["save-plan", "commit", "emit"]);
      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.LESSON_PLAN_UNARCHIVED);
      expect(event.targetType).toBe("lesson_plan");
      expect(event.targetId).toBe(PLAN_ID);
      expect(event.before).toEqual({
        archivedAt,
        archivedById: ACTOR_ID,
        archiveReason: "Conteúdo revisado.",
      });
      expect(event.after).toEqual({ archivedAt: null });
    });

    it("is a no-op without event when the plan is not archived", async () => {
      const result = await service.unarchive(PLAN_ID, ACTOR_ID);

      expect(result.archivedAt).toBeNull();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("returns 404 LESSON_PLAN_NOT_FOUND for an unknown plan", async () => {
      state.plan = null;

      const failure = await httpFailure(service.unarchive(PLAN_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "LESSON_PLAN_NOT_FOUND",
        message: "Lesson plan not found.",
      });
    });
  });

  describe("duplicate()", () => {
    beforeEach(() => {
      // The outer mock gives PLAN_ID to any LessonPlan it creates. Here the copy gets its own id, or
      // a test on the id of the copy (the target of the event, the parent of the contents) proves nothing.
      const createDefault = manager.create.getMockImplementation();
      manager.create.mockImplementation((target: unknown, data: Record<string, unknown>) => {
        const entity = createDefault?.(target, data);
        return target === LessonPlan ? Object.assign(entity, { id: COPY_ID }) : entity;
      });
    });

    it("copies title with ' (cópia)', objective, duration, material and contents in order, with createdById = actor", async () => {
      const result = await service.duplicate(PLAN_ID, OTHER_ACTOR_ID);

      expect(manager.create).toHaveBeenCalledTimes(3);
      expect(manager.create).toHaveBeenNthCalledWith(1, LessonPlan, {
        title: "Teclado, mouse e janelas (cópia)",
        objective: "Familiarizar o aluno com o teclado.",
        expectedDurationMinutes: 90,
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        createdById: OTHER_ACTOR_ID,
      });
      expect(manager.create).toHaveBeenNthCalledWith(2, LessonPlanContent, {
        lessonPlanId: COPY_ID,
        position: 0,
        text: "Teclado e mouse",
      });
      expect(manager.create).toHaveBeenNthCalledWith(3, LessonPlanContent, {
        lessonPlanId: COPY_ID,
        position: 1,
        text: "Janelas do sistema",
      });

      // The source was created by ACTOR_ID: the copy belongs to whoever duplicated it.
      expect(result).toEqual({
        id: COPY_ID,
        title: "Teclado, mouse e janelas (cópia)",
        objective: "Familiarizar o aluno com o teclado.",
        expectedDurationMinutes: 90,
        contents: ["Teclado e mouse", "Janelas do sistema"],
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: OTHER_ACTOR_ID,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      });
    });

    it("loads the source with pessimistic_read and its contents ordered by position", async () => {
      await service.duplicate(PLAN_ID, ACTOR_ID);

      expect(manager.findOne).toHaveBeenCalledTimes(1);
      expect(manager.findOne).toHaveBeenCalledWith(LessonPlan, {
        where: { id: PLAN_ID },
        lock: { mode: "pessimistic_read" },
      });
      expect(manager.find).toHaveBeenCalledTimes(1);
      expect(manager.find).toHaveBeenCalledWith(LessonPlanContent, {
        where: { lessonPlanId: PLAN_ID },
        order: { position: "ASC" },
      });
    });

    it("creates an active copy of an archived source", async () => {
      state.plan = buildPlan({
        archive: {
          archivedAt: CREATED_AT,
          archivedById: ACTOR_ID,
          archiveReason: "Conteúdo revisado.",
        },
      });

      const result = await service.duplicate(PLAN_ID, ACTOR_ID);

      expect(manager.create.mock.calls[0][1]).not.toHaveProperty("archive");
      expect(result.id).toBe(COPY_ID);
      expect(result.archivedAt).toBeNull();
      expect(result.archivedById).toBeNull();
      expect(result.archiveReason).toBeNull();
      expect(result.contents).toEqual(["Teclado e mouse", "Janelas do sistema"]);
    });

    it("never saves or changes the source", async () => {
      await service.duplicate(PLAN_ID, OTHER_ACTOR_ID);

      const saved = manager.save.mock.calls.map((call) => call[0]);
      expect(saved).toHaveLength(2);
      expect(saved).not.toContain(state.plan);
      expect(saved[0]).toBeInstanceOf(LessonPlan);
      expect(saved[0]).toHaveProperty("id", COPY_ID);
      expect(manager.delete).not.toHaveBeenCalled();
      expect(state.plan).toEqual(buildPlan());
      expect(state.contents).toEqual(buildContents(["Teclado e mouse", "Janelas do sistema"]));
    });

    it("does everything in one transaction and emits after the commit", async () => {
      await service.duplicate(PLAN_ID, ACTOR_ID);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["save-plan", "insert-contents", "commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(AUDITABLE_ACTION_EVENT, expect.anything());
    });

    it("emits LESSON_PLAN_DUPLICATED with the copy as target and sourceLessonPlanId from the database", async () => {
      // The id of the URL may be in upper case: the source and the event carry the id stored in the database.
      await service.duplicate(PLAN_ID.toUpperCase(), OTHER_ACTOR_ID);

      expect(manager.findOne).toHaveBeenCalledWith(LessonPlan, {
        where: { id: PLAN_ID.toUpperCase() },
        lock: { mode: "pessimistic_read" },
      });
      expect(manager.find).toHaveBeenCalledWith(LessonPlanContent, {
        where: { lessonPlanId: PLAN_ID },
        order: { position: "ASC" },
      });

      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.LESSON_PLAN_DUPLICATED);
      expect(event.actorId).toBe(OTHER_ACTOR_ID);
      expect(event.targetType).toBe("lesson_plan");
      expect(event.targetId).toBe(COPY_ID);
      expect(event.before).toBeNull();
      expect(event.after).toEqual({
        sourceLessonPlanId: PLAN_ID,
        title: "Teclado, mouse e janelas (cópia)",
        objective: "Familiarizar o aluno com o teclado.",
        expectedDurationMinutes: 90,
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        contents: ["Teclado e mouse", "Janelas do sistema"],
      });
      expect(event.occurredAt).toEqual(NOW);
    });

    it("throws 404 LESSON_PLAN_NOT_FOUND and emits nothing when the source does not exist", async () => {
      state.plan = null;

      const failure = await httpFailure(service.duplicate(PLAN_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "LESSON_PLAN_NOT_FOUND",
        message: "Lesson plan not found.",
      });
      expect(manager.find).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not emit when the transaction fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.duplicate(PLAN_ID, ACTOR_ID)).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("getLessonPlanSummary()", () => {
    const asManager = manager as unknown as EntityManager;

    it("returns null for a malformed id without querying", async () => {
      for (const malformed of ["not-a-uuid", "", "123", `${PLAN_ID}x`]) {
        await expect(service.getLessonPlanSummary(malformed, asManager)).resolves.toBeNull();
        await expect(service.getLessonPlanSummary(malformed)).resolves.toBeNull();
      }

      // A malformed id never reaches the database.
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(dataSource.manager.findOne).not.toHaveBeenCalled();
    });

    it("returns null when the lesson plan does not exist", async () => {
      state.plan = null;

      await expect(service.getLessonPlanSummary(PLAN_ID, asManager)).resolves.toBeNull();

      expect(manager.findOne).toHaveBeenCalledTimes(1);
    });

    it("returns id, title, objective, expected duration and archivedAt, and only those fields", async () => {
      const summary = await service.getLessonPlanSummary(PLAN_ID, asManager);

      expect(summary).toEqual({
        id: PLAN_ID,
        title: "Teclado, mouse e janelas",
        objective: "Familiarizar o aluno com o teclado.",
        expectedDurationMinutes: 90,
        archivedAt: null,
      });
      expect(Object.keys(summary ?? {}).sort()).toEqual([
        "archivedAt",
        "expectedDurationMinutes",
        "id",
        "objective",
        "title",
      ]);
    });

    it("answers null in objective for a plan without one", async () => {
      state.plan = buildPlan({ objective: null });

      const summary = await service.getLessonPlanSummary(PLAN_ID, asManager);

      expect(summary?.objective).toBeNull();
    });

    it("returns an archived plan with archivedAt", async () => {
      state.plan = buildPlan({
        archive: { archivedAt: NOW, archivedById: ACTOR_ID, archiveReason: "Conteúdo antigo." },
      });

      const summary = await service.getLessonPlanSummary(PLAN_ID, asManager);

      expect(summary?.archivedAt).toEqual(NOW);
      expect(summary?.title).toBe("Teclado, mouse e janelas");
    });

    it("answers null in archivedAt when the entity carries no archive columns", async () => {
      state.plan = Object.assign(buildPlan(), { archive: undefined }) as unknown as LessonPlan;

      const summary = await service.getLessonPlanSummary(PLAN_ID, asManager);

      expect(summary?.archivedAt).toBeNull();
    });

    it("locks FOR SHARE only when forShare is set", async () => {
      await service.getLessonPlanSummary(PLAN_ID, asManager, { forShare: true });
      expect(manager.findOne).toHaveBeenLastCalledWith(LessonPlan, {
        where: { id: PLAN_ID },
        lock: { mode: "pessimistic_read" },
      });

      manager.findOne.mockClear();
      await service.getLessonPlanSummary(PLAN_ID, asManager);
      expect(manager.findOne).toHaveBeenLastCalledWith(LessonPlan, { where: { id: PLAN_ID } });

      await service.getLessonPlanSummary(PLAN_ID, asManager, { forShare: false });
      expect(manager.findOne).toHaveBeenLastCalledWith(LessonPlan, { where: { id: PLAN_ID } });
      await service.getLessonPlanSummary(PLAN_ID, asManager, {});
      expect(manager.findOne).toHaveBeenLastCalledWith(LessonPlan, { where: { id: PLAN_ID } });
    });

    it("reads through the manager it is given, inside the transaction of the caller", async () => {
      await service.getLessonPlanSummary(PLAN_ID, asManager);

      expect(manager.findOne).toHaveBeenCalledTimes(1);
      expect(dataSource.manager.findOne).not.toHaveBeenCalled();
    });

    it("reads through the manager of the data source when none is given, with no transaction, no write and no event", async () => {
      dataSource.manager.findOne.mockResolvedValue(buildPlan());

      const summary = await service.getLessonPlanSummary(PLAN_ID);

      expect(summary?.id).toBe(PLAN_ID);
      expect(dataSource.manager.findOne).toHaveBeenCalledWith(LessonPlan, {
        where: { id: PLAN_ID },
      });
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
