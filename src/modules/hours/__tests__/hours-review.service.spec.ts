import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, In } from "typeorm";
import { LessonsService } from "@modules/lessons/services/lessons.service";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { HoursReviewService } from "../services/hours-review.service";

const NOW = new Date("2026-10-02T01:30:00.000Z");
const CREATED_AT = new Date("2026-03-10T21:00:00.000Z");

const ENTRY_A = "01999a3e-7c1b-7000-8000-000000000a01";
const ENTRY_B = "01999a3e-7c1b-7000-8000-000000000a02";
const ENTRY_C = "01999a3e-7c1b-7000-8000-000000000a03";
const UNKNOWN = "01999a3e-7c1b-7000-8000-000000000a09";

const MEMBER_ID = "01999a3e-0000-7000-8000-0000000000aa";
const COORDINATOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000ee",
  role: Role.COORDINATOR,
  accessEnabled: true,
  departmentIds: [],
};
const SUPERADMIN: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000ff",
  role: Role.SUPERADMIN,
  accessEnabled: true,
  departmentIds: [],
};

const JUSTIFICATION = "A reunião durou duas horas, conforme a ata.";
const REASON = "Atividade fora do projeto.";

function entryOf(id: string, overrides: Partial<HourEntry> = {}): HourEntry {
  return Object.assign(new HourEntry(), {
    id,
    personId: MEMBER_ID,
    createdById: MEMBER_ID,
    origin: HourEntryOrigin.MANUAL,
    activity: "Planejamento da aula de teclado e mouse",
    category: HourEntryCategory.PLANNING,
    date: "2026-03-10",
    declaredMinutes: 240,
    validatedMinutes: null,
    notes: "Revisei os exercícios do plano 3.",
    status: HourEntryStatus.PENDING,
    classId: null,
    lessonId: null,
    reviewNote: null,
    reviewedById: null,
    reviewedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  });
}

async function httpFailure(promise: Promise<unknown>): Promise<HttpException> {
  const failure: unknown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(failure instanceof HttpException)) throw new Error("Expected an HttpException");
  return failure;
}

