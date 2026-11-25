import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { Role } from "@shared/enums/role.enum";
import { UpdateMemberDto } from "../dto/update-member.dto";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { MemberStatus } from "../enums/member-status.enum";
import { applyMemberEdit } from "../services/member-changes";

const PERSON_ID = "01999a3e-7c1b-7000-8000-000000000001";
const DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000001";

function buildPerson(): Person {
  return Object.assign(new Person(), {
    id: PERSON_ID,
    name: "Ana Torres",
    email: "ana.torres@example.com",
    ra: "a2210001",
    role: Role.MEMBER,
    accessEnabled: true,
    birthDate: "1999-07-22",
    phone: "11981813030",
  });
}

function buildProfile(): MemberProfile {
  return Object.assign(new MemberProfile(), {
    personId: PERSON_ID,
    registrationStatus: MemberRegistrationStatus.APPROVED,
    cpf: "52998224725",
    address: "Rua das Acácias, 120, apto 42",
    city: "São Paulo",
    state: "SP",
    institutionalEmail: "ana.torres@example.edu",
    course: "Sistemas de Informação",
    semester: 7,
    className: "SI-2024-N",
    departmentId: DEPARTMENT_ID,
    mainFunction: "Monitora de informática",
    joinedAt: "2026-03-01",
    volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
    status: MemberStatus.ACTIVE,
  });
}

/** The DTO as the ValidationPipe builds it: an instance, with undefined own properties. */
function dtoOf(body: Record<string, unknown>): UpdateMemberDto {
  return plainToInstance(UpdateMemberDto, body);
}

describe("applyMemberEdit()", () => {
  it("applies every sent field, not only the first one that changes", () => {
    const person = buildPerson();
    const profile = buildProfile();

    const edit = applyMemberEdit(
      person,
      profile,
      dtoOf({
        name: "Ana T.",
        phone: "11999990000",
        course: "Engenharia de Software",
        joinedAt: "2026-02-01",
      }),
    );

    expect(edit.personChanged).toBe(true);
    expect(edit.profileChanged).toBe(true);
    expect(person).toMatchObject({ name: "Ana T.", phone: "11999990000" });
    expect(profile).toMatchObject({ course: "Engenharia de Software", joinedAt: "2026-02-01" });
    expect(edit.changes.fields).toEqual(["name", "phone", "course", "joinedAt"]);
  });

  it("skips undefined and values equal to the stored ones", () => {
    const person = buildPerson();
    const profile = buildProfile();

    const edit = applyMemberEdit(
      person,
      profile,
      dtoOf({ name: "Ana Torres", city: undefined, departmentId: DEPARTMENT_ID }),
    );

    expect(edit).toStrictEqual({
      changes: { before: {}, after: {}, fields: [] },
      personChanged: false,
      profileChanged: false,
    });
    expect(person).toStrictEqual(buildPerson());
    expect(profile).toStrictEqual(buildProfile());
  });

  it("records before, after and the field name of each change, null included", () => {
    const person = buildPerson();
    const profile = buildProfile();

    const edit = applyMemberEdit(
      person,
      profile,
      dtoOf({ address: null, email: "ana@example.org", semester: 8 }),
    );

    expect(edit.personChanged).toBe(true);
    expect(edit.profileChanged).toBe(true);
    expect(edit.changes).toStrictEqual({
      before: {
        email: "ana.torres@example.com",
        address: "Rua das Acácias, 120, apto 42",
        semester: 7,
      },
      after: { email: "ana@example.org", address: null, semester: 8 },
      fields: ["email", "address", "semester"],
    });
    expect(profile.address).toBeNull();
  });

  it("flags only the entity whose field changed", () => {
    const onlyPerson = applyMemberEdit(buildPerson(), buildProfile(), dtoOf({ ra: "a2219999" }));
    expect(onlyPerson).toMatchObject({ personChanged: true, profileChanged: false });

    const onlyProfile = applyMemberEdit(buildPerson(), buildProfile(), dtoOf({ state: "PR" }));
    expect(onlyProfile).toMatchObject({ personChanged: false, profileChanged: true });
  });
});
