import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { Brackets, DataSource, WhereExpressionBuilder } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { ANY_ACCESSIBILITY_NEED } from "../dto/list-students-query.dto";
import { Person } from "../entities/person.entity";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";
import { StudentListSort } from "../enums/student-list-sort.enum";
import { StudentListEntryRow } from "../services/student-response.mapper";
import { StudentsService } from "../services/students.service";

const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";
const OTHER_STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000002";

// 22:30 in São Paulo on 2026-10-01 is already 2026-10-02 in UTC: the age uses the São Paulo day.
const NOW = new Date("2026-10-02T01:30:00.000Z");
const REGISTERED_AT = new Date("2026-03-03T13:00:00.000Z");

const ACCESSIBILITY_NEED_CONDITION =
  "student_profile.accessibility_need IN (:...accessibilityNeeds)";

function row(overrides: Partial<StudentListEntryRow> = {}): StudentListEntryRow {
  return {
    id: STUDENT_ID,
    name: "Maria Silva Santos",
    birthDate: "1958-10-02",
    phone: "43999990000",
    email: "maria.santos@example.com",
    accessibilityNeed: AccessibilityNeed.VISUAL,
    createdAt: REGISTERED_AT,
    ...overrides,
  };
}

describe("StudentsService.listStudents", () => {
  let service: StudentsService;

  /** A chainable query builder: every method returns it; the page and the count resolve apart. */
  const builder = {
    innerJoin: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    clone: jest.fn(),
    offset: jest.fn(),
    limit: jest.fn(),
    getParameters: jest.fn(),
    getRawMany: jest.fn(),
    getCount: jest.fn(),
  };
  const personRepository = { createQueryBuilder: jest.fn() };
  const dataSource = { getRepository: jest.fn() };
  const clock = { now: jest.fn() };

  /** The plain conditions (the search, a Brackets group, is read by `searchOf`). */
  function conditions(): Array<[string, Record<string, unknown> | undefined]> {
    return builder.andWhere.mock.calls
      .filter((call) => typeof call[0] === "string")
      .map((call) => [call[0], call[1]]);
  }

  function order(): Array<[string, string, string]> {
    return [
      ...builder.orderBy.mock.calls.map((call): [string, string, string] => [
        "orderBy",
        call[0],
        call[1],
      ]),
      ...builder.addOrderBy.mock.calls.map((call): [string, string, string] => [
        "addOrderBy",
        call[0],
        call[1],
      ]),
    ];
  }

  /** The search: each where and orWhere of the one Brackets group it adds, or [] without one. */
  function searchOf(): Array<[string, string, Record<string, unknown>]> {
    const groups = builder.andWhere.mock.calls
      .map((call): unknown => call[0])
      .filter((condition): condition is Brackets => condition instanceof Brackets);
    expect(groups.length).toBeLessThanOrEqual(1);
    if (groups.length === 0) return [];

    const calls: Array<[string, string, Record<string, unknown>]> = [];
    const recorder = {
      where: (sql: string, parameters: Record<string, unknown>) => {
        calls.push(["where", sql, parameters]);
      },
      orWhere: (sql: string, parameters: Record<string, unknown>) => {
        calls.push(["orWhere", sql, parameters]);
      },
    };
    groups[0].whereFactory(recorder as unknown as WhereExpressionBuilder);
    return calls;
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    for (const method of [
      builder.innerJoin,
      builder.select,
      builder.addSelect,
      builder.where,
      builder.andWhere,
      builder.orderBy,
      builder.addOrderBy,
      builder.clone,
      builder.offset,
      builder.limit,
    ]) {
      method.mockReturnValue(builder);
    }
    builder.getParameters.mockReturnValue({});
    builder.getRawMany.mockResolvedValue([]);
    builder.getCount.mockResolvedValue(0);
    personRepository.createQueryBuilder.mockReturnValue(builder);
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === Person ? personRepository : undefined,
    );
    clock.now.mockReturnValue(NOW);

    // useMocker: the other dependencies of StudentsService play no part in listStudents.
    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentsService,
        { provide: DataSource, useValue: dataSource },
        { provide: Clock, useValue: clock },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    service = moduleRef.get(StudentsService);
  });

  it("lists the students not archived, by name and id, paginated, by default", async () => {
    builder.getCount.mockResolvedValue(7);

    await expect(service.listStudents({})).resolves.toEqual({
      data: [],
      total: 7,
      page: 1,
      limit: 20,
    });

    expect(builder.where).toHaveBeenCalledWith("person.deleted_at IS NULL");
    expect(conditions()).toEqual([["student_profile.archived_at IS NULL", undefined]]);
    expect(searchOf()).toEqual([]);
    expect(order()).toEqual([
      ["orderBy", "person.name", "ASC"],
      ["addOrderBy", "person.id", "ASC"],
    ]);
    expect(builder.offset).toHaveBeenCalledWith(0);
    expect(builder.limit).toHaveBeenCalledWith(20);

    builder.andWhere.mockClear();
    await service.listStudents({ archived: false, sort: StudentListSort.NAME, page: 3, limit: 5 });
    expect(conditions()).toEqual([["student_profile.archived_at IS NULL", undefined]]);
    expect(builder.offset).toHaveBeenLastCalledWith(10);
    expect(builder.limit).toHaveBeenLastCalledWith(5);
  });

  it("lists only the archived students with archived=true", async () => {
    await service.listStudents({ archived: true });

    expect(conditions()).toEqual([["student_profile.archived_at IS NOT NULL", undefined]]);
  });

  it("passes ids as one array parameter", async () => {
    await service.listStudents({ ids: [STUDENT_ID, OTHER_STUDENT_ID] });

    expect(conditions()).toEqual([
      ["student_profile.archived_at IS NULL", undefined],
      ["person.id = ANY(:ids::uuid[])", { ids: [STUDENT_ID, OTHER_STUDENT_ID] }],
    ]);
  });

  it("expands any to every category but none, keeps a union with the other values, and ignores an empty list", async () => {
    const accessibilityNeedsOf = async (
      filter: Parameters<StudentsService["listStudents"]>[0]["accessibilityNeed"],
    ): Promise<unknown> => {
      builder.andWhere.mockClear();
      await service.listStudents({ accessibilityNeed: filter });
      const condition = conditions().find(([sql]) => sql === ACCESSIBILITY_NEED_CONDITION);
      return condition?.[1];
    };
    const everyNeedButNone = [
      AccessibilityNeed.VISUAL,
      AccessibilityNeed.HEARING,
      AccessibilityNeed.MOTOR,
      AccessibilityNeed.COGNITIVE,
      AccessibilityNeed.OTHER,
    ];

    await expect(accessibilityNeedsOf([ANY_ACCESSIBILITY_NEED])).resolves.toEqual({
      accessibilityNeeds: everyNeedButNone,
    });
    await expect(
      accessibilityNeedsOf([ANY_ACCESSIBILITY_NEED, AccessibilityNeed.NONE]),
    ).resolves.toEqual({ accessibilityNeeds: [...everyNeedButNone, AccessibilityNeed.NONE] });
    await expect(
      accessibilityNeedsOf([AccessibilityNeed.VISUAL, ANY_ACCESSIBILITY_NEED]),
    ).resolves.toEqual({ accessibilityNeeds: everyNeedButNone });
    await expect(accessibilityNeedsOf([AccessibilityNeed.VISUAL])).resolves.toEqual({
      accessibilityNeeds: [AccessibilityNeed.VISUAL],
    });
    await expect(
      accessibilityNeedsOf([AccessibilityNeed.NONE, AccessibilityNeed.HEARING]),
    ).resolves.toEqual({ accessibilityNeeds: [AccessibilityNeed.NONE, AccessibilityNeed.HEARING] });
    // An empty list (accessibilityNeed=) filters nothing and never builds an IN ().
    await expect(accessibilityNeedsOf([])).resolves.toBeUndefined();
    await expect(accessibilityNeedsOf(undefined)).resolves.toBeUndefined();
  });

  it("orders by the student registration, newest first, with sort=createdAt", async () => {
    await service.listStudents({ sort: StudentListSort.CREATED_AT });

    expect(order()).toEqual([
      ["orderBy", "student_profile.created_at", "DESC"],
      ["addOrderBy", "person.id", "ASC"],
    ]);
  });

  it("maps each row to the item with birthDate, email, createdAt and the age of today in America/Sao_Paulo", async () => {
    builder.getRawMany.mockResolvedValue([
      row(),
      row({ id: OTHER_STUDENT_ID, name: "Ana", birthDate: "1958-10-01", phone: null, email: null }),
    ]);
    builder.getCount.mockResolvedValue(2);

    const page = await service.listStudents({ page: 1, limit: 10 });

    expect(builder.addSelect).toHaveBeenCalledWith("person.email", "email");
    expect(builder.addSelect).toHaveBeenCalledWith("student_profile.created_at", "createdAt");
    expect(clock.now).toHaveBeenCalledTimes(1);
    // São Paulo day 2026-10-01: born 1958-10-02 is 67 still, born 1958-10-01 is 68 today.
    expect(page).toEqual({
      data: [
        {
          id: STUDENT_ID,
          name: "Maria Silva Santos",
          birthDate: "1958-10-02",
          age: 67,
          phone: "43999990000",
          email: "maria.santos@example.com",
          accessibilityNeed: AccessibilityNeed.VISUAL,
          createdAt: REGISTERED_AT,
        },
        {
          id: OTHER_STUDENT_ID,
          name: "Ana",
          birthDate: "1958-10-01",
          age: 68,
          phone: null,
          email: null,
          accessibilityNeed: AccessibilityNeed.VISUAL,
          createdAt: REGISTERED_AT,
        },
      ],
      total: 2,
      page: 1,
      limit: 10,
    });
  });

  it("searches with contact", async () => {
    await service.listStudents({ search: "(11) 98888" });

    expect(searchOf()).toEqual([
      [
        "where",
        expect.stringContaining("public.search_normalize(person.email)"),
        { studentListSearch: "%(11) 98888%" },
      ],
      [
        "orWhere",
        "person.phone_digits LIKE :studentListPhoneSearch",
        { studentListPhoneSearch: "%1198888%" },
      ],
    ]);
  });
});
