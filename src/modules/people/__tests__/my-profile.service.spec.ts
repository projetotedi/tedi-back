import "reflect-metadata";
import { UnauthorizedException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Role } from "@shared/enums/role.enum";
import { Department } from "../entities/department.entity";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { MyProfileService } from "../services/my-profile.service";

const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
const CURRENT_LOGIN = new Date("2026-10-20T13:00:00.000Z");
const PREVIOUS_LOGIN = new Date("2026-10-18T09:30:00.000Z");

const PERSON_ID = "01999a3e-7c1b-7000-8000-000000000001";
const PROFILE_ID = "01999a3e-7c1b-7000-8000-000000000002";
const DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000001";

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
    lastLoginAt: CURRENT_LOGIN,
    previousLoginAt: PREVIOUS_LOGIN,
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

describe("MyProfileService", () => {
  let service: MyProfileService;

  const people = { findOne: jest.fn() };
  const profiles = { findOne: jest.fn() };
  const departments = { findOne: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    people.findOne.mockResolvedValue(buildPerson());
    profiles.findOne.mockResolvedValue(buildProfile());
    departments.findOne.mockResolvedValue(buildDepartment());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MyProfileService,
        { provide: getRepositoryToken(Person), useValue: people },
        { provide: getRepositoryToken(MemberProfile), useValue: profiles },
        { provide: getRepositoryToken(Department), useValue: departments },
      ],
    }).compile();

    service = module.get(MyProfileService);
  });

  describe("getMyProfile", () => {
    it("loads the person, the member profile and the department of the given person id only", async () => {
      const result = await service.getMyProfile(PERSON_ID);

      // One read per entity, keyed by the id that was given and by the department of THAT profile.
      expect(people.findOne).toHaveBeenCalledTimes(1);
      expect(people.findOne).toHaveBeenCalledWith({ where: { id: PERSON_ID } });
      expect(profiles.findOne).toHaveBeenCalledTimes(1);
      expect(profiles.findOne).toHaveBeenCalledWith({ where: { personId: PERSON_ID } });
      expect(departments.findOne).toHaveBeenCalledTimes(1);
      expect(departments.findOne).toHaveBeenCalledWith({ where: { id: DEPARTMENT_ID } });

      expect(result).toMatchObject({
        name: "Ana Torres",
        ra: "a2210001",
        role: Role.MEMBER,
        email: "ana.torres@example.com",
        personalEmail: "ana.torres@example.com",
        course: "Sistemas de Informação",
        mainFunction: "Monitora de informática",
        joinedAt: "2026-03-01",
        department: { id: DEPARTMENT_ID, name: "Tecnologia" },
        cpfMasked: "***.***.247-25",
        // The login before the current one.
        lastLoginAt: PREVIOUS_LOGIN,
      });
      expect(JSON.stringify(result)).not.toContain("52998224725");
    });

    it("returns the member fields as null for a person without member profile", async () => {
      people.findOne.mockResolvedValue(buildPerson({ role: Role.SUPERADMIN }));
      profiles.findOne.mockResolvedValue(null);

      const result = await service.getMyProfile(PERSON_ID);

      for (const field of MEMBER_FIELDS) {
        expect(result[field]).toBeNull();
      }
      expect(result).toMatchObject({
        name: "Ana Torres",
        role: Role.SUPERADMIN,
        email: "ana.torres@example.com",
      });
      // No profile, so no department to look for.
      expect(departments.findOne).not.toHaveBeenCalled();
    });

    it("returns department null when the profile has no department", async () => {
      profiles.findOne.mockResolvedValue(buildProfile({ departmentId: null }));

      const result = await service.getMyProfile(PERSON_ID);

      expect(result.department).toBeNull();
      expect(result.course).toBe("Sistemas de Informação");
      expect(departments.findOne).not.toHaveBeenCalled();
    });

    it("returns department null when the department of the profile no longer exists", async () => {
      departments.findOne.mockResolvedValue(null);

      const result = await service.getMyProfile(PERSON_ID);

      expect(result.department).toBeNull();
      expect(result.course).toBe("Sistemas de Informação");
    });

    it("throws 401 UNAUTHORIZED when the person no longer exists", async () => {
      people.findOne.mockResolvedValue(null);

      await expect(service.getMyProfile(PERSON_ID)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(profiles.findOne).not.toHaveBeenCalled();
      expect(departments.findOne).not.toHaveBeenCalled();
    });

    it("throws 401 UNAUTHORIZED when the person has no role", async () => {
      people.findOne.mockResolvedValue(buildPerson({ role: null }));

      await expect(service.getMyProfile(PERSON_ID)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(profiles.findOne).not.toHaveBeenCalled();
    });
  });
});
