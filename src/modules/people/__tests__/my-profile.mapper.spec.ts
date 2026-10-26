import "reflect-metadata";
import { Role } from "@shared/enums/role.enum";
import { Department } from "../entities/department.entity";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { PersonWithRole, toMyProfileResponse } from "../services/my-profile.mapper";

const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
// The login that opened the current session and the one before it.
const CURRENT_LOGIN = new Date("2026-10-20T13:00:00.000Z");
const PREVIOUS_LOGIN = new Date("2026-10-18T09:30:00.000Z");

const PERSON_ID = "01999a3e-7c1b-7000-8000-000000000001";
const PROFILE_ID = "01999a3e-7c1b-7000-8000-000000000002";
const DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000001";

// Every key of MyProfileResponseDto, in alphabetical order. A new key has to be added here on
// purpose: the response is an explicit projection, never a spread of an entity.
const MY_PROFILE_FIELDS = [
  "accessEnabled",
  "address",
  "birthDate",
  "city",
  "className",
  "course",
  "cpfMasked",
  "department",
  "email",
  "institutionalEmail",
  "joinedAt",
  "lastLoginAt",
  "mainFunction",
  "name",
  "personalEmail",
  "phone",
  "ra",
  "role",
  "semester",
  "state",
  "volunteerTermUrl",
];

const MEMBER_FIELDS = [
  "address",
  "city",
  "className",
  "cpfMasked",
  "course",
  "department",
  "institutionalEmail",
  "joinedAt",
  "mainFunction",
  "personalEmail",
  "semester",
  "state",
  "volunteerTermUrl",
] as const;

function buildPerson(overrides: Partial<PersonWithRole> = {}): PersonWithRole {
  return Object.assign(new Person(), {
    id: PERSON_ID,
    name: "Ana Torres",
    email: "ana.torres@example.com",
    ra: "a2210001",
    passwordHash: "$argon2id$not-a-real-hash",
    role: Role.MEMBER,
    accessEnabled: true,
    birthDate: "1999-07-22",
    phone: "11981813030",
    lastLoginAt: CURRENT_LOGIN,
    previousLoginAt: PREVIOUS_LOGIN,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  }) as PersonWithRole;
}

function buildProfile(overrides: Partial<MemberProfile> = {}): MemberProfile {
  return Object.assign(new MemberProfile(), {
    id: PROFILE_ID,
    personId: PERSON_ID,
    registrationStatus: MemberRegistrationStatus.APPROVED,
    requestedRole: Role.MEMBER,
    cpf: "52998224725",
    address: "Rua das Acácias, 120, apto 42",
    city: "São Paulo",
    state: "SP",
    institutionalEmail: "ana.torres@example.edu",
    course: "Sistemas de Informação",
    semester: 7,
    className: "SI-2024-N",
    departmentId: DEPARTMENT_ID,
    volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
    mainFunction: "Monitora de informática",
    joinedAt: "2026-03-01",
    submittedAt: CREATED_AT,
    reviewedAt: CREATED_AT,
    reviewedById: "01999a3e-0000-7000-8000-0000000000aa",
    reviewNote: "Documentos conferidos.",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  });
}

function buildDepartment(): Department {
  return Object.assign(new Department(), {
    id: DEPARTMENT_ID,
    name: "Tecnologia",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  });
}

