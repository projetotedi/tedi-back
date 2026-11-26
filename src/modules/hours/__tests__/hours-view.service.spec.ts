import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { LessonsService } from "@modules/lessons/services/lessons.service";
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
import { EVERYONE, peoplePopulation } from "../services/hour-entry-queries";
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
  const lessons = { findLessonSummaries: jest.fn().mockResolvedValue([]) };

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
        { provide: LessonsService, useValue: lessons },
      ],
    }).compile();
    service = moduleRef.get(HoursViewService);
  });

  describe("getOverview", () => {
    const anaRow = {
      personId: ANA,
      entries: 3,
      declaredMinutes: 420,
      bankMinutes: 120,
      pendingEntries: 1,
      pendingMinutes: 90,
    };
    const goneRow = {
      personId: GONE,
      entries: 1,
      declaredMinutes: 60,
      bankMinutes: 0,
      pendingEntries: 0,
      pendingMinutes: 0,
    };
    const summaryRows = [
      {
        status: "pending",
        category: "planning",
        entries: 1,
        declaredMinutes: 90,
        validatedMinutes: 0,
      },
      {
        status: "adjusted",
        category: "meeting",
        entries: 1,
        declaredMinutes: 240,
        validatedMinutes: 120,
      },
      {
        status: "rejected",
        category: "planning",
        entries: 2,
        declaredMinutes: 150,
        validatedMinutes: 0,
      },
    ];

    beforeEach(() => {
      builder.getRawMany
        .mockResolvedValueOnce(summaryRows)
        .mockResolvedValueOnce([anaRow, goneRow]);
      builder.getRawOne.mockResolvedValue({ total: 2 });
    });

    it("throws INVALID_PERIOD before resolving the scope or reading anything", async () => {
      const failure = await httpFailure(
        service.getOverview(COORDINATOR, { from: "2026-03-31", to: "2026-03-01" }),
      );

      expect(failure.getStatus()).toBe(400);
      expect(codeOf(failure)).toBe("INVALID_PERIOD");
      expect(scope.populationOf).not.toHaveBeenCalled();
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it("reads every entry for coordination without search: no person filter", async () => {
      await service.getOverview(COORDINATOR, {});

      expect(scope.populationOf).toHaveBeenCalledWith(
        COORDINATOR,
        Permission.HOURS_VIEW_OTHERS,
        undefined,
      );
      expect(builder.andWhere).not.toHaveBeenCalled();
      expect(entryRepository.createQueryBuilder).toHaveBeenCalledTimes(3);
    });

    it("restricts the totals and the members to the population of the scope service, with the same period", async () => {
      scope.populationOf.mockResolvedValue(peoplePopulation([ANA, BRUNO]));

      await service.getOverview(DIRECTOR, { from: "2026-03-01", to: "2026-03-31", search: "a" });

      expect(scope.populationOf).toHaveBeenCalledWith(DIRECTOR, Permission.HOURS_VIEW_OTHERS, "a");
      const filters = [
        ["entry.date >= :from", { from: "2026-03-01" }],
        ["entry.date <= :to", { to: "2026-03-31" }],
        ["entry.person_id IN (:...personIds)", { personIds: [ANA, BRUNO] }],
      ];
      expect(builder.andWhere.mock.calls).toEqual([...filters, ...filters, ...filters]);
    });

    it("answers zero totals and an empty page, without querying the entries, when the population is nobody", async () => {
      scope.populationOf.mockResolvedValue(peoplePopulation([]));

      const overview = await service.getOverview(DIRECTOR, { from: "2026-03-01", page: 3 });

      expect(overview.members).toEqual({ data: [], total: 0, page: 3, limit: 20 });
      expect(overview.summary).toMatchObject({ from: "2026-03-01", to: null, bankMinutes: 0 });
      expect(overview.summary.byStatus.every((total) => total.entries === 0)).toBe(true);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
      expect(members.findMemberRefs).not.toHaveBeenCalled();
    });

    it("orders the members by pending minutes, then declared minutes, then person id, and paginates in the query", async () => {
      await service.getOverview(COORDINATOR, { page: 2, limit: 10 });

      expect(builder.select).toHaveBeenCalledWith("entry.person_id", "personId");
      expect(builder.addSelect.mock.calls).toEqual(
        expect.arrayContaining([
          ["COUNT(*)::int", "entries"],
          ["COALESCE(SUM(entry.declared_minutes), 0)::int", "declaredMinutes"],
          [
            "COALESCE(SUM(entry.validated_minutes) FILTER (WHERE entry.status IN (:...bankStatuses)), 0)::int",
            "bankMinutes",
          ],
          ["(COUNT(*) FILTER (WHERE entry.status = :pending))::int", "pendingEntries"],
          [
            "COALESCE(SUM(entry.declared_minutes) FILTER (WHERE entry.status = :pending), 0)::int",
            "pendingMinutes",
          ],
        ]),
      );
      expect(builder.setParameters).toHaveBeenCalledWith({
        pending: HourEntryStatus.PENDING,
        bankStatuses: [HourEntryStatus.APPROVED, HourEntryStatus.ADJUSTED],
      });
      expect(builder.groupBy).toHaveBeenCalledWith("entry.person_id");
      expect(builder.orderBy).toHaveBeenCalledWith('"pendingMinutes"', "DESC");
      expect(builder.addOrderBy.mock.calls).toEqual([
        ['"declaredMinutes"', "DESC"],
        ["entry.person_id", "ASC"],
      ]);
      expect(builder.offset).toHaveBeenCalledWith(10);
      expect(builder.limit).toHaveBeenCalledWith(10);
    });

    it("counts the members with COUNT(DISTINCT person_id) under the same filters", async () => {
      const overview = await service.getOverview(COORDINATOR, {});

      expect(builder.select).toHaveBeenCalledWith("COUNT(DISTINCT entry.person_id)::int", "total");
      expect(builder.getRawOne).toHaveBeenCalledTimes(1);
      expect(overview.members).toMatchObject({ total: 2, page: 1, limit: 20 });
    });

    it("names the members of the page with one call to findMemberRefs, and answers null for a person it no longer finds", async () => {
      const overview = await service.getOverview(COORDINATOR, {});

      expect(members.findMemberRefs).toHaveBeenCalledTimes(1);
      expect(members.findMemberRefs).toHaveBeenCalledWith({ ids: [ANA, GONE] });
      expect(overview.members.data).toEqual([
        { ...anaRow, member: ANA_REF },
        { ...goneRow, member: null },
      ]);
    });

    it("does not call findMemberRefs for an empty page", async () => {
      builder.getRawMany.mockReset();
      builder.getRawMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const overview = await service.getOverview(COORDINATOR, { page: 9 });

      expect(overview.members.data).toEqual([]);
      expect(members.findMemberRefs).not.toHaveBeenCalled();
    });

    it("folds the totals with buildHoursSummary, echoing the period", async () => {
      const overview = await service.getOverview(COORDINATOR, { from: "2026-03-01" });

      expect(builder.groupBy).toHaveBeenCalledWith("entry.status");
      expect(builder.addGroupBy).toHaveBeenCalledWith("entry.category");
      expect(overview.summary).toMatchObject({ from: "2026-03-01", to: null, bankMinutes: 120 });
      expect(overview.summary.byStatus).toEqual([
        { status: "pending", entries: 1, declaredMinutes: 90, validatedMinutes: 0 },
        { status: "approved", entries: 0, declaredMinutes: 0, validatedMinutes: 0 },
        { status: "adjusted", entries: 1, declaredMinutes: 240, validatedMinutes: 120 },
        { status: "rejected", entries: 2, declaredMinutes: 150, validatedMinutes: 0 },
      ]);
    });

    it("throws on a member total that is not a whole number instead of publishing it", async () => {
      builder.getRawMany.mockReset();
      builder.getRawMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...anaRow, pendingMinutes: "90" }]);
      await expect(service.getOverview(COORDINATOR, {})).rejects.toThrow(
        "Hours overview row with a total that is not a whole number.",
      );

      builder.getRawMany.mockReset();
      builder.getRawMany.mockResolvedValue([]);
      for (const counted of [undefined, { total: "2" }, { total: 1.5 }]) {
        builder.getRawOne.mockResolvedValueOnce(counted);
        await expect(service.getOverview(COORDINATOR, {})).rejects.toThrow(
          "Hours overview count that is not a whole number.",
        );
      }
    });
  });

  describe("getMemberHours", () => {
    beforeEach(() => {
      builder.getManyAndCount.mockResolvedValue([[entryOf(ENTRY_A), entryOf(ENTRY_B)], 12]);
    });

    it("throws INVALID_PERIOD before reading the member", async () => {
      const failure = await httpFailure(
        service.getMemberHours(ANA, COORDINATOR, { from: "2026-03-31", to: "2026-03-01" }),
      );

      expect(codeOf(failure)).toBe("INVALID_PERIOD");
      expect(members.findMemberRefs).not.toHaveBeenCalled();
    });

    it("throws MEMBER_NOT_FOUND when findMemberRefs does not find the person, before the scope", async () => {
      members.findMemberRefs.mockResolvedValue([]);

      const failure = await httpFailure(
        service.getMemberHours(ANA.toUpperCase(), DIRECTOR_OF_OTHER_DEPARTMENT, {}),
      );

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "MEMBER_NOT_FOUND",
        message: "Member not found.",
      });
      expect(members.findMemberRefs).toHaveBeenCalledWith({ ids: [ANA.toUpperCase()] });
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it("throws FORBIDDEN_SCOPE to a director for a member of another department or without department", async () => {
      const outside = await httpFailure(
        service.getMemberHours(ANA, DIRECTOR_OF_OTHER_DEPARTMENT, {}),
      );
      expect(outside.getStatus()).toBe(403);
      expect(codeOf(outside)).toBe("FORBIDDEN_SCOPE");

      members.findMemberRefs.mockResolvedValue([{ ...ANA_REF, department: null }]);
      const withoutDepartment = await httpFailure(service.getMemberHours(ANA, DIRECTOR, {}));
      expect(codeOf(withoutDepartment)).toBe("FORBIDDEN_SCOPE");
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it("lets coordination read anyone, and a director a member of her own department, herself included", async () => {
      for (const actor of [COORDINATOR, SUPERADMIN, DIRECTOR]) {
        await expect(service.getMemberHours(ANA, actor, {})).resolves.toMatchObject({
          member: ANA_REF,
        });
      }

      const directorRef = { id: DIRECTOR.id, name: "Diego", department: ANA_REF.department };
      members.findMemberRefs.mockResolvedValue([directorRef]);
      await expect(service.getMemberHours(DIRECTOR.id, DIRECTOR, {})).resolves.toMatchObject({
        member: directorRef,
      });

      members.findMemberRefs.mockResolvedValue([{ ...ANA_REF, department: null }]);
      await expect(service.getMemberHours(ANA, COORDINATOR, {})).resolves.toMatchObject({
        member: { department: null },
      });
    });

    it("answers the member, the summary and the page of entries of the period, newest day first", async () => {
      builder.getRawMany.mockResolvedValue([
        {
          status: "adjusted",
          category: "meeting",
          entries: 1,
          declaredMinutes: 240,
          validatedMinutes: 120,
        },
      ]);

      const hours = await service.getMemberHours(ANA, COORDINATOR, {
        from: "2026-03-01",
        to: "2026-03-31",
        page: 2,
        limit: 5,
      });

      const filters = [
        ["entry.date >= :from", { from: "2026-03-01" }],
        ["entry.date <= :to", { to: "2026-03-31" }],
        ["entry.person_id IN (:...personIds)", { personIds: [ANA] }],
      ];
      expect(builder.andWhere.mock.calls).toEqual([...filters, ...filters]);
      expect(builder.orderBy).toHaveBeenCalledWith("entry.date", "DESC");
      expect(builder.addOrderBy.mock.calls).toEqual([
        ["entry.created_at", "DESC"],
        ["entry.id", "DESC"],
      ]);
      expect(builder.offset).toHaveBeenCalledWith(5);
      expect(builder.limit).toHaveBeenCalledWith(5);
      expect(hours.member).toEqual(ANA_REF);
      expect(hours.summary).toMatchObject({
        from: "2026-03-01",
        to: "2026-03-31",
        bankMinutes: 120,
      });
      expect(hours.entries).toMatchObject({ total: 12, page: 2, limit: 5 });
      expect(hours.entries.data.map((entry) => entry.id)).toEqual([ENTRY_A, ENTRY_B]);
      expect(hours.entries.data[0]).not.toHaveProperty("deletedAt");
    });
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
      scope.populationOf.mockResolvedValue(peoplePopulation([ANA, BRUNO]));

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
      scope.populationOf.mockResolvedValue(peoplePopulation([]));

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
