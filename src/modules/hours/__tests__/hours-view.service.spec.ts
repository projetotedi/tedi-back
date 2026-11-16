import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { MemberRegistrationStatus, MembersService } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { EVERYONE, populationOf } from "../services/hour-entry-queries";
import { HoursScopeService } from "../services/hours-scope.service";
import { HoursViewService } from "../services/hours-view.service";

const CREATED_AT = new Date("2026-03-10T21:00:00.000Z");
const REVIEWED_AT = new Date("2026-03-12T13:00:00.000Z");

const TECH = "01999a3e-1111-7000-8000-000000000001";
const COMMS = "01999a3e-1111-7000-8000-000000000002";

const ENTRY_A = "01999a3e-7c1b-7000-8000-000000000a01";
const ENTRY_B = "01999a3e-7c1b-7000-8000-000000000a02";
const ENTRY_C = "01999a3e-7c1b-7000-8000-000000000a03";
const EVENT_1 = "01999a3e-7c1b-7000-8000-000000000e01";
const EVENT_2 = "01999a3e-7c1b-7000-8000-000000000e02";
const EVENT_3 = "01999a3e-7c1b-7000-8000-000000000e03";

const ANA = "01999a3e-0000-7000-8000-0000000000a1";
const BRUNO = "01999a3e-0000-7000-8000-0000000000a2";
const GONE = "01999a3e-0000-7000-8000-0000000000a9";

const MEMBER: AuthUser = { id: ANA, role: Role.MEMBER, accessEnabled: true, departmentIds: [TECH] };
const OTHER_MEMBER: AuthUser = { ...MEMBER, id: BRUNO };
const DIRECTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000bb",
  role: Role.DIRECTOR,
  accessEnabled: true,
  departmentIds: [TECH],
};
const DIRECTOR_OF_OTHER_DEPARTMENT: AuthUser = { ...DIRECTOR, departmentIds: [COMMS] };
const COORDINATOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000ee",
  role: Role.COORDINATOR,
  accessEnabled: true,
  departmentIds: [],
};
const SUPERADMIN: AuthUser = { ...COORDINATOR, role: Role.SUPERADMIN };

const ANA_REF = { id: ANA, name: "Ana Souza", department: { id: TECH, name: "Tecnologia" } };