describe("toMyProfileResponse", () => {
  it("exposes exactly the documented fields, cpfMasked and never cpf", () => {
    const result = toMyProfileResponse(buildPerson(), buildProfile(), buildDepartment());

    expect(Object.keys(result).sort()).toEqual(MY_PROFILE_FIELDS);
    expect(result).not.toHaveProperty("cpf");
    expect(JSON.stringify(result)).not.toContain("52998224725");
    expect(result).toEqual({
      name: "Ana Torres",
      ra: "a2210001",
      role: Role.MEMBER,
      accessEnabled: true,
      birthDate: "1999-07-22",
      phone: "11981813030",
      email: "ana.torres@example.com",
      personalEmail: "ana.torres@example.com",
      address: "Rua das Acácias, 120, apto 42",
      city: "São Paulo",
      state: "SP",
      institutionalEmail: "ana.torres@example.edu",
      course: "Sistemas de Informação",
      semester: 7,
      className: "SI-2024-N",
      volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
      mainFunction: "Monitora de informática",
      department: { id: DEPARTMENT_ID, name: "Tecnologia" },
      joinedAt: "2026-03-01",
      cpfMasked: "***.***.247-25",
      lastLoginAt: PREVIOUS_LOGIN,
    });
  });

  it("keeps credentials, ids and the review of the registration out of the response", () => {
    const json = JSON.stringify(
      toMyProfileResponse(buildPerson(), buildProfile(), buildDepartment()),
    );

    for (const internal of [
      "$argon2id$not-a-real-hash",
      PERSON_ID,
      PROFILE_ID,
      "Documentos conferidos.",
      "01999a3e-0000-7000-8000-0000000000aa",
      "approved",
    ]) {
      expect(json).not.toContain(internal);
    }
    // Only the id of the department itself, as { id, name }.
    expect(json).toContain(DEPARTMENT_ID);
  });

  it("returns previousLoginAt as lastLoginAt, not the current login", () => {
    const result = toMyProfileResponse(buildPerson(), buildProfile(), buildDepartment());

    expect(result.lastLoginAt).toEqual(PREVIOUS_LOGIN);
    expect(result.lastLoginAt).not.toEqual(CURRENT_LOGIN);
  });

  it("returns lastLoginAt null on the first login, when only the current login exists", () => {
    const firstLogin = buildPerson({ lastLoginAt: CURRENT_LOGIN, previousLoginAt: null });

    expect(toMyProfileResponse(firstLogin, null, null).lastLoginAt).toBeNull();
  });

  it("returns every member field as null without member profile", () => {
    const result = toMyProfileResponse(
      buildPerson({ role: Role.SUPERADMIN, birthDate: null, phone: null }),
      null,
      null,
    );

    expect(Object.keys(result).sort()).toEqual(MY_PROFILE_FIELDS);
    for (const field of MEMBER_FIELDS) {
      expect(result[field]).toBeNull();
    }
    // What belongs to the Person stays.
    expect(result).toMatchObject({
      name: "Ana Torres",
      ra: "a2210001",
      role: Role.SUPERADMIN,
      accessEnabled: true,
      email: "ana.torres@example.com",
      birthDate: null,
      phone: null,
      lastLoginAt: PREVIOUS_LOGIN,
    });
  });

  it("returns personalEmail only together with a member profile, always from Person.email", () => {
    const person = buildPerson({ email: "ana.torres@example.com" });

    expect(toMyProfileResponse(person, buildProfile(), null).personalEmail).toBe(
      "ana.torres@example.com",
    );
    expect(toMyProfileResponse(person, null, null).personalEmail).toBeNull();
    expect(toMyProfileResponse(person, null, null).email).toBe("ana.torres@example.com");
    // A member profile of a person with no e-mail has nothing to repeat.
    expect(toMyProfileResponse(buildPerson({ email: null }), buildProfile(), null)).toMatchObject({
      email: null,
      personalEmail: null,
    });
  });

  it("returns department null when the profile has no department", () => {
    const result = toMyProfileResponse(buildPerson(), buildProfile({ departmentId: null }), null);

    expect(result.department).toBeNull();
    // The rest of the member data is still there.
    expect(result).toMatchObject({ course: "Sistemas de Informação", cpfMasked: "***.***.247-25" });
  });

  it("projects the department as { id, name } and nothing else", () => {
    const result = toMyProfileResponse(buildPerson(), buildProfile(), buildDepartment());

    expect(result.department).toEqual({ id: DEPARTMENT_ID, name: "Tecnologia" });
    expect(Object.keys(result.department!).sort()).toEqual(["id", "name"]);
  });

  it("returns cpfMasked null when the profile has no CPF and masks a malformed one completely", () => {
    expect(
      toMyProfileResponse(buildPerson(), buildProfile({ cpf: null }), null).cpfMasked,
    ).toBeNull();
    expect(
      toMyProfileResponse(buildPerson(), buildProfile({ cpf: "529.982.247-25" }), null).cpfMasked,
    ).toBe("***.***.***-**");
  });

  it("keeps a semester of zero instead of turning it into null", () => {
    const result = toMyProfileResponse(buildPerson(), buildProfile({ semester: 0 }), null);

    expect(result.semester).toBe(0);
  });
});
