import "reflect-metadata";
import { Role } from "@shared/enums/role.enum";
import { Department } from "../entities/department.entity";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { toMemberDetail } from "../services/member-detail.mapper";

const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
const REVIEWED_AT = new Date("2026-10-20T13:00:00.000Z");

const PERSON_ID = "01999a3e-7c1b-7000-8000-000000000001";
const PROFILE_ID = "01999a3e-7c1b-7000-8000-000000000002";
const DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000001";
const REVIEWER_ID = "01999a3e-0000-7000-8000-0000000000aa";
const REVIEW_NOTE = "Documentos conferidos.";

// Every key of MemberDetailResponseDto, in alphabetical order. A new key has to be added here on
// purpose: the response is an explicit projection, never a spread of an entity.
const MEMBER_DETAIL_FIELDS = [
  "accessEnabled",
  "address",
  "birthDate",
  "city",
  "className",
  "course",
  "cpfMasked",
  "department",
  "email",
  "id",
  "institutionalEmail",
  "joinedAt",
  "mainFunction",
  "name",
  "phone",
  "ra",
  "registrationStatus",
  "reviewedAt",
  "reviewedBy",
  "role",
  "semester",
  "state",
  "volunteerTermUrl",
];

// What only exists together with a member profile: null for a person without one.
const MEMBER_PROFILE_FIELDS = [
  "address",
  "city",
  "className",
  "cpfMasked",
  "course",
  "department",
  "institutionalEmail",
  "joinedAt",
  "mainFunction",
  "registrationStatus",
  "reviewedAt",
  "reviewedBy",
  "semester",
  "state",
  "volunteerTermUrl",
] as const;

function buildPerson(overrides: Partial<Person> = {}): Person {
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
    lastLoginAt: REVIEWED_AT,
    previousLoginAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  });
}

