import "reflect-metadata";
import { MembersService } from "@modules/people/services/members.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import { scopeFor } from "@shared/permissions/permission-matrix";
import { ListScopeFilter } from "@shared/permissions/permission-target.type";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { HoursScopeService } from "../services/hours-scope.service";

const TECH = "01999a3e-1111-7000-8000-000000000001";
const ANA = "01999a3e-0000-7000-8000-0000000000a1";
const BRUNO = "01999a3e-0000-7000-8000-0000000000a2";

const DIRECTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000bb",
  role: Role.DIRECTOR,
  accessEnabled: true,
  departmentIds: [TECH],
};
const DIRECTOR_WITHOUT_DEPARTMENT: AuthUser = { ...DIRECTOR, departmentIds: [] };
const COORDINATOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000ee",
  role: Role.COORDINATOR,
  accessEnabled: true,
  departmentIds: [],
};
const SUPERADMIN: AuthUser = { ...COORDINATOR, role: Role.SUPERADMIN };

const REFS = [
  { id: ANA, name: "Ana Souza", department: { id: TECH, name: "Tecnologia" } },
  { id: BRUNO, name: "Bruno Lima", department: { id: TECH, name: "Tecnologia" } },
];

describe("HoursScopeService", () => {
  const members = { findMemberRefs: jest.fn() };
  let service: HoursScopeService;

  beforeEach(() => {
    jest.resetAllMocks();
    members.findMemberRefs.mockResolvedValue(REFS);
    service = new HoursScopeService(new PermissionPolicy(), members as unknown as MembersService);
  });

  it("gives everyone to coordination and the superadmin without search, without calling the people", async () => {
    for (const actor of [COORDINATOR, SUPERADMIN]) {
      for (const search of [undefined, "", "   "]) {
        await expect(
          service.populationOf(actor, Permission.HOURS_VIEW_OTHERS, search),
        ).resolves.toEqual({ kind: "everyone" });
      }
    }
    expect(members.findMemberRefs).not.toHaveBeenCalled();
  });

  it("gives the people of her department to a director, through findMemberRefs", async () => {
    await expect(service.populationOf(DIRECTOR, Permission.HOURS_EXPORT)).resolves.toEqual({
      kind: "people",
      personIds: [ANA, BRUNO],
    });
    expect(members.findMemberRefs).toHaveBeenCalledWith({
      departmentIds: [TECH],
      search: undefined,
    });
  });

  it("gives nobody to a director without department, without calling the people", async () => {
    await expect(
      service.populationOf(DIRECTOR_WITHOUT_DEPARTMENT, Permission.HOURS_VIEW_OTHERS, "Ana"),
    ).resolves.toEqual({ kind: "people", personIds: [] });
    expect(members.findMemberRefs).not.toHaveBeenCalled();
  });

  it("passes the search to findMemberRefs only when it is not blank, alone for coordination and with the department for a director", async () => {
    members.findMemberRefs.mockResolvedValue([REFS[0]]);

    await expect(
      service.populationOf(COORDINATOR, Permission.HOURS_VIEW_OTHERS, " Ana "),
    ).resolves.toEqual({ kind: "people", personIds: [ANA] });
    await service.populationOf(DIRECTOR, Permission.HOURS_VIEW_OTHERS, "Ana");
    await service.populationOf(DIRECTOR, Permission.HOURS_VIEW_OTHERS, "   ");

    expect(members.findMemberRefs.mock.calls).toEqual([
      [{ search: " Ana " }],
      [{ departmentIds: [TECH], search: "Ana" }],
      [{ departmentIds: [TECH], search: undefined }],
    ]);
  });

  it("gives nobody when the search finds no one", async () => {
    members.findMemberRefs.mockResolvedValue([]);

    await expect(
      service.populationOf(COORDINATOR, Permission.HOURS_VIEW_OTHERS, "Zé"),
    ).resolves.toEqual({ kind: "people", personIds: [] });
  });

  it.each(["own", "allocated", "lessonTeacher"] as const)(
    "throws on the %s scope, which no hours permission uses",
    async (kind) => {
      const policy = new PermissionPolicy();
      const filter: ListScopeFilter = { kind, personId: DIRECTOR.id };
      jest.spyOn(policy, "listFilter").mockReturnValue(filter);
      const withFakePolicy = new HoursScopeService(policy, members as unknown as MembersService);

      await expect(
        withFakePolicy.populationOf(DIRECTOR, Permission.HOURS_VIEW_OTHERS),
      ).rejects.toThrow(`Hours scope ${kind} is not supported.`);
      expect(members.findMemberRefs).not.toHaveBeenCalled();
    },
  );

  it("throws for a scope kind it does not know, instead of answering nobody or everyone", async () => {
    const policy = new PermissionPolicy();
    const unknownFilter: unknown = { kind: "unknown" };
    jest.spyOn(policy, "listFilter").mockReturnValue(unknownFilter as ListScopeFilter);
    const withFakePolicy = new HoursScopeService(policy, members as unknown as MembersService);

    await expect(
      withFakePolicy.populationOf(COORDINATOR, Permission.HOURS_VIEW_OTHERS, "Ana"),
    ).rejects.toThrow('Hours scope {"kind":"unknown"} is not supported.');
    expect(members.findMemberRefs).not.toHaveBeenCalled();
  });

  it.each([Permission.HOURS_VIEW_OTHERS, Permission.HOURS_EXPORT])(
    "matrix: %s is none, department or all for every role, the only scopes this service supports",
    (permission) => {
      for (const role of Object.values(Role)) {
        expect(["none", "department", "all"]).toContain(scopeFor(role, permission));
      }
    },
  );
});
