import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, EntityManager } from "typeorm";
import { MemberRegistrationStatus } from "@modules/people/enums/member-registration-status.enum";
import { MembersService } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
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

const TECH = "01999a3e-1111-7000-8000-000000000001";
const COMMS = "01999a3e-1111-7000-8000-000000000002";

const MEMBER: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.MEMBER,
  accessEnabled: true,
  departmentIds: [TECH],
};
const DIRECTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000bb",
  role: Role.DIRECTOR,
  accessEnabled: true,
  departmentIds: [TECH],
};
const DIRECTOR_OF_OTHER_DEPARTMENT: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000cc",
  role: Role.DIRECTOR,
  accessEnabled: true,
  departmentIds: [COMMS],
};
const DIRECTOR_WITHOUT_DEPARTMENT: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000dd",
  role: Role.DIRECTOR,
  accessEnabled: true,
  departmentIds: [],
};
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
  const people = { findRefsByIds: jest.fn() };
  const members = { findAccessFacts: jest.fn() };

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
    people.findRefsByIds.mockImplementation(async (ids: string[]) => {
      order.push("find-person");
      return ids.map((id) => ({ id: id.toLowerCase(), name: "Member" }));
    });
    members.findAccessFacts.mockImplementation(async () => {
      order.push("find-access-facts");
      return { registrationStatus: MemberRegistrationStatus.APPROVED, departmentIds: [TECH] };
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        HoursService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: PeopleService, useValue: people },
        { provide: MembersService, useValue: members },
        PermissionPolicy,
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

  describe("logHoursForMember", () => {
    it("logs on_behalf for a member of the director's department, created by the director", async () => {
      const response = await service.logHoursForMember(MEMBER.id, CARD_DTO, DIRECTOR);

      expect(order).toEqual([
        "find-person",
        "find-access-facts",
        "insert-entry",
        "insert-event",
        "commit",
        "emit-audit",
      ]);
      expect(people.findRefsByIds).toHaveBeenCalledWith([MEMBER.id]);
      expect(members.findAccessFacts).toHaveBeenCalledWith(MEMBER.id);
      expect(savedEntries()[0]).toMatchObject({
        personId: MEMBER.id,
        createdById: DIRECTOR.id,
        origin: HourEntryOrigin.ON_BEHALF,
        status: HourEntryStatus.PENDING,
        notes: null,
      });
      expect(savedEvents()[0]).toMatchObject({
        actorId: DIRECTOR.id,
        type: HourEntryEventType.CREATED,
      });
      expect(auditEvents()).toHaveLength(1);
      expect(auditEvents()[0]).toMatchObject({
        action: AuditableAction.HOUR_ENTRY_CREATED,
        actorId: DIRECTOR.id,
        after: { personId: MEMBER.id, origin: HourEntryOrigin.ON_BEHALF },
      });
      expect(response).toMatchObject({
        id: ENTRY_ID,
        personId: MEMBER.id,
        createdById: DIRECTOR.id,
        origin: HourEntryOrigin.ON_BEHALF,
      });
    });

    it("throws SELF_ON_BEHALF_NOT_ALLOWED when the id is the actor's, in any letter case, before reading the target", async () => {
      for (const id of [DIRECTOR.id, DIRECTOR.id.toUpperCase()]) {
        const failure = await httpFailure(service.logHoursForMember(id, CARD_DTO, DIRECTOR));

        expect(failure.getStatus()).toBe(400);
        expect(codeOf(failure)).toBe("SELF_ON_BEHALF_NOT_ALLOWED");
      }
      expect(people.findRefsByIds).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("throws MEMBER_NOT_FOUND when the person does not exist, before the scope check", async () => {
      people.findRefsByIds.mockResolvedValue([]);

      for (const actor of [DIRECTOR, DIRECTOR_OF_OTHER_DEPARTMENT]) {
        const failure = await httpFailure(service.logHoursForMember(MEMBER.id, CARD_DTO, actor));

        expect(failure.getStatus()).toBe(404);
        expect(codeOf(failure)).toBe("MEMBER_NOT_FOUND");
      }
      expect(members.findAccessFacts).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it.each([MemberRegistrationStatus.PENDING, MemberRegistrationStatus.REJECTED, null])(
      "throws MEMBER_NOT_FOUND when the registration status is %s",
      async (registrationStatus) => {
        members.findAccessFacts.mockResolvedValue({ registrationStatus, departmentIds: [] });

        for (const actor of [DIRECTOR, COORDINATOR, SUPERADMIN]) {
          const failure = await httpFailure(service.logHoursForMember(MEMBER.id, CARD_DTO, actor));

          expect(failure.getStatus()).toBe(404);
          expect(codeOf(failure)).toBe("MEMBER_NOT_FOUND");
        }
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it("throws FORBIDDEN_SCOPE to a director of another department and to a director without department, and writes nothing", async () => {
      for (const actor of [DIRECTOR_OF_OTHER_DEPARTMENT, DIRECTOR_WITHOUT_DEPARTMENT]) {
        const failure = await httpFailure(service.logHoursForMember(MEMBER.id, CARD_DTO, actor));

        expect(failure.getStatus()).toBe(403);
        expect(codeOf(failure)).toBe("FORBIDDEN_SCOPE");
      }

      members.findAccessFacts.mockResolvedValue({
        registrationStatus: MemberRegistrationStatus.APPROVED,
        departmentIds: [],
      });
      const memberWithoutDepartment = await httpFailure(
        service.logHoursForMember(MEMBER.id, CARD_DTO, DIRECTOR),
      );
      expect(codeOf(memberWithoutDepartment)).toBe("FORBIDDEN_SCOPE");

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws FORBIDDEN_SCOPE to a member, whose hours.logForOthers is none", async () => {
      const failure = await httpFailure(service.logHoursForMember(DIRECTOR.id, CARD_DTO, MEMBER));

      expect(codeOf(failure)).toBe("FORBIDDEN_SCOPE");
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("lets the coordinator and the superadmin log for a member of any department, and for one without department", async () => {
      for (const departmentIds of [[COMMS], []]) {
        members.findAccessFacts.mockResolvedValue({
          registrationStatus: MemberRegistrationStatus.APPROVED,
          departmentIds,
        });

        for (const actor of [COORDINATOR, SUPERADMIN]) {
          const response = await service.logHoursForMember(MEMBER.id, CARD_DTO, actor);

          expect(response).toMatchObject({
            personId: MEMBER.id,
            createdById: actor.id,
            origin: HourEntryOrigin.ON_BEHALF,
          });
        }
      }
      expect(dataSource.transaction).toHaveBeenCalledTimes(4);
    });

    it("uses the id the database returns, not the one of the URL", async () => {
      await service.logHoursForMember(MEMBER.id.toUpperCase(), CARD_DTO, DIRECTOR);

      expect(people.findRefsByIds).toHaveBeenCalledWith([MEMBER.id.toUpperCase()]);
      expect(members.findAccessFacts).toHaveBeenCalledWith(MEMBER.id);
      expect(savedEntries()[0].personId).toBe(MEMBER.id);
      expect(auditEvents()[0].after).toMatchObject({ personId: MEMBER.id });
    });

    it("throws HOUR_ENTRY_DATE_IN_FUTURE after the scope check", async () => {
      const future = { ...CARD_DTO, date: TOMORROW };

      const outOfScope = await httpFailure(
        service.logHoursForMember(MEMBER.id, future, DIRECTOR_OF_OTHER_DEPARTMENT),
      );
      expect(codeOf(outOfScope)).toBe("FORBIDDEN_SCOPE");

      const inScope = await httpFailure(service.logHoursForMember(MEMBER.id, future, DIRECTOR));
      expect(codeOf(inScope)).toBe("HOUR_ENTRY_DATE_IN_FUTURE");
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("keeps the notes of the body and does not emit when the transaction fails", async () => {
      await service.logHoursForMember(
        MEMBER.id,
        { ...CARD_DTO, notes: "Feito no sábado." },
        DIRECTOR,
      );
      expect(savedEntries()[0].notes).toBe("Feito no sábado.");

      eventEmitter.emit.mockClear();
      const failure = new Error("connection lost");
      manager.save.mockRejectedValueOnce(failure);

      await expect(service.logHoursForMember(MEMBER.id, CARD_DTO, DIRECTOR)).rejects.toBe(failure);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
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

  describe("removeMyEntry", () => {
    const CREATED_AT = new Date("2026-03-10T21:00:00.000Z");
    let stored: HourEntry | null;

    function storedEntry(overrides: Partial<HourEntry> = {}): HourEntry {
      return Object.assign(new HourEntry(), {
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
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        deletedAt: null,
        ...overrides,
      });
    }

    beforeEach(() => {
      stored = storedEntry();
      manager.findOne.mockImplementation(async () => {
        order.push("load-entry");
        return stored;
      });
      manager.update.mockImplementation(async () => {
        order.push("soft-delete");
        return { affected: 1 };
      });
    });

    it("soft-deletes a pending entry of the actor and records a removed event in the same transaction, then emits HOUR_ENTRY_REMOVED", async () => {
      await expect(service.removeMyEntry(ENTRY_ID, MEMBER)).resolves.toBeUndefined();

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["load-entry", "soft-delete", "insert-event", "commit", "emit-audit"]);
      expect(manager.update).toHaveBeenCalledWith(
        HourEntry,
        { id: ENTRY_ID },
        { deletedAt: NOW, updatedAt: NOW },
      );
      expect(savedEvents()).toHaveLength(1);
      expect(savedEvents()[0]).toMatchObject({ createdAt: NOW, updatedAt: NOW });
      expect(savedEntries()).toEqual([]);
      expect(auditEvents()).toHaveLength(1);
      expect(auditEvents()[0]).toMatchObject({
        action: AuditableAction.HOUR_ENTRY_REMOVED,
        actorId: MEMBER.id,
        targetType: "hour_entry",
        targetId: ENTRY_ID,
        before: { status: HourEntryStatus.PENDING, declaredMinutes: 150 },
        after: { deletedAt: NOW },
        occurredAt: NOW,
      });
      expect(clock.now).toHaveBeenCalledTimes(1);
    });

    it("reads the entry FOR UPDATE, filtered by the actor's person id", async () => {
      await service.removeMyEntry(ENTRY_ID, MEMBER);

      expect(manager.findOne).toHaveBeenCalledWith(HourEntry, {
        where: { id: ENTRY_ID, personId: MEMBER.id },
        lock: { mode: "pessimistic_write" },
      });
    });

    it("throws HOUR_ENTRY_NOT_FOUND when the entry is not the actor's or does not exist", async () => {
      stored = null;

      const failure = await httpFailure(service.removeMyEntry(ENTRY_ID, DIRECTOR));

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("HOUR_ENTRY_NOT_FOUND");
      expect(manager.findOne).toHaveBeenCalledWith(HourEntry, {
        where: { id: ENTRY_ID, personId: DIRECTOR.id },
        lock: { mode: "pessimistic_write" },
      });
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it.each([HourEntryStatus.APPROVED, HourEntryStatus.ADJUSTED, HourEntryStatus.REJECTED])(
      "throws ENTRY_NOT_PENDING for an entry that is %s and writes nothing",
      async (status) => {
        stored = storedEntry({ status, validatedMinutes: 120 });

        const failure = await httpFailure(service.removeMyEntry(ENTRY_ID, MEMBER));

        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("ENTRY_NOT_PENDING");
        expect(manager.update).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      },
    );

    it("does not emit when the transaction fails", async () => {
      const failure = new Error("connection lost");
      manager.save.mockRejectedValueOnce(failure);

      await expect(service.removeMyEntry(ENTRY_ID, MEMBER)).rejects.toBe(failure);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("records the removed event as: from pending and the declared minutes to nothing, actor = the person", async () => {
      stored = storedEntry({
        declaredMinutes: 45,
        createdById: DIRECTOR.id,
        origin: HourEntryOrigin.ON_BEHALF,
      });

      await service.removeMyEntry(ENTRY_ID, MEMBER);

      expect(savedEvents()[0]).toMatchObject({
        hourEntryId: ENTRY_ID,
        type: HourEntryEventType.REMOVED,
        actorId: MEMBER.id,
        fromStatus: HourEntryStatus.PENDING,
        toStatus: null,
        fromMinutes: 45,
        toMinutes: null,
        note: null,
      });
    });

    it("writes with the id the database returns, not the one of the URL", async () => {
      await service.removeMyEntry(ENTRY_ID.toUpperCase(), MEMBER);

      expect(manager.findOne).toHaveBeenCalledWith(HourEntry, {
        where: { id: ENTRY_ID.toUpperCase(), personId: MEMBER.id },
        lock: { mode: "pessimistic_write" },
      });
      expect(manager.update).toHaveBeenCalledWith(HourEntry, { id: ENTRY_ID }, expect.anything());
      expect(savedEvents()[0].hourEntryId).toBe(ENTRY_ID);
      expect(auditEvents()[0].targetId).toBe(ENTRY_ID);
    });
  });
});
