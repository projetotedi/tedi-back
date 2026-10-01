import "reflect-metadata";
import { HttpException, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { Department } from "../entities/department.entity";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { DepartmentsService } from "../services/departments.service";
import {
  MembersService,
  SubmitMemberRegistrationInput,
  memberRegistrationNotFound,
} from "../services/members.service";

// 22:30 BRT on 2026-10-01 is already 2026-10-02 in UTC.
const NOW = new Date("2026-10-02T01:30:00.000Z");
const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const PERSON_ID = "01999a3e-7c1b-7000-8000-000000000001";
const PROFILE_ID = "01999a3e-7c1b-7000-8000-000000000002";
const NEW_PERSON_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const NEW_PROFILE_ID = "01999a3e-7c1b-7000-8000-0000000000c2";
const OTHER_PERSON_ID = "01999a3e-7c1b-7000-8000-0000000000d1";
const DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000001";
const INVITE_ID = "01999a3e-2222-7000-8000-000000000001";

// Personal data that must never reach a log or an audit event.
const SENSITIVE_VALUES = [
  "52998224725",
  "Rua das Acácias",
  "São Paulo",
  "11981813030",
  "ana.torres@example.com",
  "ana.torres@example.edu",
  "1999-07-22",
  "Sistemas de Informação",
  "SI-2024-N",
  "drive.google.com",
  "$argon2id$hash",
];

const INPUT: SubmitMemberRegistrationInput = {
  name: "Ana Torres",
  ra: "a2210001",
  personalEmail: "ana.torres@example.com",
  birthDate: "1999-07-22",
  cpf: "52998224725",
  phone: "11981813030",
  address: "Rua das Acácias, 120, apto 42",
  city: "São Paulo",
  state: "SP",
  institutionalEmail: "ana.torres@example.edu",
  course: "Sistemas de Informação",
  semester: 7,
  className: "SI-2024-N",
  departmentId: DEPARTMENT_ID,
  volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
  passwordHash: "$argon2id$hash",
  requestedRole: Role.MEMBER,
  inviteId: INVITE_ID,
};

function buildPerson(overrides: Partial<Person> = {}): Person {
  return Object.assign(new Person(), {
    id: PERSON_ID,
    name: "Ana Torres",
    email: "ana.torres@example.com",
    ra: "a2210001",
    passwordHash: "$argon2id$old",
    role: null,
    accessEnabled: false,
    birthDate: "1999-07-22",
    phone: "11981813030",
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
    registrationStatus: MemberRegistrationStatus.PENDING,
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
    mainFunction: null,
    joinedAt: null,
    submittedAt: CREATED_AT,
    reviewedAt: null,
    reviewedById: null,
    reviewNote: null,
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

function uniqueViolation(constraint: string): QueryFailedError {
  const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
    detail: "Key (ra)=(a2210001) already exists.",
  });
  return new QueryFailedError("INSERT INTO people", [], driverError);
}

async function httpFailure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error("Expected the promise to reject with an HttpException");
}

describe("MembersService", () => {
  let service: MembersService;
  let state: {
    personByRa: Person | null;
    personByEmail: Person | null;
    personById: Person | null;
    profile: MemberProfile | null;
    department: Department | null;
  };

  const manager = { create: jest.fn(), save: jest.fn(), findOne: jest.fn() };
  const profileRepository = { findOne: jest.fn() };
  const personRepository = { findOne: jest.fn() };
  const departmentRepository = { findOne: jest.fn() };
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  const departments = { exists: jest.fn() };

  function emittedEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls.map((call) => call[1] as AuditableActionEvent);
  }

  function expectNoSensitiveValue(text: string): void {
    for (const value of SENSITIVE_VALUES) {
      expect(text).not.toContain(value);
    }
  }

  /** The entities passed to manager.save, by class. */
  function savedOf<T>(entity: new () => T): T[] {
    return manager.save.mock.calls
      .map((call) => (call.length === 2 ? call[1] : call[0]) as unknown)
      .filter((value): value is T => value instanceof entity);
  }

  beforeEach(() => {
    jest.resetAllMocks();
    state = {
      personByRa: null,
      personByEmail: null,
      personById: null,
      profile: null,
      department: buildDepartment(),
    };

    manager.findOne.mockImplementation(
      async (entity: unknown, options: { where: Record<string, unknown> }) => {
        if (entity === Person) {
          if (options.where.ra !== undefined) return state.personByRa;
          if (options.where.email !== undefined) return state.personByEmail;
          if (options.where.id !== undefined) return state.personById;
        }
        if (entity === MemberProfile) return state.profile;
        if (entity === Department) return state.department;
        return null;
      },
    );
    manager.create.mockImplementation((entity: new () => object, values: object) =>
      Object.assign(new entity(), values),
    );
    manager.save.mockImplementation(async (...args: unknown[]) => {
      const entity = (args.length === 2 ? args[1] : args[0]) as {
        id?: string;
        updatedAt?: Date;
      };
      if (!entity.id) {
        entity.id = entity instanceof Person ? NEW_PERSON_ID : NEW_PROFILE_ID;
      }
      entity.updatedAt = NOW;
      return entity;
    });
    dataSource.transaction.mockImplementation(async (callback: (m: unknown) => unknown) =>
      callback(manager),
    );
    dataSource.getRepository.mockImplementation((entity: unknown) => {
      if (entity === MemberProfile) return profileRepository;
      if (entity === Person) return personRepository;
      return departmentRepository;
    });
    clock.now.mockReturnValue(NOW);
    departments.exists.mockResolvedValue(true);

    service = new MembersService(
      dataSource as unknown as DataSource,
      eventEmitter as unknown as EventEmitter2,
      clock as unknown as Clock,
      departments as unknown as DepartmentsService,
    );
  });

  describe("submitFromInvite()", () => {
    const run = () => service.submitFromInvite(manager as unknown as EntityManager, INPUT);

    it("creates the Person without access (role null, accessEnabled false) and a pending profile", async () => {
      const submission = await run();

      expect(submission.personId).toBe(NEW_PERSON_ID);

      const [person] = savedOf(Person);
      expect(person).toMatchObject({
        name: "Ana Torres",
        ra: "a2210001",
        passwordHash: "$argon2id$hash",
        role: null,
        accessEnabled: false,
      });

      const [profile] = savedOf(MemberProfile);
      expect(profile).toMatchObject({
        personId: NEW_PERSON_ID,
        registrationStatus: MemberRegistrationStatus.PENDING,
        requestedRole: Role.MEMBER,
        departmentId: DEPARTMENT_ID,
        mainFunction: null,
        joinedAt: null,
        submittedAt: NOW,
        reviewedAt: null,
        reviewedById: null,
        reviewNote: null,
      });
      // Person is saved before the profile that points at it.
      expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(
        manager.save.mock.invocationCallOrder[1],
      );
    });

    it("stores the personal e-mail on Person.email, birthDate and phone on Person, and the rest on the profile", async () => {
      await run();

      const [person] = savedOf(Person);
      expect(person).toMatchObject({
        email: "ana.torres@example.com",
        birthDate: "1999-07-22",
        phone: "11981813030",
      });

      const [profile] = savedOf(MemberProfile);
      expect(profile).toMatchObject({
        cpf: "52998224725",
        address: "Rua das Acácias, 120, apto 42",
        city: "São Paulo",
        state: "SP",
        institutionalEmail: "ana.torres@example.edu",
        course: "Sistemas de Informação",
        semester: 7,
        className: "SI-2024-N",
        volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
      });
      // Nothing is duplicated between the two tables.
      expect(profile).not.toHaveProperty("email");
      expect(profile).not.toHaveProperty("phone");
      expect(profile).not.toHaveProperty("birthDate");
      expect(person).not.toHaveProperty("cpf");
    });

    it("stores null for the optional fields that were not informed", async () => {
      const required: SubmitMemberRegistrationInput = {
        ...INPUT,
        address: undefined,
        city: undefined,
        state: undefined,
        departmentId: undefined,
        volunteerTermUrl: undefined,
      };

      await service.submitFromInvite(manager as unknown as EntityManager, required);

      const [profile] = savedOf(MemberProfile);
      expect(profile).toMatchObject({
        address: null,
        city: null,
        state: null,
        departmentId: null,
        volunteerTermUrl: null,
      });
      expect(departments.exists).not.toHaveBeenCalled();
    });

    it("locks the person and the profile rows, Person first", async () => {
      state.personByRa = buildPerson({ role: null });
      state.profile = buildProfile({ registrationStatus: MemberRegistrationStatus.REJECTED });

      await run();

      const locked = manager.findOne.mock.calls
        .filter((call) => call[1]?.lock?.mode === "pessimistic_write")
        .map((call) => call[0]);
      expect(locked).toEqual([Person, MemberProfile]);
    });

    it("reuses a Person found by RA that has no role and no member profile (RN-09)", async () => {
      state.personByRa = buildPerson({ id: OTHER_PERSON_ID, name: "Ana", role: null });
      state.personByEmail = state.personByRa;

      const submission = await run();

      expect(submission.personId).toBe(OTHER_PERSON_ID);
      expect(manager.create).not.toHaveBeenCalledWith(Person, expect.anything());
      const [person] = savedOf(Person);
      expect(person).toBe(state.personByRa);
      expect(person).toMatchObject({
        id: OTHER_PERSON_ID,
        name: "Ana Torres",
        accessEnabled: false,
      });
      const [profile] = savedOf(MemberProfile);
      expect(profile.personId).toBe(OTHER_PERSON_ID);
      expect(submission.auditEvent.before).toBeNull();
      expect(submission.auditEvent.after).toMatchObject({ resubmitted: false });
    });

    it("resubmits over a rejected registration: same Person and profile, pending again, review fields cleared", async () => {
      state.personByRa = buildPerson({ id: PERSON_ID, role: null, accessEnabled: false });
      state.personByEmail = state.personByRa;
      const rejected = buildProfile({
        registrationStatus: MemberRegistrationStatus.REJECTED,
        mainFunction: "Antiga",
        joinedAt: "2026-01-01",
        reviewedAt: CREATED_AT,
        reviewedById: ACTOR_ID,
        reviewNote: "O RA não confere.",
      });
      state.profile = rejected;

      const submission = await run();

      expect(submission.personId).toBe(PERSON_ID);
      expect(manager.create).not.toHaveBeenCalled();
      expect(savedOf(MemberProfile)).toEqual([rejected]);
      expect(rejected).toMatchObject({
        id: PROFILE_ID,
        registrationStatus: MemberRegistrationStatus.PENDING,
        submittedAt: NOW,
        mainFunction: null,
        joinedAt: null,
        reviewedAt: null,
        reviewedById: null,
        reviewNote: null,
      });
      expect(submission.auditEvent.before).toEqual({
        registrationStatus: MemberRegistrationStatus.REJECTED,
      });
      expect(submission.auditEvent.after).toMatchObject({ resubmitted: true });
    });

    it("throws 409 RA_ALREADY_IN_USE when the RA belongs to a person with role", async () => {
      state.personByRa = buildPerson({ role: Role.MEMBER, accessEnabled: true });

      const failure = await httpFailure(run());

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "RA_ALREADY_IN_USE",
        message: "RA already in use.",
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws 409 RA_ALREADY_IN_USE when the RA has a pending registration", async () => {
      state.personByRa = buildPerson({ role: null });
      state.profile = buildProfile({ registrationStatus: MemberRegistrationStatus.PENDING });

      const pending = await httpFailure(run());
      expect(pending.getStatus()).toBe(409);
      expect(pending.getResponse()).toEqual({
        error: "RA_ALREADY_IN_USE",
        message: "RA already in use.",
      });

      // An approved profile blocks too, and the answer does not reveal the situation.
      state.profile = buildProfile({ registrationStatus: MemberRegistrationStatus.APPROVED });
      const approved = await httpFailure(run());
      expect(approved.getResponse()).toEqual(pending.getResponse());

      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws 409 EMAIL_ALREADY_IN_USE when the personal e-mail belongs to another person", async () => {
      state.personByEmail = buildPerson({ id: OTHER_PERSON_ID, ra: null });

      const failure = await httpFailure(run());

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "EMAIL_ALREADY_IN_USE",
        message: "Email already in use.",
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws 400 DEPARTMENT_NOT_FOUND for an unknown departmentId", async () => {
      departments.exists.mockResolvedValue(false);

      const failure = await httpFailure(run());

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "DEPARTMENT_NOT_FOUND",
        message: "Department not found.",
      });
      expect(departments.exists).toHaveBeenCalledWith(manager, DEPARTMENT_ID);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("maps unique violations of uq_people_ra, uq_people_email and uq_member_profiles_person_id to 409", async () => {
      const cases: Array<[string, string]> = [
        ["uq_people_ra", "RA_ALREADY_IN_USE"],
        ["uq_member_profiles_person_id", "RA_ALREADY_IN_USE"],
        ["uq_people_email", "EMAIL_ALREADY_IN_USE"],
      ];

      for (const [constraint, code] of cases) {
        manager.save.mockRejectedValueOnce(uniqueViolation(constraint));

        const failure = await httpFailure(run());

        expect(failure.getStatus()).toBe(409);
        expect((failure.getResponse() as { error: string }).error).toBe(code);
        // The detail of Postgres carries the duplicated value: it never reaches the answer.
        expect(JSON.stringify(failure.getResponse())).not.toContain("a2210001");
      }

      // A unique violation of another constraint is not ours to translate.
      const other = uniqueViolation("uq_something_else");
      manager.save.mockRejectedValueOnce(other);
      await expect(run()).rejects.toBe(other);
    });

    it("returns a MEMBER_REGISTRATION_SUBMITTED event with only allow-listed fields and emits nothing itself", async () => {
      const { auditEvent, personId } = await run();

      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(auditEvent).toBeInstanceOf(AuditableActionEvent);
      expect(auditEvent).toMatchObject({
        // The acceptor IS the person being registered.
        actorId: personId,
        action: AuditableAction.MEMBER_REGISTRATION_SUBMITTED,
        targetType: "member",
        targetId: personId,
        before: null,
        occurredAt: NOW,
      });
      expect(auditEvent.after).toStrictEqual({
        registrationStatus: MemberRegistrationStatus.PENDING,
        requestedRole: Role.MEMBER,
        departmentId: DEPARTMENT_ID,
        inviteId: INVITE_ID,
        resubmitted: false,
      });
      expectNoSensitiveValue(JSON.stringify(auditEvent));
    });
  });

  describe("findAccessFacts()", () => {
    it("returns status null and no department for a person without member profile", async () => {
      profileRepository.findOne.mockResolvedValue(null);

      await expect(service.findAccessFacts(PERSON_ID)).resolves.toEqual({
        registrationStatus: null,
        departmentIds: [],
      });
      expect(profileRepository.findOne).toHaveBeenCalledWith({
        where: { personId: PERSON_ID },
        select: { registrationStatus: true, departmentId: true },
      });
    });

    it("returns the department only when the registration is approved", async () => {
      profileRepository.findOne.mockResolvedValue(
        buildProfile({ registrationStatus: MemberRegistrationStatus.APPROVED }),
      );
      await expect(service.findAccessFacts(PERSON_ID)).resolves.toEqual({
        registrationStatus: MemberRegistrationStatus.APPROVED,
        departmentIds: [DEPARTMENT_ID],
      });

      // Approved without a department (a coordinator, or the backfill) has no department scope.
      profileRepository.findOne.mockResolvedValue(
        buildProfile({ registrationStatus: MemberRegistrationStatus.APPROVED, departmentId: null }),
      );
      await expect(service.findAccessFacts(PERSON_ID)).resolves.toEqual({
        registrationStatus: MemberRegistrationStatus.APPROVED,
        departmentIds: [],
      });
    });

    it("returns pending and rejected without department", async () => {
      for (const status of [MemberRegistrationStatus.PENDING, MemberRegistrationStatus.REJECTED]) {
        profileRepository.findOne.mockResolvedValue(buildProfile({ registrationStatus: status }));

        await expect(service.findAccessFacts(PERSON_ID)).resolves.toEqual({
          registrationStatus: status,
          departmentIds: [],
        });
      }
    });
  });

  describe("getRegistration()", () => {
    it("returns the full registration with the department of the profile", async () => {
      profileRepository.findOne.mockResolvedValue(buildProfile());
      personRepository.findOne.mockResolvedValue(buildPerson());
      departmentRepository.findOne.mockResolvedValue(buildDepartment());

      const registration = await service.getRegistration(PERSON_ID);

      expect(registration).toMatchObject({
        id: PERSON_ID,
        personalEmail: "ana.torres@example.com",
        cpf: "52998224725",
        role: null,
        accessEnabled: false,
        registrationStatus: MemberRegistrationStatus.PENDING,
        department: { id: DEPARTMENT_ID, name: "Tecnologia" },
      });
    });

    it("throws 404 MEMBER_REGISTRATION_NOT_FOUND when the person has no member profile", async () => {
      profileRepository.findOne.mockResolvedValue(null);

      const failure = await httpFailure(service.getRegistration(PERSON_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "MEMBER_REGISTRATION_NOT_FOUND",
        message: "Member registration not found.",
      });
      expect(personRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe("approve()", () => {
    const DTO = {
      role: Role.MEMBER,
      departmentId: DEPARTMENT_ID,
      mainFunction: "Monitora de informática",
      joinedAt: "2026-10-01",
      note: "Documentos conferidos.",
    };

    beforeEach(() => {
      state.personById = buildPerson({ role: null, accessEnabled: false });
      state.profile = buildProfile();
    });

    it("rejects SUPERADMIN with 400 INVALID_ROLE before opening a transaction", async () => {
      const failure = await httpFailure(
        service.approve(PERSON_ID, { ...DTO, role: Role.SUPERADMIN }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "INVALID_ROLE",
        message: "Role cannot be assigned via API.",
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("sets role, accessEnabled, department, main function, join date, reviewer and note", async () => {
      const response = await service.approve(PERSON_ID, DTO, ACTOR_ID);

      expect(state.personById).toMatchObject({ role: Role.MEMBER, accessEnabled: true });
      expect(state.profile).toMatchObject({
        registrationStatus: MemberRegistrationStatus.APPROVED,
        departmentId: DEPARTMENT_ID,
        mainFunction: "Monitora de informática",
        joinedAt: "2026-10-01",
        reviewedAt: NOW,
        reviewedById: ACTOR_ID,
        reviewNote: "Documentos conferidos.",
      });
      expect(response).toMatchObject({
        id: PERSON_ID,
        role: Role.MEMBER,
        accessEnabled: true,
        registrationStatus: MemberRegistrationStatus.APPROVED,
        department: { id: DEPARTMENT_ID, name: "Tecnologia" },
        mainFunction: "Monitora de informática",
        joinedAt: "2026-10-01",
        reviewedById: ACTOR_ID,
      });
      // Both rows are locked for the whole approval.
      const locked = manager.findOne.mock.calls
        .filter((call) => call[1]?.lock?.mode === "pessimistic_write")
        .map((call) => call[0]);
      expect(locked).toEqual([Person, MemberProfile]);
    });

    it("approves a coordinator without department and stores no note when none is sent", async () => {
      const response = await service.approve(
        PERSON_ID,
        { role: Role.COORDINATOR, mainFunction: "Coordenação", joinedAt: "2026-10-01" },
        ACTOR_ID,
      );

      expect(state.profile).toMatchObject({ departmentId: null, reviewNote: null });
      expect(state.personById).toMatchObject({ role: Role.COORDINATOR, accessEnabled: true });
      expect(response.department).toBeNull();
    });

    it("throws 404 MEMBER_REGISTRATION_NOT_FOUND when the person has no member profile", async () => {
      state.profile = null;

      const failure = await httpFailure(service.approve(PERSON_ID, DTO, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "MEMBER_REGISTRATION_NOT_FOUND",
        message: "Member registration not found.",
      });

      state.profile = buildProfile();
      state.personById = null;
      const unknown = await httpFailure(service.approve(PERSON_ID, DTO, ACTOR_ID));
      expect(unknown.getResponse()).toEqual(failure.getResponse());

      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 409 REGISTRATION_NOT_PENDING for an approved or rejected registration", async () => {
      for (const status of [MemberRegistrationStatus.APPROVED, MemberRegistrationStatus.REJECTED]) {
        state.profile = buildProfile({ registrationStatus: status });

        const failure = await httpFailure(service.approve(PERSON_ID, DTO, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "REGISTRATION_NOT_PENDING",
          message: "Only pending registrations can be approved or rejected.",
        });
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 400 DEPARTMENT_NOT_FOUND for an unknown department", async () => {
      state.department = null;

      const failure = await httpFailure(service.approve(PERSON_ID, DTO, ACTOR_ID));

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "DEPARTMENT_NOT_FOUND",
        message: "Department not found.",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits MEMBER_REGISTRATION_APPROVED after commit with only allow-listed fields", async () => {
      const order: string[] = [];
      dataSource.transaction.mockImplementation(async (callback: (m: unknown) => unknown) => {
        const result = await callback(manager);
        order.push("commit");
        return result;
      });
      eventEmitter.emit.mockImplementation(() => order.push("emit"));

      await service.approve(PERSON_ID, DTO, ACTOR_ID);

      expect(order).toEqual(["commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit.mock.calls[0][0]).toBe(AUDITABLE_ACTION_EVENT);

      const [event] = emittedEvents();
      expect(event).toMatchObject({
        actorId: ACTOR_ID,
        action: AuditableAction.MEMBER_REGISTRATION_APPROVED,
        targetType: "member",
        targetId: PERSON_ID,
        occurredAt: NOW,
      });
      expect(event.before).toStrictEqual({
        registrationStatus: MemberRegistrationStatus.PENDING,
        role: null,
        accessEnabled: false,
        departmentId: DEPARTMENT_ID,
      });
      expect(event.after).toStrictEqual({
        registrationStatus: MemberRegistrationStatus.APPROVED,
        role: Role.MEMBER,
        accessEnabled: true,
        departmentId: DEPARTMENT_ID,
        mainFunction: "Monitora de informática",
        joinedAt: "2026-10-01",
        reviewNote: "Documentos conferidos.",
      });
      expectNoSensitiveValue(JSON.stringify(event));
    });

    it("does not emit when the transaction fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("deadlock detected"));

      await expect(service.approve(PERSON_ID, DTO, ACTOR_ID)).rejects.toThrow("deadlock detected");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("reject()", () => {
    const DTO = { note: "O RA informado não confere com o termo de voluntariado." };

    beforeEach(() => {
      state.personById = buildPerson({ role: null, accessEnabled: false });
      state.profile = buildProfile();
    });

    it("stores the note, reviewer and date and keeps role null and access disabled", async () => {
      const response = await service.reject(PERSON_ID, DTO, ACTOR_ID);

      expect(state.profile).toMatchObject({
        registrationStatus: MemberRegistrationStatus.REJECTED,
        reviewNote: DTO.note,
        reviewedAt: NOW,
        reviewedById: ACTOR_ID,
        mainFunction: null,
        joinedAt: null,
      });
      expect(state.personById).toMatchObject({ role: null, accessEnabled: false });
      // Only the profile is written: the Person and its password stay untouched.
      expect(savedOf(Person)).toEqual([]);
      expect(response).toMatchObject({
        registrationStatus: MemberRegistrationStatus.REJECTED,
        role: null,
        accessEnabled: false,
        reviewNote: DTO.note,
        reviewedById: ACTOR_ID,
      });
    });

    it("throws 409 REGISTRATION_NOT_PENDING when the registration is not pending", async () => {
      for (const status of [MemberRegistrationStatus.APPROVED, MemberRegistrationStatus.REJECTED]) {
        state.profile = buildProfile({ registrationStatus: status });

        const failure = await httpFailure(service.reject(PERSON_ID, DTO, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect((failure.getResponse() as { error: string }).error).toBe("REGISTRATION_NOT_PENDING");
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 404 MEMBER_REGISTRATION_NOT_FOUND when the person has no member profile", async () => {
      state.profile = null;

      const failure = await httpFailure(service.reject(PERSON_ID, DTO, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect((failure.getResponse() as { error: string }).error).toBe(
        "MEMBER_REGISTRATION_NOT_FOUND",
      );
    });

    it("emits MEMBER_REGISTRATION_REJECTED after commit with the note and no personal data", async () => {
      const order: string[] = [];
      dataSource.transaction.mockImplementation(async (callback: (m: unknown) => unknown) => {
        const result = await callback(manager);
        order.push("commit");
        return result;
      });
      eventEmitter.emit.mockImplementation(() => order.push("emit"));

      await service.reject(PERSON_ID, DTO, ACTOR_ID);

      expect(order).toEqual(["commit", "emit"]);
      const [event] = emittedEvents();
      expect(event).toMatchObject({
        actorId: ACTOR_ID,
        action: AuditableAction.MEMBER_REGISTRATION_REJECTED,
        targetType: "member",
        targetId: PERSON_ID,
        occurredAt: NOW,
      });
      expect(event.before).toStrictEqual({ registrationStatus: MemberRegistrationStatus.PENDING });
      expect(event.after).toStrictEqual({
        registrationStatus: MemberRegistrationStatus.REJECTED,
        reviewNote: DTO.note,
      });
      expectNoSensitiveValue(JSON.stringify(event));
    });

    it("does not emit when the transaction fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.reject(PERSON_ID, DTO, ACTOR_ID)).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("privacy", () => {
    it("never logs cpf, address, phone or e-mails", async () => {
      const spies = [
        jest.spyOn(Logger.prototype, "log"),
        jest.spyOn(Logger.prototype, "error"),
        jest.spyOn(Logger.prototype, "warn"),
        jest.spyOn(Logger.prototype, "debug"),
        jest.spyOn(Logger.prototype, "verbose"),
        jest.spyOn(console, "log"),
        jest.spyOn(console, "error"),
        jest.spyOn(console, "warn"),
      ].map((spy) => spy.mockImplementation(() => undefined));

      try {
        await service.submitFromInvite(manager as unknown as EntityManager, INPUT);

        state.personById = buildPerson({ role: null, accessEnabled: false });
        state.profile = buildProfile();
        await service.approve(
          PERSON_ID,
          {
            role: Role.MEMBER,
            departmentId: DEPARTMENT_ID,
            mainFunction: "Monitora de informática",
            joinedAt: "2026-10-01",
          },
          ACTOR_ID,
        );

        state.profile = buildProfile();
        state.personById = buildPerson({ role: null, accessEnabled: false });
        await service.reject(PERSON_ID, { note: "O RA não confere." }, ACTOR_ID);

        // A failing path too: errors must not carry values either.
        state.personByRa = buildPerson({ role: Role.MEMBER });
        await service
          .submitFromInvite(manager as unknown as EntityManager, INPUT)
          .catch((error: unknown) => expectNoSensitiveValue(JSON.stringify(error)));

        for (const spy of spies) {
          expectNoSensitiveValue(JSON.stringify(spy.mock.calls));
        }
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });
  });

  describe("memberRegistrationNotFound()", () => {
    it("builds the 404 shared by the service and the id pipe of the controller", () => {
      const error = memberRegistrationNotFound();

      expect(error.getStatus()).toBe(404);
      expect(error.getResponse()).toEqual({
        error: "MEMBER_REGISTRATION_NOT_FOUND",
        message: "Member registration not found.",
      });
    });
  });
});