describe("HoursReviewService", () => {
  let service: HoursReviewService;
  let order: string[];

  /** A chainable update builder: every method returns it, and execute resolves. */
  const updateBuilder = { update: jest.fn(), set: jest.fn(), where: jest.fn(), execute: jest.fn() };
  const manager = {
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const dataSource = { transaction: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  const lessons = { findLessonSummaries: jest.fn().mockResolvedValue([]) };

  function auditEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls
      .filter((call) => call[0] === AUDITABLE_ACTION_EVENT)
      .map((call) => call[1] as AuditableActionEvent);
  }

  /** Every row of history passed to manager.save, alone or in an array. */
  function savedEvents(): HourEntryEvent[] {
    return manager.save.mock.calls
      .flatMap((call) => (Array.isArray(call[1]) ? call[1] : [call[0]]))
      .filter((value): value is HourEntryEvent => value instanceof HourEntryEvent);
  }

  function writes(): number {
    return (
      manager.update.mock.calls.length +
      manager.save.mock.calls.length +
      updateBuilder.execute.mock.calls.length
    );
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];

    for (const method of [updateBuilder.update, updateBuilder.set, updateBuilder.where]) {
      method.mockReturnValue(updateBuilder);
    }
    updateBuilder.execute.mockImplementation(async () => {
      order.push("update");
      return { affected: 1 };
    });
    manager.createQueryBuilder.mockReturnValue(updateBuilder);
    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), data),
    );
    manager.save.mockImplementation(async (...args: unknown[]) => {
      order.push("insert-events");
      return args.length === 2 ? args[1] : args[0];
    });
    manager.update.mockImplementation(async () => {
      order.push("update");
      return { affected: 1 };
    });
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => Promise<unknown>) => {
        const result = await callback(manager);
        order.push("commit");
        return result;
      },
    );
    eventEmitter.emit.mockImplementation(() => {
      order.push("emit-audit");
      return true;
    });
    clock.now.mockReturnValue(NOW);

    const moduleRef = await Test.createTestingModule({
      providers: [
        HoursReviewService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: LessonsService, useValue: lessons },
      ],
    }).compile();
    service = moduleRef.get(HoursReviewService);
  });

  describe("validateEntries", () => {
    const declared: Record<string, number> = { [ENTRY_A]: 60, [ENTRY_B]: 90, [ENTRY_C]: 150 };

    beforeEach(() => {
      manager.find.mockResolvedValue([
        entryOf(ENTRY_A, { declaredMinutes: declared[ENTRY_A] }),
        entryOf(ENTRY_B, { declaredMinutes: declared[ENTRY_B] }),
        entryOf(ENTRY_C, { declaredMinutes: declared[ENTRY_C] }),
      ]);
    });

    it("approves every entry of the batch with its declared minutes, in one transaction, and answers them in the order of the request", async () => {
      const answer = await service.validateEntries(
        { ids: [ENTRY_C, ENTRY_A, ENTRY_B] },
        COORDINATOR,
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(answer.map((entry) => entry.id)).toEqual([ENTRY_C, ENTRY_A, ENTRY_B]);
      for (const entry of answer) {
        expect(entry).toMatchObject({
          status: HourEntryStatus.APPROVED,
          declaredMinutes: declared[entry.id],
          validatedMinutes: declared[entry.id],
          reviewNote: null,
          reviewedById: COORDINATOR.id,
          reviewedAt: NOW,
          updatedAt: NOW,
          createdAt: CREATED_AT,
          notes: "Revisei os exercícios do plano 3.",
        });
        expect(entry).not.toHaveProperty("deletedAt");
      }
    });

    it("locks the entries FOR UPDATE ordered by id, by the lower-case ids of the body", async () => {
      await service.validateEntries(
        { ids: [ENTRY_C.toUpperCase(), ENTRY_A, ENTRY_B.toUpperCase()] },
        COORDINATOR,
      );

      expect(manager.find).toHaveBeenCalledTimes(1);
      expect(manager.find).toHaveBeenCalledWith(HourEntry, {
        where: { id: In([ENTRY_C, ENTRY_A, ENTRY_B]) },
        order: { id: "ASC" },
        lock: { mode: "pessimistic_write" },
      });
    });

    it("updates the batch in one statement: approved, validated = declared, reviewer, instant and no note", async () => {
      await service.validateEntries({ ids: [ENTRY_C, ENTRY_A, ENTRY_B] }, COORDINATOR);

      expect(updateBuilder.execute).toHaveBeenCalledTimes(1);
      expect(updateBuilder.update).toHaveBeenCalledWith(HourEntry);
      const values = updateBuilder.set.mock.calls[0][0] as Record<string, unknown>;
      expect(values).toEqual({
        status: HourEntryStatus.APPROVED,
        validatedMinutes: expect.any(Function),
        reviewNote: null,
        reviewedById: COORDINATOR.id,
        reviewedAt: NOW,
        updatedAt: NOW,
      });
      const validatedMinutes = values.validatedMinutes as () => string;
      expect(validatedMinutes()).toBe('"declared_minutes"');
      expect(updateBuilder.where).toHaveBeenCalledWith("id IN (:...ids)", {
        ids: [ENTRY_A, ENTRY_B, ENTRY_C],
      });
      expect(manager.update).not.toHaveBeenCalled();
    });

    it("records one approved event per entry, from pending and the declared minutes to approved and the same minutes, by the reviewer, at the same instant", async () => {
      await service.validateEntries({ ids: [ENTRY_C, ENTRY_A, ENTRY_B] }, COORDINATOR);

      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.save.mock.calls[0][0]).toBe(HourEntryEvent);
      const events = savedEvents();
      expect(events.map((event) => event.hourEntryId)).toEqual([ENTRY_A, ENTRY_B, ENTRY_C]);
      for (const event of events) {
        expect(event).toEqual(
          Object.assign(new HourEntryEvent(), {
            hourEntryId: event.hourEntryId,
            type: HourEntryEventType.APPROVED,
            actorId: COORDINATOR.id,
            fromStatus: HourEntryStatus.PENDING,
            toStatus: HourEntryStatus.APPROVED,
            fromMinutes: declared[event.hourEntryId],
            toMinutes: declared[event.hourEntryId],
            note: null,
            createdAt: NOW,
            updatedAt: NOW,
          }),
        );
      }
      expect(clock.now).toHaveBeenCalledTimes(1);
      expect(order).toEqual([
        "update",
        "insert-events",
        "commit",
        "emit-audit",
        "emit-audit",
        "emit-audit",
      ]);
    });

    it("throws DUPLICATE_HOUR_ENTRY for an id repeated in any letter case, before opening the transaction, with the positions of the repeats in details", async () => {
      const failure = await httpFailure(
        service.validateEntries(
          { ids: [ENTRY_A, ENTRY_B, ENTRY_A.toUpperCase(), ENTRY_B] },
          COORDINATOR,
        ),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "DUPLICATE_HOUR_ENTRY",
        message: "The same hour entry appears more than once.",
        details: [
          { field: "ids.2", message: "hour entry appears more than once" },
          { field: "ids.3", message: "hour entry appears more than once" },
        ],
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(clock.now).not.toHaveBeenCalled();
    });

    it("throws HOUR_ENTRY_NOT_FOUND with status 400 and the positions of unknown or removed ids, and writes nothing", async () => {
      manager.find.mockResolvedValue([entryOf(ENTRY_B)]);

      const failure = await httpFailure(
        service.validateEntries({ ids: [UNKNOWN, ENTRY_B, ENTRY_A] }, COORDINATOR),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "HOUR_ENTRY_NOT_FOUND",
        message: "One or more hour entries do not exist.",
        details: [
          { field: "ids.0", message: "hour entry not found" },
          { field: "ids.2", message: "hour entry not found" },
        ],
      });
      expect(writes()).toBe(0);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws SELF_REVIEW_NOT_ALLOWED with the positions of the reviewer's own entries, and writes nothing", async () => {
      manager.find.mockResolvedValue([
        entryOf(ENTRY_A),
        entryOf(ENTRY_B, { personId: COORDINATOR.id, createdById: COORDINATOR.id }),
        entryOf(ENTRY_C, {
          personId: COORDINATOR.id,
          createdById: MEMBER_ID,
          origin: HourEntryOrigin.ON_BEHALF,
        }),
      ]);

      const failure = await httpFailure(
        service.validateEntries({ ids: [ENTRY_C, ENTRY_A, ENTRY_B] }, COORDINATOR),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "SELF_REVIEW_NOT_ALLOWED",
        message: "You cannot review your own hour entry.",
        details: [
          { field: "ids.0", message: "you cannot review your own hour entry" },
          { field: "ids.2", message: "you cannot review your own hour entry" },
        ],
      });
      expect(writes()).toBe(0);
    });

    it("lets the reviewer validate an entry she logged on behalf of a member: only the owner of the hours counts", async () => {
      manager.find.mockResolvedValue([
        entryOf(ENTRY_A, { createdById: COORDINATOR.id, origin: HourEntryOrigin.ON_BEHALF }),
      ]);

      const [approved] = await service.validateEntries({ ids: [ENTRY_A] }, COORDINATOR);

      expect(approved.status).toBe(HourEntryStatus.APPROVED);
    });

    it("throws ENTRY_NOT_PENDING with the positions of reviewed entries, and writes nothing", async () => {
      manager.find.mockResolvedValue([
        entryOf(ENTRY_A, { status: HourEntryStatus.APPROVED }),
        entryOf(ENTRY_B),
        entryOf(ENTRY_C, { status: HourEntryStatus.REJECTED }),
      ]);

      const failure = await httpFailure(
        service.validateEntries({ ids: [ENTRY_A, ENTRY_B, ENTRY_C] }, SUPERADMIN),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "ENTRY_NOT_PENDING",
        message: "Only pending hour entries can be reviewed.",
        details: [
          { field: "ids.0", message: "hour entry is not pending" },
          { field: "ids.2", message: "hour entry is not pending" },
        ],
      });
      expect(writes()).toBe(0);
    });

    it("answers HOUR_ENTRY_NOT_FOUND before SELF_REVIEW_NOT_ALLOWED, and SELF_REVIEW_NOT_ALLOWED before ENTRY_NOT_PENDING", async () => {
      const own = { personId: COORDINATOR.id, createdById: COORDINATOR.id };
      manager.find.mockResolvedValue([
        entryOf(ENTRY_A, own),
        entryOf(ENTRY_B, { status: HourEntryStatus.ADJUSTED }),
      ]);
      const notFound = await httpFailure(
        service.validateEntries({ ids: [ENTRY_A, ENTRY_B, UNKNOWN] }, COORDINATOR),
      );
      expect(notFound.getResponse()).toMatchObject({ error: "HOUR_ENTRY_NOT_FOUND" });

      const self = await httpFailure(
        service.validateEntries({ ids: [ENTRY_A, ENTRY_B] }, COORDINATOR),
      );
      expect(self.getResponse()).toMatchObject({ error: "SELF_REVIEW_NOT_ALLOWED" });
    });

    it("emits one HOUR_ENTRY_APPROVED per entry after the commit, with no review note in the payload", async () => {
      await service.validateEntries({ ids: [ENTRY_C, ENTRY_A, ENTRY_B] }, COORDINATOR);

      const events = auditEvents();
      expect(events.map((event) => event.targetId)).toEqual([ENTRY_C, ENTRY_A, ENTRY_B]);
      for (const event of events) {
        expect(event).toBeInstanceOf(AuditableActionEvent);
        expect(event).toEqual(
          Object.assign(new AuditableActionEvent(), {
            actorId: COORDINATOR.id,
            action: AuditableAction.HOUR_ENTRY_APPROVED,
            targetType: "hour_entry",
            targetId: event.targetId,
            before: { status: HourEntryStatus.PENDING, validatedMinutes: null },
            after: {
              personId: MEMBER_ID,
              status: HourEntryStatus.APPROVED,
              declaredMinutes: declared[event.targetId],
              validatedMinutes: declared[event.targetId],
              reviewedById: COORDINATOR.id,
            },
            occurredAt: NOW,
          }),
        );
      }
      expect(order.indexOf("commit")).toBeLessThan(order.indexOf("emit-audit"));
    });

    it("emits nothing when the transaction fails", async () => {
      const failure = new Error("connection lost");
      updateBuilder.execute.mockRejectedValueOnce(failure);

      await expect(service.validateEntries({ ids: [ENTRY_A, ENTRY_B] }, COORDINATOR)).rejects.toBe(
        failure,
      );
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("adjustEntry", () => {
    beforeEach(() => {
      manager.findOne.mockResolvedValue(entryOf(ENTRY_A));
    });

    it("adjusts a pending entry: adjusted, the new validated minutes, the declared minutes kept, the justification as review note, the reviewer and the instant", async () => {
      const answer = await service.adjustEntry(
        ENTRY_A,
        { validatedMinutes: 120, justification: JUSTIFICATION },
        COORDINATOR,
      );

      expect(answer).toMatchObject({
        id: ENTRY_A,
        status: HourEntryStatus.ADJUSTED,
        declaredMinutes: 240,
        validatedMinutes: 120,
        reviewNote: JUSTIFICATION,
        reviewedById: COORDINATOR.id,
        reviewedAt: NOW,
        updatedAt: NOW,
        createdAt: CREATED_AT,
      });
      expect(manager.update).toHaveBeenCalledWith(
        HourEntry,
        { id: ENTRY_A },
        {
          status: HourEntryStatus.ADJUSTED,
          validatedMinutes: 120,
          reviewNote: JUSTIFICATION,
          reviewedById: COORDINATOR.id,
          reviewedAt: NOW,
          updatedAt: NOW,
        },
      );
      expect(order).toEqual(["update", "insert-events", "commit", "emit-audit"]);
    });

    it("reads the entry FOR UPDATE by the id of the URL and writes and records with the id of the database", async () => {
      await service.adjustEntry(
        ENTRY_A.toUpperCase(),
        { validatedMinutes: 120, justification: JUSTIFICATION },
        COORDINATOR,
      );

      expect(manager.findOne).toHaveBeenCalledWith(HourEntry, {
        where: { id: ENTRY_A.toUpperCase() },
        lock: { mode: "pessimistic_write" },
      });
      expect(manager.update.mock.calls[0][1]).toEqual({ id: ENTRY_A });
      expect(savedEvents()[0].hourEntryId).toBe(ENTRY_A);
      expect(auditEvents()[0].targetId).toBe(ENTRY_A);
    });

    it("records an adjusted event from pending and the declared minutes to adjusted and the new minutes, with the justification as note", async () => {
      await service.adjustEntry(
        ENTRY_A,
        { validatedMinutes: 120, justification: JUSTIFICATION },
        COORDINATOR,
      );

      expect(savedEvents()).toEqual([
        Object.assign(new HourEntryEvent(), {
          hourEntryId: ENTRY_A,
          type: HourEntryEventType.ADJUSTED,
          actorId: COORDINATOR.id,
          fromStatus: HourEntryStatus.PENDING,
          toStatus: HourEntryStatus.ADJUSTED,
          fromMinutes: 240,
          toMinutes: 120,
          note: JUSTIFICATION,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ]);
      expect(clock.now).toHaveBeenCalledTimes(1);
    });

    it("accepts more minutes than declared", async () => {
      const answer = await service.adjustEntry(
        ENTRY_A,
        { validatedMinutes: 300, justification: JUSTIFICATION },
        COORDINATOR,
      );

      expect(answer).toMatchObject({ declaredMinutes: 240, validatedMinutes: 300 });
    });

    it("throws ADJUSTED_MINUTES_UNCHANGED when the minutes are the declared ones, after HOUR_ENTRY_NOT_FOUND, SELF_REVIEW_NOT_ALLOWED and ENTRY_NOT_PENDING, and writes nothing", async () => {
      const unchanged = { validatedMinutes: 240, justification: JUSTIFICATION };

      const failure = await httpFailure(service.adjustEntry(ENTRY_A, unchanged, COORDINATOR));
      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "ADJUSTED_MINUTES_UNCHANGED",
        message:
          "validatedMinutes must differ from the declared minutes; validate the entry instead.",
        details: [
          {
            field: "validatedMinutes",
            message: "validatedMinutes must differ from the declared minutes",
          },
        ],
      });

      manager.findOne.mockResolvedValue(entryOf(ENTRY_A, { status: HourEntryStatus.APPROVED }));
      const notPending = await httpFailure(service.adjustEntry(ENTRY_A, unchanged, COORDINATOR));
      expect(notPending.getResponse()).toMatchObject({ error: "ENTRY_NOT_PENDING" });

      manager.findOne.mockResolvedValue(
        entryOf(ENTRY_A, { personId: COORDINATOR.id, createdById: COORDINATOR.id }),
      );
      const self = await httpFailure(service.adjustEntry(ENTRY_A, unchanged, COORDINATOR));
      expect(self.getResponse()).toMatchObject({ error: "SELF_REVIEW_NOT_ALLOWED" });

      manager.findOne.mockResolvedValue(null);
      const notFound = await httpFailure(service.adjustEntry(UNKNOWN, unchanged, COORDINATOR));
      expect(notFound.getStatus()).toBe(404);
      expect(notFound.getResponse()).toMatchObject({ error: "HOUR_ENTRY_NOT_FOUND" });

      expect(writes()).toBe(0);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws HOUR_ENTRY_NOT_FOUND with status 404 for an unknown or removed entry", async () => {
      manager.findOne.mockResolvedValue(null);

      const failure = await httpFailure(
        service.adjustEntry(
          UNKNOWN,
          { validatedMinutes: 120, justification: JUSTIFICATION },
          COORDINATOR,
        ),
      );

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "HOUR_ENTRY_NOT_FOUND",
        message: "Hour entry not found.",
      });
      expect(writes()).toBe(0);
    });

    it("throws SELF_REVIEW_NOT_ALLOWED for an entry of the reviewer, before ENTRY_NOT_PENDING", async () => {
      manager.findOne.mockResolvedValue(
        entryOf(ENTRY_A, {
          personId: COORDINATOR.id,
          createdById: COORDINATOR.id,
          status: HourEntryStatus.APPROVED,
        }),
      );

      const failure = await httpFailure(
        service.adjustEntry(
          ENTRY_A,
          { validatedMinutes: 120, justification: JUSTIFICATION },
          COORDINATOR,
        ),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "SELF_REVIEW_NOT_ALLOWED",
        message: "You cannot review your own hour entry.",
      });
      expect(writes()).toBe(0);
    });

    it.each([HourEntryStatus.APPROVED, HourEntryStatus.ADJUSTED, HourEntryStatus.REJECTED])(
      "throws ENTRY_NOT_PENDING for a %s entry and writes nothing",
      async (status) => {
        manager.findOne.mockResolvedValue(entryOf(ENTRY_A, { status }));

        const failure = await httpFailure(
          service.adjustEntry(
            ENTRY_A,
            { validatedMinutes: 120, justification: JUSTIFICATION },
            COORDINATOR,
          ),
        );

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "ENTRY_NOT_PENDING",
          message: "Only pending hour entries can be reviewed.",
        });
        expect(writes()).toBe(0);
      },
    );

    it("emits HOUR_ENTRY_ADJUSTED after the commit without the justification, and nothing when the transaction fails", async () => {
      await service.adjustEntry(
        ENTRY_A,
        { validatedMinutes: 120, justification: JUSTIFICATION },
        COORDINATOR,
      );

      expect(auditEvents()).toEqual([
        Object.assign(new AuditableActionEvent(), {
          actorId: COORDINATOR.id,
          action: AuditableAction.HOUR_ENTRY_ADJUSTED,
          targetType: "hour_entry",
          targetId: ENTRY_A,
          before: { status: HourEntryStatus.PENDING, validatedMinutes: null },
          after: {
            personId: MEMBER_ID,
            status: HourEntryStatus.ADJUSTED,
            declaredMinutes: 240,
            validatedMinutes: 120,
            reviewedById: COORDINATOR.id,
          },
          occurredAt: NOW,
        }),
      ]);
      expect(JSON.stringify(auditEvents())).not.toContain(JUSTIFICATION);

      eventEmitter.emit.mockClear();
      const failure = new Error("connection lost");
      manager.save.mockRejectedValueOnce(failure);
      await expect(
        service.adjustEntry(
          ENTRY_A,
          { validatedMinutes: 120, justification: JUSTIFICATION },
          COORDINATOR,
        ),
      ).rejects.toBe(failure);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("rejectEntry", () => {
    beforeEach(() => {
      manager.findOne.mockResolvedValue(entryOf(ENTRY_A));
    });

    it("rejects a pending entry: rejected, 0 validated minutes, the reason as review note, the reviewer and the instant", async () => {
      const answer = await service.rejectEntry(ENTRY_A, { reason: REASON }, SUPERADMIN);

      expect(answer).toMatchObject({
        id: ENTRY_A,
        status: HourEntryStatus.REJECTED,
        declaredMinutes: 240,
        validatedMinutes: 0,
        reviewNote: REASON,
        reviewedById: SUPERADMIN.id,
        reviewedAt: NOW,
        updatedAt: NOW,
      });
      expect(manager.update).toHaveBeenCalledWith(
        HourEntry,
        { id: ENTRY_A },
        {
          status: HourEntryStatus.REJECTED,
          validatedMinutes: 0,
          reviewNote: REASON,
          reviewedById: SUPERADMIN.id,
          reviewedAt: NOW,
          updatedAt: NOW,
        },
      );
    });

    it("records a rejected event from pending and the declared minutes to rejected and 0, with the reason as note", async () => {
      await service.rejectEntry(ENTRY_A, { reason: REASON }, SUPERADMIN);

      expect(savedEvents()).toEqual([
        Object.assign(new HourEntryEvent(), {
          hourEntryId: ENTRY_A,
          type: HourEntryEventType.REJECTED,
          actorId: SUPERADMIN.id,
          fromStatus: HourEntryStatus.PENDING,
          toStatus: HourEntryStatus.REJECTED,
          fromMinutes: 240,
          toMinutes: 0,
          note: REASON,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ]);
    });

    it("throws HOUR_ENTRY_NOT_FOUND, SELF_REVIEW_NOT_ALLOWED and ENTRY_NOT_PENDING like the adjustment", async () => {
      manager.findOne.mockResolvedValueOnce(null);
      const notFound = await httpFailure(
        service.rejectEntry(UNKNOWN, { reason: REASON }, SUPERADMIN),
      );
      expect(notFound.getStatus()).toBe(404);
      expect(notFound.getResponse()).toMatchObject({ error: "HOUR_ENTRY_NOT_FOUND" });

      manager.findOne.mockResolvedValueOnce(entryOf(ENTRY_A, { personId: SUPERADMIN.id }));
      const self = await httpFailure(service.rejectEntry(ENTRY_A, { reason: REASON }, SUPERADMIN));
      expect(self.getStatus()).toBe(409);
      expect(self.getResponse()).toMatchObject({ error: "SELF_REVIEW_NOT_ALLOWED" });

      manager.findOne.mockResolvedValueOnce(entryOf(ENTRY_A, { status: HourEntryStatus.REJECTED }));
      const notPending = await httpFailure(
        service.rejectEntry(ENTRY_A, { reason: REASON }, SUPERADMIN),
      );
      expect(notPending.getStatus()).toBe(409);
      expect(notPending.getResponse()).toMatchObject({ error: "ENTRY_NOT_PENDING" });

      expect(writes()).toBe(0);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits HOUR_ENTRY_REJECTED after the commit without the reason", async () => {
      await service.rejectEntry(ENTRY_A, { reason: REASON }, SUPERADMIN);

      const [event] = auditEvents();
      expect(event).toMatchObject({
        action: AuditableAction.HOUR_ENTRY_REJECTED,
        actorId: SUPERADMIN.id,
        targetId: ENTRY_A,
        after: { status: HourEntryStatus.REJECTED, validatedMinutes: 0 },
        occurredAt: NOW,
      });
      expect(JSON.stringify(event)).not.toContain(REASON);
      expect(order).toEqual(["update", "insert-events", "commit", "emit-audit"]);
    });
  });
});