function buildProfile(overrides: Partial<MemberProfile> = {}): MemberProfile {
  return Object.assign(new MemberProfile(), {
    id: PROFILE_ID,
    personId: PERSON_ID,
    registrationStatus: MemberRegistrationStatus.APPROVED,
    requestedRole: Role.DIRECTOR,
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
    reviewedAt: REVIEWED_AT,
    reviewedById: REVIEWER_ID,
    reviewNote: REVIEW_NOTE,
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

function buildReviewer(): Person {
  return buildPerson({
    id: REVIEWER_ID,
    name: "Carla Menezes",
    email: "carla.menezes@example.com",
    ra: "c2010001",
    passwordHash: "$argon2id$reviewer-hash",
    role: Role.COORDINATOR,
  });
}

describe("toMemberDetail()", () => {
  it("projects every field and nothing else", () => {
    const result = toMemberDetail(
      buildPerson(),
      buildProfile(),
      buildDepartment(),
      buildReviewer(),
    );

    expect(Object.keys(result).sort()).toEqual(MEMBER_DETAIL_FIELDS);
    expect(result).toStrictEqual({
      id: PERSON_ID,
      name: "Ana Torres",
      ra: "a2210001",
      email: "ana.torres@example.com",
      phone: "11981813030",
      birthDate: "1999-07-22",
      role: Role.MEMBER,
      accessEnabled: true,
      cpfMasked: "***.***.247-25",
      address: "Rua das Acácias, 120, apto 42",
      city: "São Paulo",
      state: "SP",
      institutionalEmail: "ana.torres@example.edu",
      course: "Sistemas de Informação",
      semester: 7,
      className: "SI-2024-N",
      department: { id: DEPARTMENT_ID, name: "Tecnologia" },
      mainFunction: "Monitora de informática",
      joinedAt: "2026-03-01",
      volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
      registrationStatus: MemberRegistrationStatus.APPROVED,
      reviewedAt: REVIEWED_AT,
      reviewedBy: { id: REVIEWER_ID, name: "Carla Menezes" },
    });
  });

  it("returns only cpfMasked, never the full CPF", () => {
    const result = toMemberDetail(buildPerson(), buildProfile(), buildDepartment(), null);

    expect(result.cpfMasked).toBe("***.***.247-25");
    expect(result).not.toHaveProperty("cpf");
    expect(JSON.stringify(result)).not.toContain("52998224725");
  });

  it("returns cpfMasked null without a CPF and masks a malformed one completely", () => {
    expect(
      toMemberDetail(buildPerson(), buildProfile({ cpf: null }), null, null).cpfMasked,
    ).toBeNull();
    // A value that is not 11 digits must never leak through the mask.
    expect(
      toMemberDetail(buildPerson(), buildProfile({ cpf: "529.982.247-25" }), null, null).cpfMasked,
    ).toBe("***.***.***-**");
  });

  it("keeps credentials, profile internals and the review note out of the response", () => {
    const result = toMemberDetail(
      buildPerson(),
      buildProfile(),
      buildDepartment(),
      buildReviewer(),
    );

    for (const internal of [
      "passwordHash",
      "requestedRole",
      "reviewNote",
      "reviewedById",
      "submittedAt",
      "personId",
      "lastLoginAt",
      "previousLoginAt",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ]) {
      expect(result).not.toHaveProperty(internal);
    }

    const json = JSON.stringify(result);
    for (const value of [
      "$argon2id$not-a-real-hash",
      "$argon2id$reviewer-hash",
      PROFILE_ID,
      REVIEW_NOTE,
      "carla.menezes@example.com",
      "c2010001",
    ]) {
      expect(json).not.toContain(value);
    }
  });

  it("returns every member field null and registrationStatus null without a member profile", () => {
    const result = toMemberDetail(
      buildPerson({ role: Role.SUPERADMIN, birthDate: null, phone: null }),
      null,
      null,
      null,
    );

    expect(Object.keys(result).sort()).toEqual(MEMBER_DETAIL_FIELDS);
    for (const field of MEMBER_PROFILE_FIELDS) {
      expect(result[field]).toBeNull();
    }
    // What belongs to the Person stays.
    expect(result).toMatchObject({
      id: PERSON_ID,
      name: "Ana Torres",
      ra: "a2210001",
      email: "ana.torres@example.com",
      phone: null,
      birthDate: null,
      role: Role.SUPERADMIN,
      accessEnabled: true,
    });
  });

  it("maps department and reviewedBy as { id, name } and nothing else", () => {
    const result = toMemberDetail(
      buildPerson(),
      buildProfile(),
      buildDepartment(),
      buildReviewer(),
    );

    expect(result.department).toEqual({ id: DEPARTMENT_ID, name: "Tecnologia" });
    expect(Object.keys(result.department!).sort()).toEqual(["id", "name"]);
    expect(result.reviewedBy).toEqual({ id: REVIEWER_ID, name: "Carla Menezes" });
    expect(Object.keys(result.reviewedBy!).sort()).toEqual(["id", "name"]);
    expect(result.reviewedAt).toEqual(REVIEWED_AT);
  });

  it("returns reviewedBy null without a reviewer, keeping the rest of the review", () => {
    const result = toMemberDetail(buildPerson(), buildProfile(), buildDepartment(), null);

    expect(result.reviewedBy).toBeNull();
    expect(result.reviewedAt).toEqual(REVIEWED_AT);
    expect(result.registrationStatus).toBe(MemberRegistrationStatus.APPROVED);
  });

  it("returns department null when the profile has no department", () => {
    const result = toMemberDetail(buildPerson(), buildProfile({ departmentId: null }), null, null);

    expect(result.department).toBeNull();
    // The rest of the member data is still there.
    expect(result).toMatchObject({ course: "Sistemas de Informação", cpfMasked: "***.***.247-25" });
  });

  it("shows a pending registration without role, access, function, join date and reviewer", () => {
    const result = toMemberDetail(
      buildPerson({ role: null, accessEnabled: false }),
      buildProfile({
        registrationStatus: MemberRegistrationStatus.PENDING,
        mainFunction: null,
        joinedAt: null,
        reviewedAt: null,
        reviewedById: null,
        reviewNote: null,
      }),
      buildDepartment(),
      null,
    );

    expect(result).toMatchObject({
      role: null,
      accessEnabled: false,
      registrationStatus: MemberRegistrationStatus.PENDING,
      mainFunction: null,
      joinedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      // The department suggested at sign-up is shown (it only gives no scope).
      department: { id: DEPARTMENT_ID, name: "Tecnologia" },
    });
  });

  it("keeps a semester of zero instead of turning it into null", () => {
    const result = toMemberDetail(buildPerson(), buildProfile({ semester: 0 }), null, null);

    expect(result.semester).toBe(0);
  });
});
