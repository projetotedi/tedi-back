import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, EntityManager } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { CreateHourEntryDto } from "../dto/create-hour-entry.dto";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { HourEntryDraft, HoursService } from "../services/hours.service";

/** 22:30 of 2026-10-01 in America/Sao_Paulo, when the UTC date is already 2026-10-02. */
const NOW = new Date("2026-10-02T01:30:00.000Z");
const TODAY = "2026-10-01";
const TOMORROW = "2026-10-02";

const ENTRY_ID = "01999a3e-7c1b-7000-8000-000000000a01";
const EVENT_ID = "01999a3e-7c1b-7000-8000-000000000e01";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";

const MEMBER: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.MEMBER,
  accessEnabled: true,
  departmentIds: [],
};
const DIRECTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000bb",
  role: Role.DIRECTOR,
  accessEnabled: true,
  departmentIds: ["01999a3e-1111-7000-8000-000000000001"],
};

const CARD_DTO: CreateHourEntryDto = {
  activity: "Planejamento da aula de teclado e mouse",
  category: HourEntryCategory.PLANNING,
  date: "2026-03-10",
  declaredMinutes: 150,
};

function draftOf(overrides: Partial<HourEntryDraft> = {}): HourEntryDraft {
  return {
    personId: MEMBER.id,
    createdById: MEMBER.id,
    origin: HourEntryOrigin.MANUAL,
    activity: "Planejamento da aula de teclado e mouse",
    category: HourEntryCategory.PLANNING,
    date: "2026-03-10",
    declaredMinutes: 150,
    notes: "Revisei os exercícios do plano 3.",
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

function codeOf(failure: HttpException): string {
  return (failure.getResponse() as { error: string }).error;
}

describe("HoursService", () => {
  let service: HoursService;
  let order: string[];

  const manager = { create: jest.fn(), save: jest.fn(), findOne: jest.fn(), update: jest.fn() };
  const entityManager = manager as unknown as EntityManager;
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  /** A chainable query builder: every method returns it, and the two terminals resolve. */
  const builder = {
    where: jest.fn(),
    andWhere: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    offset: jest.fn(),
    limit: jest.fn(),
    groupBy: jest.fn(),
    addGroupBy: jest.fn(),
    getManyAndCount: jest.fn(),
    getRawMany: jest.fn(),
  };
  const entryRepository = { createQueryBuilder: jest.fn() };

  function auditEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls
      .filter((call) => call[0] === AUDITABLE_ACTION_EVENT)
      .map((call) => call[1] as AuditableActionEvent);
  }

  function savedEntries(): HourEntry[] {
    return manager.save.mock.calls
      .filter((call) => call[0] instanceof HourEntry)
      .map((call) => call[0] as HourEntry);
  }

  function savedEvents(): HourEntryEvent[] {
    return manager.save.mock.calls
      .filter((call) => call[0] instanceof HourEntryEvent)
      .map((call) => call[0] as HourEntryEvent);
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];

    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), data),
    );
    manager.save.mockImplementation(async (entity: object) => {
      if (entity instanceof HourEntry) {
        order.push("insert-entry");
        return Object.assign(entity, { id: ENTRY_ID });
      }
      order.push("insert-event");
      return Object.assign(entity, { id: EVENT_ID });
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
    for (const method of [
      builder.where,
      builder.andWhere,
      builder.select,
      builder.addSelect,
      builder.orderBy,
      builder.addOrderBy,
      builder.offset,
      builder.limit,
      builder.groupBy,
      builder.addGroupBy,
    ]) {
      method.mockReturnValue(builder);
    }
    builder.getManyAndCount.mockResolvedValue([[], 0]);
    builder.getRawMany.mockResolvedValue([]);
    entryRepository.createQueryBuilder.mockReturnValue(builder);
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === HourEntry ? entryRepository : undefined,
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        HoursService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
      ],
    }).compile();

    service = moduleRef.get(HoursService);
  });

  describe("createEntry", () => {
    it("creates a pending entry and its created event in the caller's transaction, and returns the audit event without emitting it", async () => {
      const { entry, auditEvent } = await service.createEntry(
        entityManager,
        draftOf({ notes: null }),
      );

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(order).toEqual(["insert-entry", "insert-event"]);
      expect(entry).toBe(savedEntries()[0]);
      expect(entry).toMatchObject({
        id: ENTRY_ID,
        personId: MEMBER.id,
        createdById: MEMBER.id,
        origin: HourEntryOrigin.MANUAL,
        activity: "Planejamento da aula de teclado e mouse",
        category: HourEntryCategory.PLANNING,
        date: "2026-03-10",
        declaredMinutes: 150,
        notes: null,
        status: HourEntryStatus.PENDING,
        validatedMinutes: null,
        reviewNote: null,
        reviewedById: null,
        reviewedAt: null,
      });
      expect(auditEvent).toBeInstanceOf(AuditableActionEvent);
      expect(auditEvent).toMatchObject({
        action: AuditableAction.HOUR_ENTRY_CREATED,
        actorId: MEMBER.id,
        targetType: "hour_entry",
        targetId: ENTRY_ID,
        before: null,
        after: {
          personId: MEMBER.id,
          category: HourEntryCategory.PLANNING,
          date: "2026-03-10",
          declaredMinutes: 150,
          status: HourEntryStatus.PENDING,
          origin: HourEntryOrigin.MANUAL,
          classId: null,
          lessonId: null,
        },
      });
    });

    it("records the created event as: actor = createdById, from nothing to pending, from nothing to the declared minutes, no note", async () => {
      await service.createEntry(
        entityManager,
        draftOf({
          createdById: DIRECTOR.id,
          origin: HourEntryOrigin.ON_BEHALF,
          declaredMinutes: 45,
        }),
      );

      expect(savedEvents()).toHaveLength(1);
      expect(savedEvents()[0]).toMatchObject({
        hourEntryId: ENTRY_ID,
        type: HourEntryEventType.CREATED,
        actorId: DIRECTOR.id,
        fromStatus: null,
        toStatus: HourEntryStatus.PENDING,
        fromMinutes: null,
        toMinutes: 45,
        note: null,
      });
    });

    it("stamps the entry, the created event and the audit event with the same instant from the Clock", async () => {
      const { auditEvent } = await service.createEntry(entityManager, draftOf());

      expect(clock.now).toHaveBeenCalledTimes(1);
      expect(savedEntries()[0]).toMatchObject({ createdAt: NOW, updatedAt: NOW });
      expect(savedEvents()[0]).toMatchObject({ createdAt: NOW, updatedAt: NOW });
      expect(auditEvent.occurredAt).toBe(NOW);
    });

    it("throws HOUR_ENTRY_DATE_IN_FUTURE for a date after today in America/Sao_Paulo, before inserting anything", async () => {
      for (const date of [TOMORROW, "2027-01-01"]) {
        const failure = await httpFailure(service.createEntry(entityManager, draftOf({ date })));

        expect(failure.getStatus()).toBe(400);
        expect(codeOf(failure)).toBe("HOUR_ENTRY_DATE_IN_FUTURE");
      }
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("accepts today in America/Sao_Paulo even when the UTC date is already the next day", async () => {
      const { entry } = await service.createEntry(entityManager, draftOf({ date: TODAY }));

      expect(entry.date).toBe(TODAY);
      expect(order).toEqual(["insert-entry", "insert-event"]);
    });

    it("keeps the class and the lesson it is given, and stores null when they are omitted", async () => {
      const given = await service.createEntry(
        entityManager,
        draftOf({ classId: CLASS_ID, lessonId: LESSON_ID }),
      );
      expect(given.entry).toMatchObject({ classId: CLASS_ID, lessonId: LESSON_ID });
      expect(given.auditEvent.after).toMatchObject({ classId: CLASS_ID, lessonId: LESSON_ID });

      const omitted = await service.createEntry(entityManager, draftOf());
      expect(omitted.entry.classId).toBeNull();
      expect(omitted.entry.lessonId).toBeNull();

      const explicitNull = await service.createEntry(
        entityManager,
        draftOf({ classId: null, lessonId: null }),
      );
      expect(explicitNull.entry.classId).toBeNull();
      expect(explicitNull.entry.lessonId).toBeNull();
    });

    it("creates an attendance entry created by someone else, for the presence of GUS-168", async () => {
      const { entry, auditEvent } = await service.createEntry(
        entityManager,
        draftOf({
          origin: HourEntryOrigin.ATTENDANCE,
          createdById: DIRECTOR.id,
          category: HourEntryCategory.LESSON,
          classId: CLASS_ID,
          lessonId: LESSON_ID,
        }),
      );

      expect(entry).toMatchObject({
        personId: MEMBER.id,
        createdById: DIRECTOR.id,
        origin: HourEntryOrigin.ATTENDANCE,
        category: HourEntryCategory.LESSON,
        status: HourEntryStatus.PENDING,
      });
      expect(auditEvent.actorId).toBe(DIRECTOR.id);
      expect(savedEvents()[0].actorId).toBe(DIRECTOR.id);
    });

    it("leaves the activity and the notes out of the audit event (RNF-13)", async () => {
      const { auditEvent } = await service.createEntry(entityManager, draftOf());

      const serialized = JSON.stringify(auditEvent);
      expect(serialized).not.toContain("Planejamento da aula");
      expect(serialized).not.toContain("Revisei os exercícios");
      expect(Object.keys(auditEvent.after).sort()).toEqual([
        "category",
        "classId",
        "date",
        "declaredMinutes",
        "lessonId",
        "origin",
        "personId",
        "status",
      ]);
    });
  });

  describe("logMyHours", () => {
    it("logs for the actor as manual, created by the actor, and emits HOUR_ENTRY_CREATED after the commit", async () => {
      await service.logMyHours({ ...CARD_DTO, notes: "Revisei o plano 3." }, MEMBER);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["insert-entry", "insert-event", "commit", "emit-audit"]);
      expect(savedEntries()[0]).toMatchObject({
        personId: MEMBER.id,
        createdById: MEMBER.id,
        origin: HourEntryOrigin.MANUAL,
        activity: CARD_DTO.activity,
        category: HourEntryCategory.PLANNING,
        date: "2026-03-10",
        declaredMinutes: 150,
        notes: "Revisei o plano 3.",
        status: HourEntryStatus.PENDING,
      });
      expect(auditEvents()).toHaveLength(1);
      expect(auditEvents()[0]).toMatchObject({
        action: AuditableAction.HOUR_ENTRY_CREATED,
        actorId: MEMBER.id,
        targetId: ENTRY_ID,
      });
    });

    it("stores null notes when the body has none", async () => {
      await service.logMyHours(CARD_DTO, MEMBER);

      expect(savedEntries()[0].notes).toBeNull();
    });

    it("does not emit when the transaction fails", async () => {
      const failure = new Error("connection lost");
      manager.save.mockRejectedValueOnce(failure);

      await expect(service.logMyHours(CARD_DTO, MEMBER)).rejects.toBe(failure);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not emit nor insert for a date in the future", async () => {
      const failure = await httpFailure(
        service.logMyHours({ ...CARD_DTO, date: TOMORROW }, MEMBER),
      );

      expect(codeOf(failure)).toBe("HOUR_ENTRY_DATE_IN_FUTURE");
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("answers the saved entry as HourEntryResponseDto", async () => {
      const response = await service.logMyHours(CARD_DTO, MEMBER);

      expect(response).toEqual({
        id: ENTRY_ID,
        personId: MEMBER.id,
        activity: CARD_DTO.activity,
        category: HourEntryCategory.PLANNING,
        date: "2026-03-10",
        declaredMinutes: 150,
        validatedMinutes: null,
        notes: null,
        status: HourEntryStatus.PENDING,
        origin: HourEntryOrigin.MANUAL,
        createdById: MEMBER.id,
        classId: null,
        lessonId: null,
        reviewNote: null,
        reviewedById: null,
        reviewedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(response).not.toHaveProperty("deletedAt");
    });
  });

  describe("listMyEntries / getMySummary", () => {
    it("throws INVALID_PERIOD when from is after to, before querying", async () => {
      const period = { from: "2026-03-31", to: "2026-03-01" };

      for (const promise of [
        service.listMyEntries(MEMBER, period),
        service.getMySummary(MEMBER, period),
      ]) {
        const failure = await httpFailure(promise);
        expect(failure.getStatus()).toBe(400);
        expect(codeOf(failure)).toBe("INVALID_PERIOD");
      }
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it("accepts a one-day period (from equal to to)", async () => {
      const period = { from: "2026-03-10", to: "2026-03-10" };

      await expect(service.listMyEntries(MEMBER, period)).resolves.toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      });
      await expect(service.getMySummary(MEMBER, period)).resolves.toMatchObject(period);
    });

    it("lists only the entries of the actor, newest day first, then newest entry, paginated by offset and limit", async () => {
      const entry = Object.assign(new HourEntry(), {
        id: ENTRY_ID,
        personId: MEMBER.id,
        createdById: MEMBER.id,
        origin: HourEntryOrigin.MANUAL,
        activity: CARD_DTO.activity,
        category: HourEntryCategory.PLANNING,
        date: "2026-03-10",
        declaredMinutes: 150,
        validatedMinutes: null,
        notes: null,
        status: HourEntryStatus.PENDING,
        classId: null,
        lessonId: null,
        reviewNote: null,
        reviewedById: null,
        reviewedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      });
      builder.getManyAndCount.mockResolvedValue([[entry], 41]);

      const page = await service.listMyEntries(MEMBER, { page: 3, limit: 20 });

      expect(builder.where).toHaveBeenCalledWith("entry.person_id = :personId", {
        personId: MEMBER.id,
      });
      expect(builder.andWhere).not.toHaveBeenCalled();
      expect(builder.orderBy).toHaveBeenCalledWith("entry.date", "DESC");
      expect(builder.addOrderBy.mock.calls).toEqual([
        ["entry.created_at", "DESC"],
        ["entry.id", "DESC"],
      ]);
      expect(builder.offset).toHaveBeenCalledWith(40);
      expect(builder.limit).toHaveBeenCalledWith(20);
      expect(page.total).toBe(41);
      expect(page.page).toBe(3);
      expect(page.limit).toBe(20);
      expect(page.data).toHaveLength(1);
      expect(page.data[0]).toMatchObject({ id: ENTRY_ID, status: HourEntryStatus.PENDING });
      expect(page.data[0]).not.toHaveProperty("deletedAt");
    });

    it("adds the status, the category and each end of the period only when they come", async () => {
      await service.listMyEntries(MEMBER, {
        status: HourEntryStatus.REJECTED,
        category: HourEntryCategory.LESSON,
        from: "2026-03-01",
        to: "2026-03-31",
      });
      expect(builder.andWhere.mock.calls).toEqual([
        ["entry.status = :status", { status: HourEntryStatus.REJECTED }],
        ["entry.category = :category", { category: HourEntryCategory.LESSON }],
        ["entry.date >= :from", { from: "2026-03-01" }],
        ["entry.date <= :to", { to: "2026-03-31" }],
      ]);

      builder.andWhere.mockClear();
      await service.listMyEntries(MEMBER, { to: "2026-03-31" });
      expect(builder.andWhere.mock.calls).toEqual([["entry.date <= :to", { to: "2026-03-31" }]]);

      builder.andWhere.mockClear();
      await service.getMySummary(MEMBER, { from: "2026-03-01" });
      expect(builder.andWhere.mock.calls).toEqual([
        ["entry.date >= :from", { from: "2026-03-01" }],
      ]);
    });

    it("sums the entries of the actor grouped by status and category, cast to int, and folds the rows into the summary", async () => {
      builder.getRawMany.mockResolvedValue([
        {
          status: HourEntryStatus.ADJUSTED,
          category: HourEntryCategory.PLANNING,
          entries: 1,
          declaredMinutes: 150,
          validatedMinutes: 120,
        },
        {
          status: HourEntryStatus.PENDING,
          category: HourEntryCategory.MEETING,
          entries: 2,
          declaredMinutes: 90,
          validatedMinutes: 0,
        },
      ]);

      const summary = await service.getMySummary(MEMBER, {});

      expect(builder.select).toHaveBeenCalledWith("entry.status", "status");
      expect(builder.addSelect.mock.calls).toEqual([
        ["entry.category", "category"],
        ["COUNT(*)::int", "entries"],
        ["COALESCE(SUM(entry.declared_minutes), 0)::int", "declaredMinutes"],
        ["COALESCE(SUM(entry.validated_minutes), 0)::int", "validatedMinutes"],
      ]);
      expect(builder.where).toHaveBeenCalledWith("entry.person_id = :personId", {
        personId: MEMBER.id,
      });
      expect(builder.andWhere).not.toHaveBeenCalled();
      expect(builder.groupBy).toHaveBeenCalledWith("entry.status");
      expect(builder.addGroupBy).toHaveBeenCalledWith("entry.category");
      expect(summary).toMatchObject({ from: null, to: null, bankMinutes: 120 });
      expect(
        summary.byCategory.find((total) => total.category === HourEntryCategory.MEETING),
      ).toMatchObject({ entries: 2, pendingMinutes: 90 });
    });
  });
});
