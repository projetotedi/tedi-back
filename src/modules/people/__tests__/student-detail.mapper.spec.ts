import "reflect-metadata";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import { Role } from "@shared/enums/role.enum";
import { Person } from "../entities/person.entity";
import { StudentProfile } from "../entities/student-profile.entity";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";
import { toStudentDetail } from "../services/student-detail.mapper";

const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
const UPDATED_AT = new Date("2026-09-10T12:00:00.000Z");

const CARLA_ID = "01999a3e-0000-7000-8000-0000000000aa";
const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";

const DETAIL_FIELDS = [
  "accessibilityNeed",
  "age",
  "archiveReason",
  "archivedAt",
  "birthDate",
  "classNeeds",
  "createdAt",
  "createdBy",
  "education",
  "email",
  "emergencyContact",
  "hasComputer",
  "hasSmartphone",
  "howFoundUs",
  "id",
  "name",
  "phone",
  "supportResource",
  "updatedAt",
];

function buildPerson(overrides: Partial<Person> = {}): Person {
  return Object.assign(new Person(), {
    id: STUDENT_ID,
    name: "Maria Silva Santos",
    email: "maria.santos@example.com",
    ra: null,
    passwordHash: null,
    role: null,
    accessEnabled: true,
    birthDate: "1958-04-12",
    phone: "43999990000",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  });
}

function buildProfile(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return Object.assign(new StudentProfile(), {
    id: "01999a3e-7c1b-7000-8000-000000000002",
    personId: STUDENT_ID,
    education: "Ensino fundamental completo",
    hasSmartphone: true,
    hasComputer: false,
    howFoundUs: "Indicação de uma amiga",
    emergencyContactName: "Ana Santos",
    emergencyContactPhone: "43988887777",
    accessibilityNeed: AccessibilityNeed.VISUAL,
    supportResource: "Fonte ampliada",
    classNeeds: "Sentar perto do projetor",
    createdById: CARLA_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    archive: Object.assign(new ArchivableColumns(), {
      archivedAt: null,
      archivedById: null,
      archiveReason: null,
    }),
    ...overrides,
  });
}

function buildCreator(): Person {
  return Object.assign(new Person(), {
    id: CARLA_ID,
    name: "Carla Menezes",
    email: "carla.menezes@example.com",
    ra: "RA-0001",
    passwordHash: "scrypt$not-a-real-hash",
    role: Role.DIRECTOR,
    accessEnabled: true,
    birthDate: "1980-01-20",
    phone: "43900001111",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  });
}

describe("toStudentDetail", () => {
  it("returns exactly the fields of StudentDetailDto, without enrollment or attendance fields", () => {
    const result = toStudentDetail(buildPerson(), buildProfile(), buildCreator(), "2026-10-01");

    expect(Object.keys(result).sort()).toEqual(DETAIL_FIELDS);
    expect(Object.keys(result.emergencyContact).sort()).toEqual(["name", "phone"]);
    expect(Object.keys(result.createdBy!).sort()).toEqual(["id", "name"]);
    expect(result).toEqual({
      id: STUDENT_ID,
      name: "Maria Silva Santos",
      birthDate: "1958-04-12",
      age: 68,
      phone: "43999990000",
      email: "maria.santos@example.com",
      education: "Ensino fundamental completo",
      hasSmartphone: true,
      hasComputer: false,
      howFoundUs: "Indicação de uma amiga",
      emergencyContact: { name: "Ana Santos", phone: "43988887777" },
      accessibilityNeed: AccessibilityNeed.VISUAL,
      supportResource: "Fonte ampliada",
      classNeeds: "Sentar perto do projetor",
      createdAt: CREATED_AT,
      createdBy: { id: CARLA_ID, name: "Carla Menezes" },
      updatedAt: CREATED_AT,
      archivedAt: null,
      archiveReason: null,
    });
  });

  it("nests emergencyContact as { name, phone }, with nulls when it was not informed", () => {
    const filled = toStudentDetail(buildPerson(), buildProfile(), buildCreator(), "2026-10-01");
    expect(filled.emergencyContact).toEqual({ name: "Ana Santos", phone: "43988887777" });

    const empty = toStudentDetail(
      buildPerson(),
      buildProfile({ emergencyContactName: null, emergencyContactPhone: null }),
      buildCreator(),
      "2026-10-01",
    );
    expect(empty.emergencyContact).toEqual({ name: null, phone: null });
  });

  it("returns createdBy { id, name } and nothing else from the creator", () => {
    const result = toStudentDetail(buildPerson(), buildProfile(), buildCreator(), "2026-10-01");
    const json = JSON.stringify(result);

    expect(result.createdBy).toEqual({ id: CARLA_ID, name: "Carla Menezes" });
    expect(json).not.toContain("carla.menezes@example.com");
    expect(json).not.toContain("scrypt$not-a-real-hash");
    expect(json).not.toContain("RA-0001");
    expect(json).not.toContain("43900001111");
    expect(json).not.toContain("director");
  });

  it("returns createdBy null when there is no creator", () => {
    const result = toStudentDetail(buildPerson(), buildProfile(), null, "2026-10-01");

    expect(result.createdBy).toBeNull();
    expect(Object.keys(result).sort()).toEqual(DETAIL_FIELDS);
  });

  it("computes age on the given day and takes the latest updatedAt of person and profile", () => {
    const person = buildPerson();
    const profile = buildProfile();

    expect(toStudentDetail(person, profile, null, "2026-04-11").age).toBe(67);
    expect(toStudentDetail(person, profile, null, "2026-04-12").age).toBe(68);

    const personNewer = toStudentDetail(
      buildPerson({ updatedAt: UPDATED_AT }),
      buildProfile({ updatedAt: CREATED_AT }),
      null,
      "2026-10-01",
    );
    expect(personNewer.updatedAt).toEqual(UPDATED_AT);

    const profileNewer = toStudentDetail(
      buildPerson({ updatedAt: CREATED_AT }),
      buildProfile({ updatedAt: UPDATED_AT }),
      null,
      "2026-10-01",
    );
    expect(profileNewer.updatedAt).toEqual(UPDATED_AT);
  });

  it("returns archivedAt and archiveReason of an archived student", () => {
    const archivedAt = new Date("2026-09-20T15:00:00.000Z");
    const profile = buildProfile({
      archive: Object.assign(new ArchivableColumns(), {
        archivedAt,
        archivedById: CARLA_ID,
        archiveReason: "Mudou de cidade.",
      }),
    });

    const result = toStudentDetail(buildPerson(), profile, buildCreator(), "2026-10-01");

    expect(result.archivedAt).toEqual(archivedAt);
    expect(result.archiveReason).toBe("Mudou de cidade.");
    expect(result).not.toHaveProperty("archivedById");
  });
});
