import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { Brackets, DataSource, WhereExpressionBuilder } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { Person } from "../entities/person.entity";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";
import { StudentListEntryRow } from "../services/student-response.mapper";
import { STUDENT_LIST_FILTER_MAX_IDS, StudentsService } from "../services/students.service";

const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";
const OTHER_STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000002";

// 22:30 in São Paulo on 2026-10-01 is already 2026-10-02 in UTC: the age uses the São Paulo day.
const NOW = new Date("2026-10-02T01:30:00.000Z");
const REGISTERED_AT = new Date("2026-03-03T13:00:00.000Z");

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

describe("StudentsService.listStudentEntries", () => {
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

  function conditions(): Array<[string, Record<string, unknown> | undefined]> {
    return builder.andWhere.mock.calls.map((call) => [call[0], call[1]]);
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

    // useMocker: the other dependencies of StudentsService play no part in listStudentEntries.
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

  it("answers an empty page without querying when onlyIds is empty or has no uuid", async () => {
    await expect(service.listStudentEntries({ onlyIds: [] }, {})).resolves.toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    await expect(
      service.listStudentEntries({ onlyIds: ["not-a-uuid"] }, { page: 3, limit: 5 }),
    ).resolves.toEqual({ data: [], total: 0, page: 3, limit: 5 });

    expect(dataSource.getRepository).not.toHaveBeenCalled();
  });

  it("throws when onlyIds or excludeIds pass STUDENT_LIST_FILTER_MAX_IDS", async () => {
    const tooMany = Array.from({ length: STUDENT_LIST_FILTER_MAX_IDS + 1 }, () => STUDENT_ID);

    await expect(service.listStudentEntries({ onlyIds: tooMany }, {})).rejects.toThrow(
      `listStudentEntries takes at most ${STUDENT_LIST_FILTER_MAX_IDS} ids`,
    );
    await expect(service.listStudentEntries({ excludeIds: tooMany }, {})).rejects.toThrow(
      `listStudentEntries takes at most ${STUDENT_LIST_FILTER_MAX_IDS} ids`,
    );
    expect(dataSource.getRepository).not.toHaveBeenCalled();

    // The cap itself is accepted: it fails loudly only past it.
    const atCap = Array.from({ length: STUDENT_LIST_FILTER_MAX_IDS }, () => STUDENT_ID);
    await expect(service.listStudentEntries({ excludeIds: atCap }, {})).resolves.toMatchObject({
      total: 0,
    });
  });

  it("ignores ids that are not uuids in excludeIds", async () => {
    await service.listStudentEntries({ excludeIds: ["not-a-uuid", OTHER_STUDENT_ID] }, {});
    await service.listStudentEntries({ excludeIds: ["not-a-uuid"] }, {});

    const excluded = conditions().filter(([sql]) => sql.includes(":excludeIds"));
    // One array parameter, never one parameter per id; nothing valid left adds no condition.
    expect(excluded).toEqual([
      ["NOT (person.id = ANY(:excludeIds::uuid[]))", { excludeIds: [OTHER_STUDENT_ID] }],
    ]);
  });

  it("passes onlyIds as one array parameter and leaves the archived out unless asked", async () => {
    await service.listStudentEntries({ onlyIds: [STUDENT_ID, "x"] }, {});

    expect(conditions()).toEqual([
      ["student_profile.archived_at IS NULL", undefined],
      ["person.id = ANY(:onlyIds::uuid[])", { onlyIds: [STUDENT_ID] }],
    ]);
    expect(builder.where).toHaveBeenCalledWith("person.deleted_at IS NULL");
    expect(builder.orderBy).toHaveBeenCalledWith("person.name", "ASC");
    expect(builder.addOrderBy).toHaveBeenCalledWith("person.id", "ASC");

    builder.andWhere.mockClear();
    await service.listStudentEntries({ onlyIds: [STUDENT_ID], includeArchived: true }, {});
    expect(conditions().map(([sql]) => sql)).toEqual(["person.id = ANY(:onlyIds::uuid[])"]);
  });

  it("ages every student against the same day in America/Sao_Paulo, from the clock", async () => {
    builder.getRawMany.mockResolvedValue([
      row(),
      row({
        id: OTHER_STUDENT_ID,
        name: "Ana",
        birthDate: "1958-10-01",
        phone: null,
        email: null,
      }),
    ]);
    builder.getCount.mockResolvedValue(12);

    const page = await service.listStudentEntries(
      { onlyIds: [STUDENT_ID, OTHER_STUDENT_ID], search: "a" },
      { page: 2, limit: 10 },
    );

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
      total: 12,
      page: 2,
      limit: 10,
    });
    expect(builder.offset).toHaveBeenCalledWith(10);
    expect(builder.limit).toHaveBeenCalledWith(10);
    expect(searchOf()).toEqual([
      [
        "where",
        `(public.search_normalize(person.name) LIKE public.search_normalize(:studentListSearch) ESCAPE '\\')`,
        { studentListSearch: "%a%" },
      ],
    ]);
  });

  it("searches the e-mail and the phone only with searchContact", async () => {
    await service.listStudentEntries({ search: "98888" }, {});
    expect(searchOf().map(([method, sql]) => [method, sql.includes("person.email")])).toEqual([
      ["where", false],
    ]);

    builder.andWhere.mockClear();
    await service.listStudentEntries({ search: "98888", searchContact: true }, {});
    expect(searchOf()).toEqual([
      ["where", expect.stringContaining("person.email"), { studentListSearch: "%98888%" }],
      [
        "orWhere",
        "person.phone_digits LIKE :studentListPhoneSearch",
        { studentListPhoneSearch: "%98888%" },
      ],
    ]);
  });

  it("throws when a student has no birth date, a broken invariant of the registration", async () => {
    builder.getRawMany.mockResolvedValue([row({ birthDate: null })]);

    await expect(service.listStudentEntries({ onlyIds: [STUDENT_ID] }, {})).rejects.toThrow(
      `Student ${STUDENT_ID} has no birthDate`,
    );
  });
});
