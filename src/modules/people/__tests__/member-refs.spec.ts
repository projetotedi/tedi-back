import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Person } from "../entities/person.entity";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { MembersService } from "../services/members.service";

const PERSON_ID = "01999a3e-7c1b-7000-8000-000000000001";
const OTHER_PERSON_ID = "01999a3e-7c1b-7000-8000-000000000002";
const DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000001";

const MEMBER_PREDICATE = "(person.role IS NOT NULL OR member_profile.id IS NOT NULL)";

describe("MembersService.findMemberRefs", () => {
  let service: MembersService;

  /** A chainable query builder: every method returns it, and getRawMany resolves the rows. */
  const builder = {
    leftJoin: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    getParameters: jest.fn(),
    getRawMany: jest.fn(),
  };
  const personRepository = { createQueryBuilder: jest.fn() };
  const dataSource = { getRepository: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    for (const method of [
      builder.leftJoin,
      builder.select,
      builder.addSelect,
      builder.where,
      builder.andWhere,
      builder.orderBy,
      builder.addOrderBy,
    ]) {
      method.mockReturnValue(builder);
    }
    builder.getParameters.mockReturnValue({});
    builder.getRawMany.mockResolvedValue([]);
    personRepository.createQueryBuilder.mockReturnValue(builder);
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === Person ? personRepository : undefined,
    );

    // useMocker: the other dependencies of MembersService play no part in findMemberRefs.
    const moduleRef = await Test.createTestingModule({
      providers: [MembersService, { provide: DataSource, useValue: dataSource }],
    })
      .useMocker(() => ({}))
      .compile();
    service = moduleRef.get(MembersService);
  });

  it("throws when no filter is given: the whole team is never read by accident", async () => {
    for (const filter of [{}, { search: "   " }, { search: "" }]) {
      await expect(service.findMemberRefs(filter)).rejects.toThrow(
        "findMemberRefs needs ids, departmentIds or search.",
      );
    }
    expect(dataSource.getRepository).not.toHaveBeenCalled();
  });

  it("answers [] without querying for an empty ids or departmentIds", async () => {
    for (const filter of [
      { ids: [] },
      { departmentIds: [] },
      { ids: [PERSON_ID], departmentIds: [] },
      { departmentIds: [], search: "Ana" },
    ]) {
      await expect(service.findMemberRefs(filter)).resolves.toEqual([]);
    }
    expect(dataSource.getRepository).not.toHaveBeenCalled();
  });

  it("leaves out ids that are not uuids, and answers [] without querying when none is left", async () => {
    await expect(service.findMemberRefs({ ids: ["not-a-uuid", "42"] })).resolves.toEqual([]);
    expect(dataSource.getRepository).not.toHaveBeenCalled();

    await service.findMemberRefs({ ids: ["not-a-uuid", PERSON_ID, OTHER_PERSON_ID] });

    expect(builder.andWhere.mock.calls).toEqual([
      ["person.id IN (:...ids)", { ids: [PERSON_ID, OTHER_PERSON_ID] }],
    ]);
  });

  it("reads the members of GET /members with the department of the approved profile only, ordered by name and id", async () => {
    await service.findMemberRefs({ ids: [PERSON_ID] });

    expect(builder.leftJoin.mock.calls).toEqual([
      [expect.any(Function), "member_profile", "member_profile.person_id = person.id"],
      [
        expect.any(Function),
        "department",
        "department.id = member_profile.department_id AND member_profile.registration_status = :approved",
        { approved: MemberRegistrationStatus.APPROVED },
      ],
    ]);
    expect(builder.where).toHaveBeenCalledWith(MEMBER_PREDICATE);
    expect(builder.orderBy).toHaveBeenCalledWith("person.name", "ASC");
    expect(builder.addOrderBy).toHaveBeenCalledWith("person.id", "ASC");
  });

  it("filters by department through the approved profile, and searches the name and the RA, together with the ids", async () => {
    await service.findMemberRefs({
      ids: [PERSON_ID],
      departmentIds: [DEPARTMENT_ID],
      search: "  Ána  ",
    });

    expect(builder.andWhere.mock.calls).toEqual([
      ["person.id IN (:...ids)", { ids: [PERSON_ID] }],
      [
        "member_profile.registration_status = :approved AND member_profile.department_id IN (:...departmentIds)",
        { approved: MemberRegistrationStatus.APPROVED, departmentIds: [DEPARTMENT_ID] },
      ],
      [
        "(public.search_normalize(person.name) LIKE public.search_normalize(:textSearchTerm) ESCAPE '\\' OR public.search_normalize(person.ra) LIKE public.search_normalize(:textSearchTerm) ESCAPE '\\')",
        { textSearchTerm: "%Ána%" },
      ],
    ]);
  });

  it("maps the department only when the row has one", async () => {
    builder.getRawMany.mockResolvedValue([
      {
        id: PERSON_ID,
        name: "Ana Souza",
        departmentId: DEPARTMENT_ID,
        departmentName: "Tecnologia",
      },
      { id: OTHER_PERSON_ID, name: "Bruno Lima", departmentId: null, departmentName: null },
    ]);

    await expect(service.findMemberRefs({ departmentIds: [DEPARTMENT_ID] })).resolves.toEqual([
      { id: PERSON_ID, name: "Ana Souza", department: { id: DEPARTMENT_ID, name: "Tecnologia" } },
      { id: OTHER_PERSON_ID, name: "Bruno Lima", department: null },
    ]);
  });
});