function entryOf(id: string, overrides: Partial<HourEntry> = {}): HourEntry {
  return Object.assign(new HourEntry(), {
    id,
    personId: ANA,
    createdById: ANA,
    origin: HourEntryOrigin.MANUAL,
    activity: "Planejamento da aula de teclado e mouse",
    category: HourEntryCategory.PLANNING,
    date: "2026-03-10",
    declaredMinutes: 240,
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

function eventOf(id: string, overrides: Partial<HourEntryEvent> = {}): HourEntryEvent {
  return Object.assign(new HourEntryEvent(), {
    id,
    hourEntryId: ENTRY_A,
    type: HourEntryEventType.CREATED,
    actorId: ANA,
    fromStatus: null,
    toStatus: HourEntryStatus.PENDING,
    fromMinutes: null,
    toMinutes: 240,
    note: null,
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

function codeOf(failure: HttpException): unknown {
  const body = failure.getResponse();
  return typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
}

describe("HoursViewService", () => {
  let service: HoursViewService;

  /** A chainable query builder: every method returns it, and the terminals resolve. */
  const builder = {
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    addGroupBy: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    offset: jest.fn(),
    limit: jest.fn(),
    setParameters: jest.fn(),
    getManyAndCount: jest.fn(),
    getRawMany: jest.fn(),
    getRawOne: jest.fn(),
  };
  const entryRepository = { createQueryBuilder: jest.fn(), findOne: jest.fn() };
  const eventRepository = { find: jest.fn() };
  const dataSource = { getRepository: jest.fn() };
  const scope = { populationOf: jest.fn() };
  const members = { findMemberRefs: jest.fn(), findAccessFacts: jest.fn() };
  const people = { findRefsByIds: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    for (const method of [
      builder.select,
      builder.addSelect,
      builder.where,
      builder.andWhere,
      builder.groupBy,
      builder.addGroupBy,
      builder.orderBy,
      builder.addOrderBy,
      builder.offset,
      builder.limit,
      builder.setParameters,
    ]) {
      method.mockReturnValue(builder);
    }
    builder.getManyAndCount.mockResolvedValue([[], 0]);
    builder.getRawMany.mockResolvedValue([]);
    builder.getRawOne.mockResolvedValue({ total: 0 });
    entryRepository.createQueryBuilder.mockReturnValue(builder);
    dataSource.getRepository.mockImplementation((target: unknown) => {
      if (target === HourEntry) return entryRepository;
      if (target === HourEntryEvent) return eventRepository;
      return undefined;
    });
    scope.populationOf.mockResolvedValue(EVERYONE);
    members.findMemberRefs.mockResolvedValue([ANA_REF]);
    members.findAccessFacts.mockResolvedValue({
      registrationStatus: MemberRegistrationStatus.APPROVED,
      departmentIds: [TECH],
    });
    people.findRefsByIds.mockResolvedValue([]);
    eventRepository.find.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        HoursViewService,
        PermissionPolicy,
        { provide: DataSource, useValue: dataSource },
        { provide: HoursScopeService, useValue: scope },
        { provide: MembersService, useValue: members },
        { provide: PeopleService, useValue: people },
      ],
    }).compile();
    service = moduleRef.get(HoursViewService);
  });

  describe("listEntries", () => {
    it("lists the pending entries by default, oldest day first, with the member of each from one call to findMemberRefs", async () => {
      builder.getManyAndCount.mockResolvedValue([
        [entryOf(ENTRY_A), entryOf(ENTRY_B, { personId: GONE }), entryOf(ENTRY_C)],
        3,
      ]);

      const page = await service.listEntries(COORDINATOR, {});

      expect(scope.populationOf).toHaveBeenCalledWith(COORDINATOR, Permission.HOURS_VIEW_OTHERS);
      expect(builder.where).toHaveBeenCalledWith("entry.status = :status", {
        status: HourEntryStatus.PENDING,
      });
      expect(builder.andWhere).not.toHaveBeenCalled();
      expect(builder.orderBy).toHaveBeenCalledWith("entry.date", "ASC");
      expect(builder.addOrderBy.mock.calls).toEqual([
        ["entry.created_at", "ASC"],
        ["entry.id", "ASC"],
      ]);
      expect(builder.offset).toHaveBeenCalledWith(0);
      expect(builder.limit).toHaveBeenCalledWith(20);
      expect(members.findMemberRefs).toHaveBeenCalledTimes(1);
      expect(members.findMemberRefs).toHaveBeenCalledWith({ ids: [ANA, GONE] });
      expect(page).toMatchObject({ total: 3, page: 1, limit: 20 });
      expect(page.data.map((entry) => [entry.id, entry.member])).toEqual([
        [ENTRY_A, ANA_REF],
        [ENTRY_B, null],
        [ENTRY_C, ANA_REF],
      ]);
      expect(page.data[0]).toMatchObject({ declaredMinutes: 240, status: HourEntryStatus.PENDING });
      expect(page.data[0]).not.toHaveProperty("deletedAt");
    });

    it("filters by status, person and period, inside the population of the actor", async () => {
      scope.populationOf.mockResolvedValue(populationOf([ANA, BRUNO]));

      await service.listEntries(DIRECTOR, {
        status: HourEntryStatus.APPROVED,
        personId: ANA,
        from: "2026-03-01",
        to: "2026-03-31",
        page: 2,
        limit: 10,
      });

      expect(builder.where).toHaveBeenCalledWith("entry.status = :status", {
        status: HourEntryStatus.APPROVED,
      });
      expect(builder.andWhere.mock.calls).toEqual([
        ["entry.date >= :from", { from: "2026-03-01" }],
        ["entry.date <= :to", { to: "2026-03-31" }],
        ["entry.person_id IN (:...personIds)", { personIds: [ANA, BRUNO] }],
        ["entry.person_id = :personId", { personId: ANA }],
      ]);
      expect(builder.offset).toHaveBeenCalledWith(10);
      expect(builder.limit).toHaveBeenCalledWith(10);
    });

    it("answers an empty page without querying when the population is nobody", async () => {
      scope.populationOf.mockResolvedValue(populationOf([]));

      await expect(service.listEntries(DIRECTOR, { page: 2 })).resolves.toEqual({
        data: [],
        total: 0,
        page: 2,
        limit: 20,
      });
      expect(dataSource.getRepository).not.toHaveBeenCalled();
      expect(members.findMemberRefs).not.toHaveBeenCalled();
    });

    it("throws INVALID_PERIOD before querying", async () => {
      const failure = await httpFailure(
        service.listEntries(COORDINATOR, { from: "2026-03-31", to: "2026-03-01" }),
      );

      expect(failure.getStatus()).toBe(400);
      expect(codeOf(failure)).toBe("INVALID_PERIOD");
      expect(scope.populationOf).not.toHaveBeenCalled();
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });
  });

  describe("getHistory", () => {
    it("reads the entry with withDeleted: a removed entry keeps its history readable", async () => {
      entryRepository.findOne.mockResolvedValue(entryOf(ENTRY_A, { deletedAt: REVIEWED_AT }));
      eventRepository.find.mockResolvedValue([
        eventOf(EVENT_1),
        eventOf(EVENT_2, {
          type: HourEntryEventType.REMOVED,
          fromStatus: HourEntryStatus.PENDING,
          toStatus: null,
          fromMinutes: 240,
          toMinutes: null,
        }),
      ]);

      const history = await service.getHistory(ENTRY_A.toUpperCase(), MEMBER);

      expect(entryRepository.findOne).toHaveBeenCalledWith({
        where: { id: ENTRY_A.toUpperCase() },
        withDeleted: true,
      });
      expect(history.map((event) => event.type)).toEqual([
        HourEntryEventType.CREATED,
        HourEntryEventType.REMOVED,
      ]);
    });

    it("throws HOUR_ENTRY_NOT_FOUND for an unknown entry, before the scope", async () => {
      entryRepository.findOne.mockResolvedValue(null);

      const failure = await httpFailure(service.getHistory(ENTRY_A, OTHER_MEMBER));

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("HOUR_ENTRY_NOT_FOUND");
      expect(members.findAccessFacts).not.toHaveBeenCalled();
      expect(eventRepository.find).not.toHaveBeenCalled();
    });

    it("lets the person of the entry read it, and hours.viewOthers read others' within its scope", async () => {
      entryRepository.findOne.mockResolvedValue(entryOf(ENTRY_A));

      for (const actor of [MEMBER, DIRECTOR, COORDINATOR, SUPERADMIN]) {
        await expect(service.getHistory(ENTRY_A, actor)).resolves.toEqual([]);
      }
      expect(members.findAccessFacts).toHaveBeenCalledWith(ANA);
    });

    it("throws FORBIDDEN_SCOPE to a member for someone else's entry and to a director outside her department", async () => {
      entryRepository.findOne.mockResolvedValue(entryOf(ENTRY_A));

      for (const actor of [OTHER_MEMBER, DIRECTOR_OF_OTHER_DEPARTMENT]) {
        const failure = await httpFailure(service.getHistory(ENTRY_A, actor));
        expect(failure.getStatus()).toBe(403);
        expect(codeOf(failure)).toBe("FORBIDDEN_SCOPE");
      }

      members.findAccessFacts.mockResolvedValue({ registrationStatus: null, departmentIds: [] });
      const withoutDepartment = await httpFailure(service.getHistory(ENTRY_A, DIRECTOR));
      expect(codeOf(withoutDepartment)).toBe("FORBIDDEN_SCOPE");
      expect(eventRepository.find).not.toHaveBeenCalled();
    });

    it("answers the events in the order created_at, id, with the actor named by findRefsByIds, and null for one no longer found", async () => {
      entryRepository.findOne.mockResolvedValue(entryOf(ENTRY_A));
      eventRepository.find.mockResolvedValue([
        eventOf(EVENT_1),
        eventOf(EVENT_2, {
          type: HourEntryEventType.ADJUSTED,
          actorId: COORDINATOR.id,
          fromStatus: HourEntryStatus.PENDING,
          toStatus: HourEntryStatus.ADJUSTED,
          fromMinutes: 240,
          toMinutes: 120,
          note: "Duas horas.",
          createdAt: REVIEWED_AT,
          updatedAt: REVIEWED_AT,
        }),
        eventOf(EVENT_3, { actorId: GONE }),
      ]);
      people.findRefsByIds.mockResolvedValue([
        { id: ANA, name: "Ana Souza" },
        { id: COORDINATOR.id, name: "Carla Coordenadora" },
      ]);

      const history = await service.getHistory(ENTRY_A, COORDINATOR);

      expect(eventRepository.find).toHaveBeenCalledWith({
        where: { hourEntryId: ENTRY_A },
        order: { createdAt: "ASC", id: "ASC" },
      });
      expect(people.findRefsByIds).toHaveBeenCalledTimes(1);
      expect(people.findRefsByIds).toHaveBeenCalledWith([ANA, COORDINATOR.id, GONE]);
      expect(history).toEqual([
        {
          id: EVENT_1,
          hourEntryId: ENTRY_A,
          type: HourEntryEventType.CREATED,
          actor: { id: ANA, name: "Ana Souza" },
          fromStatus: null,
          toStatus: HourEntryStatus.PENDING,
          fromMinutes: null,
          toMinutes: 240,
          note: null,
          createdAt: CREATED_AT,
        },
        {
          id: EVENT_2,
          hourEntryId: ENTRY_A,
          type: HourEntryEventType.ADJUSTED,
          actor: { id: COORDINATOR.id, name: "Carla Coordenadora" },
          fromStatus: HourEntryStatus.PENDING,
          toStatus: HourEntryStatus.ADJUSTED,
          fromMinutes: 240,
          toMinutes: 120,
          note: "Duas horas.",
          createdAt: REVIEWED_AT,
        },
        expect.objectContaining({ id: EVENT_3, actor: null }),
      ]);
    });
  });
});
