import "reflect-metadata";
import { HttpException, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { UpdateMemberDto } from "../dto/update-member.dto";
import { Department } from "../entities/department.entity";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { MemberStatus } from "../enums/member-status.enum";
import { DepartmentsService } from "../services/departments.service";
import {
  MembersService,
  SubmitMemberRegistrationInput,
  memberInactive,
  memberNotFound,
  memberRegistrationNotFound,
} from "../services/members.service";
import { PeopleService, lastCoordinator } from "../services/people.service";

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
const OTHER_DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000002";
const INVITE_ID = "01999a3e-2222-7000-8000-000000000001";

// Who reads the member record (GUS-144): the department scope comes from AuthUser.departmentIds,
// filled by the AuthGuard from the approved profile of the actor.
const COORDINATOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000c0",
  role: Role.COORDINATOR,
  accessEnabled: true,
  departmentIds: [],
};
const SUPERADMIN: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000c1",
  role: Role.SUPERADMIN,
  accessEnabled: true,
  departmentIds: [],
};
const DIRECTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000d0",
  role: Role.DIRECTOR,
  accessEnabled: true,
  departmentIds: [DEPARTMENT_ID],
};
const DIRECTOR_OF_OTHER_DEPARTMENT: AuthUser = {
  ...DIRECTOR,
  departmentIds: [OTHER_DEPARTMENT_ID],
};
const DIRECTOR_WITHOUT_DEPARTMENT: AuthUser = { ...DIRECTOR, departmentIds: [] };
const MEMBER: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000e0",
  role: Role.MEMBER,
  accessEnabled: true,
  departmentIds: [DEPARTMENT_ID],
};

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
    status: MemberStatus.ACTIVE,
    exitDate: null,
    exitReason: null,
    exitNote: null,
    deactivatedAt: null,
    deactivatedById: null,
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
  let policy: PermissionPolicy;
  let state: {
    personByRa: Person | null;
    personByEmail: Person | null;
    personById: Person | null;
    profile: MemberProfile | null;
    department: Department | null;
    reviewer: Person | null;
  };

  const manager = { create: jest.fn(), save: jest.fn(), findOne: jest.fn() };
  const profileRepository = { findOne: jest.fn() };
  const personRepository = { findOne: jest.fn() };
  const departmentRepository = { findOne: jest.fn() };
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  const departments = { exists: jest.fn() };
  const people = { assertNotLastActiveCoordinator: jest.fn() };

  /** dataSource.transaction(callback) or transaction(isolationLevel, callback), run on `manager`. */
  function runTransaction(args: unknown[]): unknown {
    return (args[args.length - 1] as (m: unknown) => unknown)(manager);
  }

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

  /**
   * getMember reads through the repositories of the DataSource, not through the transaction
   * manager: answer them from `state` (the target, her profile, the department, the reviewer).
   */
  function answerMemberRecordFromState(): void {
    personRepository.findOne.mockImplementation(async (options: { where: { id: string } }) => {
      if (options.where.id === PERSON_ID) return state.personById;
      if (options.where.id === ACTOR_ID) return state.reviewer;
      return null;
    });
    profileRepository.findOne.mockImplementation(async () => state.profile);
    departmentRepository.findOne.mockImplementation(async () => state.department);
  }

  beforeEach(() => {
    jest.resetAllMocks();
    state = {
      personByRa: null,
      personByEmail: null,
      personById: null,
      profile: null,
      department: buildDepartment(),
      reviewer: null,
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
    dataSource.transaction.mockImplementation(async (...args: unknown[]) => runTransaction(args));
    dataSource.getRepository.mockImplementation((entity: unknown) => {
      if (entity === MemberProfile) return profileRepository;
      if (entity === Person) return personRepository;
      return departmentRepository;
    });
    clock.now.mockReturnValue(NOW);
    departments.exists.mockResolvedValue(true);

    // The real policy (pure): the scope rules are part of what getMember has to get right. A new
    // instance per test, so a spy on it never leaks into the next one.
    policy = new PermissionPolicy();
    service = new MembersService(
      dataSource as unknown as DataSource,
      eventEmitter as unknown as EventEmitter2,
      clock as unknown as Clock,
      departments as unknown as DepartmentsService,
      policy,
      people as unknown as PeopleService,
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

  describe("getMember()", () => {
    const FORBIDDEN_SCOPE_BODY = {
      error: "FORBIDDEN_SCOPE",
      message: "You do not have access to this resource.",
    };
    const NOT_FOUND_BODY = { error: "MEMBER_NOT_FOUND", message: "Member not found." };

    beforeEach(() => {
      // An approved member of DEPARTMENT_ID, approved by Carla (ACTOR_ID).
      state.personById = buildPerson({ role: Role.MEMBER, accessEnabled: true });
      state.profile = buildProfile({
        registrationStatus: MemberRegistrationStatus.APPROVED,
        mainFunction: "Monitora de informática",
        joinedAt: "2026-10-01",
        reviewedAt: NOW,
        reviewedById: ACTOR_ID,
      });
      state.reviewer = buildPerson({
        id: ACTOR_ID,
        name: "Carla Menezes",
        role: Role.COORDINATOR,
        accessEnabled: true,
      });
      answerMemberRecordFromState();
    });

    it("returns the detail to a coordinator for a member of any department", async () => {
      // The coordinator has no department of her own: coordination reads every department.
      const detail = await service.getMember(PERSON_ID, COORDINATOR);

      expect(detail).toMatchObject({
        id: PERSON_ID,
        name: "Ana Torres",
        ra: "a2210001",
        role: Role.MEMBER,
        accessEnabled: true,
        cpfMasked: "***.***.247-25",
        department: { id: DEPARTMENT_ID, name: "Tecnologia" },
        mainFunction: "Monitora de informática",
        joinedAt: "2026-10-01",
        registrationStatus: MemberRegistrationStatus.APPROVED,
        reviewedAt: NOW,
        reviewedBy: { id: ACTOR_ID, name: "Carla Menezes" },
      });
      // The full CPF has no key and no digit in the answer.
      expect(detail).not.toHaveProperty("cpf");
      expect(JSON.stringify(detail)).not.toContain("52998224725");
      // The target, her profile, the department of the profile and the reviewer.
      expect(personRepository.findOne).toHaveBeenCalledWith({ where: { id: PERSON_ID } });
      expect(profileRepository.findOne).toHaveBeenCalledWith({ where: { personId: PERSON_ID } });
      expect(departmentRepository.findOne).toHaveBeenCalledWith({ where: { id: DEPARTMENT_ID } });
      expect(personRepository.findOne).toHaveBeenCalledWith({ where: { id: ACTOR_ID } });
    });

    it("returns the detail to a superadmin", async () => {
      await expect(service.getMember(PERSON_ID, SUPERADMIN)).resolves.toMatchObject({
        id: PERSON_ID,
        name: "Ana Torres",
      });
    });

    it("returns the detail to a director of the same department", async () => {
      const assertCan = jest.spyOn(policy, "assertCan");

      const detail = await service.getMember(PERSON_ID, DIRECTOR);

      expect(detail).toMatchObject({
        id: PERSON_ID,
        department: { id: DEPARTMENT_ID, name: "Tecnologia" },
      });
      // The scope of the target is the department of her APPROVED profile.
      expect(assertCan).toHaveBeenCalledWith(DIRECTOR, Permission.MEMBERS_VIEW, {
        personId: PERSON_ID,
        departmentIds: [DEPARTMENT_ID],
      });
    });

    it("throws FORBIDDEN_SCOPE to a director of another department", async () => {
      const failure = await httpFailure(service.getMember(PERSON_ID, DIRECTOR_OF_OTHER_DEPARTMENT));

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toEqual(FORBIDDEN_SCOPE_BODY);
      // Nothing else is read for somebody who may not see the record.
      expect(departmentRepository.findOne).not.toHaveBeenCalled();
      expect(personRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it("throws FORBIDDEN_SCOPE to a director for a pending registration suggesting the director's department", async () => {
      const assertCan = jest.spyOn(policy, "assertCan");
      state.personById = buildPerson({ role: null, accessEnabled: false });
      state.profile = buildProfile({
        registrationStatus: MemberRegistrationStatus.PENDING,
        departmentId: DEPARTMENT_ID,
      });

      const failure = await httpFailure(service.getMember(PERSON_ID, DIRECTOR));

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toEqual(FORBIDDEN_SCOPE_BODY);
      // The suggested department never gives scope: the target has none.
      expect(assertCan).toHaveBeenCalledWith(DIRECTOR, Permission.MEMBERS_VIEW, {
        personId: PERSON_ID,
        departmentIds: [],
      });
    });

    it("throws FORBIDDEN_SCOPE to a director for a rejected registration of the director's department", async () => {
      state.personById = buildPerson({ role: null, accessEnabled: false });
      state.profile = buildProfile({
        registrationStatus: MemberRegistrationStatus.REJECTED,
        departmentId: DEPARTMENT_ID,
      });

      const failure = await httpFailure(service.getMember(PERSON_ID, DIRECTOR));

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toEqual(FORBIDDEN_SCOPE_BODY);
    });

    it("throws FORBIDDEN_SCOPE to a director for a coordinator without member profile", async () => {
      state.personById = buildPerson({ role: Role.COORDINATOR, accessEnabled: true });
      state.profile = null;

      const failure = await httpFailure(service.getMember(PERSON_ID, DIRECTOR));

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toEqual(FORBIDDEN_SCOPE_BODY);
    });

    it("throws FORBIDDEN_SCOPE to a director without department, even for the own record", async () => {
      const other = await httpFailure(service.getMember(PERSON_ID, DIRECTOR_WITHOUT_DEPARTMENT));
      expect(other.getStatus()).toBe(403);
      expect(other.getResponse()).toEqual(FORBIDDEN_SCOPE_BODY);

      // The own data of a director lives in GET /members/me, not here.
      const own = await httpFailure(
        service.getMember(PERSON_ID, { ...DIRECTOR_WITHOUT_DEPARTMENT, id: PERSON_ID }),
      );
      expect(own.getStatus()).toBe(403);
      expect(own.getResponse()).toEqual(FORBIDDEN_SCOPE_BODY);
    });

    it("throws FORBIDDEN_SCOPE to a member (the guard answers first; this is the second line)", async () => {
      const failure = await httpFailure(service.getMember(PERSON_ID, MEMBER));

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toEqual(FORBIDDEN_SCOPE_BODY);
    });

    it("returns member fields null for a person with role and no profile", async () => {
      // The seeded admin: an access role, no member profile (so no department nor reviewer).
      state.personById = buildPerson({
        role: Role.SUPERADMIN,
        accessEnabled: true,
        birthDate: null,
        phone: null,
      });
      state.profile = null;

      const detail = await service.getMember(PERSON_ID, COORDINATOR);

      expect(detail).toMatchObject({
        id: PERSON_ID,
        role: Role.SUPERADMIN,
        accessEnabled: true,
        birthDate: null,
        phone: null,
        registrationStatus: null,
        cpfMasked: null,
        address: null,
        city: null,
        state: null,
        institutionalEmail: null,
        course: null,
        semester: null,
        className: null,
        department: null,
        mainFunction: null,
        joinedAt: null,
        volunteerTermUrl: null,
        reviewedAt: null,
        reviewedBy: null,
      });
      expect(departmentRepository.findOne).not.toHaveBeenCalled();
      // Only the target: there is no reviewer to look for.
      expect(personRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it("loads the department of a pending registration for coordination, only the scope ignores it", async () => {
      state.personById = buildPerson({ role: null, accessEnabled: false });
      state.profile = buildProfile({
        registrationStatus: MemberRegistrationStatus.PENDING,
        reviewedAt: null,
        reviewedById: null,
      });

      const detail = await service.getMember(PERSON_ID, COORDINATOR);

      expect(detail).toMatchObject({
        role: null,
        accessEnabled: false,
        registrationStatus: MemberRegistrationStatus.PENDING,
        department: { id: DEPARTMENT_ID, name: "Tecnologia" },
        reviewedAt: null,
        reviewedBy: null,
      });
      expect(departmentRepository.findOne).toHaveBeenCalledWith({ where: { id: DEPARTMENT_ID } });
    });

    it("does not look for a department nor a reviewer that the profile does not have", async () => {
      state.profile = buildProfile({
        registrationStatus: MemberRegistrationStatus.APPROVED,
        departmentId: null,
        reviewedAt: null,
        reviewedById: null,
      });

      const detail = await service.getMember(PERSON_ID, COORDINATOR);

      // Approved before the validation existed (backfill): no reviewer, and no department here.
      expect(detail).toMatchObject({ department: null, reviewedAt: null, reviewedBy: null });
      expect(departmentRepository.findOne).not.toHaveBeenCalled();
      expect(personRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it("throws 404 MEMBER_NOT_FOUND for an unknown id", async () => {
      state.personById = null;

      const failure = await httpFailure(service.getMember(PERSON_ID, COORDINATOR));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual(NOT_FOUND_BODY);
      expect(profileRepository.findOne).not.toHaveBeenCalled();
    });

    it("throws 404 MEMBER_NOT_FOUND for a person without role nor profile", async () => {
      state.personById = buildPerson({ role: null, accessEnabled: false });
      state.profile = null;

      const failure = await httpFailure(service.getMember(PERSON_ID, COORDINATOR));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual(NOT_FOUND_BODY);
    });

    it("throws 404 MEMBER_NOT_FOUND for a malformed id without querying", async () => {
      for (const id of ["not-a-uuid", "", "me", "123", `${PERSON_ID}-x`]) {
        const failure = await httpFailure(service.getMember(id, COORDINATOR));

        expect(failure.getStatus()).toBe(404);
        expect(failure.getResponse()).toEqual(NOT_FOUND_BODY);
      }
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it("checks 404 before scope: a director asking for an unknown id gets 404, not 403", async () => {
      const assertCan = jest.spyOn(policy, "assertCan");
      state.personById = null;

      const failure = await httpFailure(service.getMember(PERSON_ID, DIRECTOR_OF_OTHER_DEPARTMENT));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual(NOT_FOUND_BODY);
      expect(assertCan).not.toHaveBeenCalled();
    });

    it("returns reviewedBy null when the reviewer no longer exists", async () => {
      // A deleted person is not returned by the repository.
      state.reviewer = null;

      const detail = await service.getMember(PERSON_ID, COORDINATOR);

      expect(detail.reviewedBy).toBeNull();
      // The rest of the review is still there.
      expect(detail.reviewedAt).toEqual(NOW);
      expect(detail.registrationStatus).toBe(MemberRegistrationStatus.APPROVED);
    });
  });

  describe("deactivateMember()", () => {
    const DEACTIVATION = {
      exitDate: "2026-09-30",
      reason: "Formou-se.",
      note: "Vai fazer mestrado em outra cidade.",
    };
    const NOT_FOUND_BODY = { error: "MEMBER_NOT_FOUND", message: "Member not found." };

    function activeMemberProfile(overrides: Partial<MemberProfile> = {}): MemberProfile {
      return buildProfile({
        registrationStatus: MemberRegistrationStatus.APPROVED,
        joinedAt: "2026-03-01",
        reviewedById: ACTOR_ID,
        ...overrides,
      });
    }

    beforeEach(() => {
      state.personById = buildPerson({ role: Role.MEMBER, accessEnabled: true });
      state.profile = activeMemberProfile();
      answerMemberRecordFromState();
    });

    it("throws 404 MEMBER_NOT_FOUND for a malformed id without opening a transaction", async () => {
      for (const id of ["not-a-uuid", "", "me", `${PERSON_ID}-x`]) {
        const failure = await httpFailure(service.deactivateMember(id, DEACTIVATION, COORDINATOR));

        expect(failure.getStatus()).toBe(404);
        expect(failure.getResponse()).toEqual(NOT_FOUND_BODY);
      }
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("throws 403 OWN_ACCOUNT before opening a transaction when the actor targets herself", async () => {
      const failure = await httpFailure(
        service.deactivateMember(COORDINATOR.id, DEACTIVATION, COORDINATOR),
      );

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toEqual({
        error: "OWN_ACCOUNT",
        message: "Cannot act on your own account.",
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("throws 403 OWN_ACCOUNT before opening a transaction when the actor sends her own id in upper case", async () => {
      const ownIdUpperCase = COORDINATOR.id.toUpperCase();
      expect(ownIdUpperCase).not.toBe(COORDINATOR.id);

      const failure = await httpFailure(
        service.deactivateMember(ownIdUpperCase, DEACTIVATION, COORDINATOR),
      );

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toEqual({
        error: "OWN_ACCOUNT",
        message: "Cannot act on your own account.",
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("locks and reports the target by the lower-case id when the path id comes in upper case", async () => {
      await service.deactivateMember(PERSON_ID.toUpperCase(), DEACTIVATION, COORDINATOR);

      const locked = manager.findOne.mock.calls
        .filter((call) => call[1]?.lock?.mode === "pessimistic_write")
        .map((call) => call[1].where);
      expect(locked).toEqual([{ id: PERSON_ID }, { personId: PERSON_ID }]);
      expect(emittedEvents()[0].targetId).toBe(PERSON_ID);
    });

    it("throws 404 MEMBER_NOT_FOUND for an unknown id and for a person without role nor profile", async () => {
      state.personById = null;
      const unknown = await httpFailure(
        service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR),
      );
      expect(unknown.getStatus()).toBe(404);
      expect(unknown.getResponse()).toEqual(NOT_FOUND_BODY);

      state.personById = buildPerson({ role: null, accessEnabled: false });
      state.profile = null;
      const notAMember = await httpFailure(
        service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR),
      );
      expect(notAMember.getStatus()).toBe(404);
      expect(notAMember.getResponse()).toEqual(NOT_FOUND_BODY);

      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 409 NO_MEMBER_PROFILE for a person with role and no member profile", async () => {
      for (const role of [Role.SUPERADMIN, Role.COORDINATOR]) {
        state.personById = buildPerson({ role, accessEnabled: true });
        state.profile = null;

        const failure = await httpFailure(
          service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR),
        );

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "NO_MEMBER_PROFILE",
          message: "This person has no member profile.",
        });
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(people.assertNotLastActiveCoordinator).not.toHaveBeenCalled();
    });

    it("throws 409 REGISTRATION_NOT_APPROVED for a pending and for a rejected registration", async () => {
      for (const registrationStatus of [
        MemberRegistrationStatus.PENDING,
        MemberRegistrationStatus.REJECTED,
      ]) {
        state.personById = buildPerson({ role: null, accessEnabled: false });
        state.profile = buildProfile({ registrationStatus });

        const failure = await httpFailure(
          service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR),
        );

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "REGISTRATION_NOT_APPROVED",
          message: "Only members with an approved registration can be deactivated.",
        });
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 409 MEMBER_INACTIVE for a member that is already inactive, without writing", async () => {
      state.personById = buildPerson({ role: Role.MEMBER, accessEnabled: false });
      state.profile = activeMemberProfile({
        status: MemberStatus.INACTIVE,
        exitDate: "2026-08-01",
        exitReason: "Mudou de cidade.",
      });

      const failure = await httpFailure(
        service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "MEMBER_INACTIVE",
        message: "The member is inactive.",
      });
      expect(state.profile).toMatchObject({
        exitDate: "2026-08-01",
        exitReason: "Mudou de cidade.",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 400 EXIT_DATE_BEFORE_JOINED_AT pointing at exitDate when the exit is before the join date", async () => {
      const failure = await httpFailure(
        service.deactivateMember(
          PERSON_ID,
          { ...DEACTIVATION, exitDate: "2026-02-28" },
          COORDINATOR,
        ),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "EXIT_DATE_BEFORE_JOINED_AT",
        message: "exitDate must be on or after the join date.",
        details: [{ field: "exitDate", message: "exitDate must be on or after the join date" }],
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("accepts an exit on the join date and any exit when the profile has no join date", async () => {
      await service.deactivateMember(
        PERSON_ID,
        { ...DEACTIVATION, exitDate: "2026-03-01" },
        COORDINATOR,
      );
      expect(savedOf(MemberProfile)[0]).toMatchObject({
        status: MemberStatus.INACTIVE,
        exitDate: "2026-03-01",
      });

      state.personById = buildPerson({ role: Role.MEMBER, accessEnabled: true });
      state.profile = activeMemberProfile({ joinedAt: null });
      await service.deactivateMember(
        PERSON_ID,
        { ...DEACTIVATION, exitDate: "2000-01-01" },
        COORDINATOR,
      );
      expect(state.profile).toMatchObject({
        status: MemberStatus.INACTIVE,
        exitDate: "2000-01-01",
      });
    });

    it("locks Person and then the profile, in a SERIALIZABLE transaction", async () => {
      await service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(dataSource.transaction.mock.calls[0][0]).toBe("SERIALIZABLE");
      const locked = manager.findOne.mock.calls
        .filter((call) => call[1]?.lock?.mode === "pessimistic_write")
        .map((call) => [call[0], call[1].where]);
      expect(locked).toEqual([
        [Person, { id: PERSON_ID }],
        [MemberProfile, { personId: PERSON_ID }],
      ]);
      const lastLock = Math.max(...manager.findOne.mock.invocationCallOrder);
      expect(Math.min(...manager.save.mock.invocationCallOrder)).toBeGreaterThan(lastLock);
    });

    it("sets status inactive, exit date, reason, note, who and when, and disables the access in the same transaction", async () => {
      await service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(savedOf(MemberProfile)).toHaveLength(1);
      expect(savedOf(MemberProfile)[0]).toMatchObject({
        status: MemberStatus.INACTIVE,
        exitDate: "2026-09-30",
        exitReason: "Formou-se.",
        exitNote: "Vai fazer mestrado em outra cidade.",
        deactivatedAt: NOW,
        deactivatedById: COORDINATOR.id,
        registrationStatus: MemberRegistrationStatus.APPROVED,
        reviewedById: ACTOR_ID,
      });
      expect(savedOf(Person)).toHaveLength(1);
      expect(savedOf(Person)[0]).toMatchObject({
        id: PERSON_ID,
        role: Role.MEMBER,
        accessEnabled: false,
      });
    });

    it("stores a null note when none is sent", async () => {
      const { note: _omitted, ...withoutNote } = DEACTIVATION;

      await service.deactivateMember(PERSON_ID, withoutNote, COORDINATOR);
      expect(savedOf(MemberProfile)[0].exitNote).toBeNull();

      state.personById = buildPerson({ role: Role.MEMBER, accessEnabled: true });
      state.profile = activeMemberProfile();
      await service.deactivateMember(PERSON_ID, { ...DEACTIVATION, note: null }, COORDINATOR);
      expect(state.profile).toMatchObject({ status: MemberStatus.INACTIVE, exitNote: null });
    });

    it("checks LAST_COORDINATOR on the transaction manager for an active coordinator target and propagates the 409 without writing", async () => {
      state.personById = buildPerson({ role: Role.COORDINATOR, accessEnabled: true });
      people.assertNotLastActiveCoordinator.mockRejectedValue(lastCoordinator());

      const failure = await httpFailure(
        service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "LAST_COORDINATOR",
        message: "Cannot demote or disable the last active coordinator.",
      });
      expect(people.assertNotLastActiveCoordinator).toHaveBeenCalledTimes(1);
      expect(people.assertNotLastActiveCoordinator).toHaveBeenCalledWith(manager);
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();

      people.assertNotLastActiveCoordinator.mockResolvedValue(undefined);
      await expect(
        service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR),
      ).resolves.toMatchObject({ status: MemberStatus.INACTIVE, accessEnabled: false });
    });

    it("skips LAST_COORDINATOR for a superadmin actor and for a target that is not a coordinator", async () => {
      state.personById = buildPerson({ role: Role.COORDINATOR, accessEnabled: true });
      await service.deactivateMember(PERSON_ID, DEACTIVATION, SUPERADMIN);

      for (const role of [Role.MEMBER, Role.DIRECTOR]) {
        state.personById = buildPerson({ role, accessEnabled: true });
        state.profile = activeMemberProfile();
        await service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR);
      }

      expect(people.assertNotLastActiveCoordinator).not.toHaveBeenCalled();
      expect(savedOf(Person)).toHaveLength(3);
    });

    it("skips LAST_COORDINATOR for a coordinator target whose access is already disabled, and deactivates her", async () => {
      state.personById = buildPerson({ role: Role.COORDINATOR, accessEnabled: false });
      people.assertNotLastActiveCoordinator.mockRejectedValue(lastCoordinator());

      const record = await service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR);

      expect(people.assertNotLastActiveCoordinator).not.toHaveBeenCalled();
      expect(savedOf(MemberProfile)[0]).toMatchObject({
        status: MemberStatus.INACTIVE,
        exitDate: "2026-09-30",
      });
      expect(savedOf(Person)[0]).toMatchObject({ role: Role.COORDINATOR, accessEnabled: false });
      expect(record).toMatchObject({ status: MemberStatus.INACTIVE, accessEnabled: false });
    });

    it("emits MEMBER_DEACTIVATED after the commit with status, access, exitDate and exitReason, never the note", async () => {
      const order: string[] = [];
      dataSource.transaction.mockImplementation(async (...args: unknown[]) => {
        const result = await runTransaction(args);
        order.push("commit");
        return result;
      });
      eventEmitter.emit.mockImplementation(() => order.push("emit"));

      await service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR);

      expect(order).toEqual(["commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit.mock.calls[0][0]).toBe(AUDITABLE_ACTION_EVENT);
      const [event] = emittedEvents();
      expect(event).toMatchObject({
        actorId: COORDINATOR.id,
        action: AuditableAction.MEMBER_DEACTIVATED,
        targetType: "member",
        targetId: PERSON_ID,
        occurredAt: NOW,
      });
      expect(event.before).toStrictEqual({ status: MemberStatus.ACTIVE, accessEnabled: true });
      expect(event.after).toStrictEqual({
        status: MemberStatus.INACTIVE,
        accessEnabled: false,
        exitDate: "2026-09-30",
        exitReason: "Formou-se.",
      });
      expect(JSON.stringify(event)).not.toContain(DEACTIVATION.note);
      expectNoSensitiveValue(JSON.stringify(event));
    });

    it("does not emit when the transaction fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("could not serialize access"));

      await expect(service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR)).rejects.toThrow(
        "could not serialize access",
      );

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("answers the member record with status inactive, exitDate, exitReason and accessEnabled false", async () => {
      state.reviewer = buildPerson({
        id: ACTOR_ID,
        name: "Carla Menezes",
        role: Role.COORDINATOR,
        accessEnabled: true,
      });

      const record = await service.deactivateMember(PERSON_ID, DEACTIVATION, COORDINATOR);

      expect(record).toMatchObject({
        id: PERSON_ID,
        role: Role.MEMBER,
        accessEnabled: false,
        registrationStatus: MemberRegistrationStatus.APPROVED,
        status: MemberStatus.INACTIVE,
        exitDate: "2026-09-30",
        exitReason: "Formou-se.",
        department: { id: DEPARTMENT_ID, name: "Tecnologia" },
        reviewedBy: { id: ACTOR_ID, name: "Carla Menezes" },
      });
      expect(record).not.toHaveProperty("exitNote");
      expect(JSON.stringify(record)).not.toContain(DEACTIVATION.note);
      expect(departmentRepository.findOne).toHaveBeenCalledWith({ where: { id: DEPARTMENT_ID } });
      expect(personRepository.findOne).toHaveBeenCalledWith({ where: { id: ACTOR_ID } });
    });
  });

  describe("reactivateMember()", () => {
    const NOT_FOUND_BODY = { error: "MEMBER_NOT_FOUND", message: "Member not found." };
    const NOTE = "Vai fazer mestrado em outra cidade.";

    beforeEach(() => {
      state.personById = buildPerson({ role: Role.MEMBER, accessEnabled: false });
      state.profile = buildProfile({
        registrationStatus: MemberRegistrationStatus.APPROVED,
        joinedAt: "2026-03-01",
        reviewedById: ACTOR_ID,
        status: MemberStatus.INACTIVE,
        exitDate: "2026-09-30",
        exitReason: "Formou-se.",
        exitNote: NOTE,
        deactivatedAt: NOW,
        deactivatedById: COORDINATOR.id,
      });
      answerMemberRecordFromState();
    });

    it("throws 404 MEMBER_NOT_FOUND for a malformed or unknown id", async () => {
      const malformed = await httpFailure(service.reactivateMember("not-a-uuid", COORDINATOR));
      expect(malformed.getStatus()).toBe(404);
      expect(malformed.getResponse()).toEqual(NOT_FOUND_BODY);
      expect(dataSource.transaction).not.toHaveBeenCalled();

      state.personById = null;
      const unknown = await httpFailure(service.reactivateMember(PERSON_ID, COORDINATOR));
      expect(unknown.getStatus()).toBe(404);
      expect(unknown.getResponse()).toEqual(NOT_FOUND_BODY);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws 403 OWN_ACCOUNT before opening a transaction when the actor targets herself", async () => {
      const failure = await httpFailure(service.reactivateMember(COORDINATOR.id, COORDINATOR));

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toEqual({
        error: "OWN_ACCOUNT",
        message: "Cannot act on your own account.",
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("throws 403 OWN_ACCOUNT before opening a transaction when the actor sends her own id in upper case", async () => {
      const ownIdUpperCase = COORDINATOR.id.toUpperCase();
      expect(ownIdUpperCase).not.toBe(COORDINATOR.id);

      const failure = await httpFailure(service.reactivateMember(ownIdUpperCase, COORDINATOR));

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toEqual({
        error: "OWN_ACCOUNT",
        message: "Cannot act on your own account.",
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("sets status active and clears exit date, reason, note, who and when, without touching the access", async () => {
      const record = await service.reactivateMember(PERSON_ID, COORDINATOR);

      expect(savedOf(MemberProfile)).toHaveLength(1);
      expect(savedOf(MemberProfile)[0]).toMatchObject({
        status: MemberStatus.ACTIVE,
        exitDate: null,
        exitReason: null,
        exitNote: null,
        deactivatedAt: null,
        deactivatedById: null,
        registrationStatus: MemberRegistrationStatus.APPROVED,
      });
      expect(savedOf(Person)).toEqual([]);
      expect(state.personById).toMatchObject({ accessEnabled: false });
      expect(dataSource.transaction.mock.calls[0]).toHaveLength(1);
      expect(people.assertNotLastActiveCoordinator).not.toHaveBeenCalled();
      const locked = manager.findOne.mock.calls
        .filter((call) => call[1]?.lock?.mode === "pessimistic_write")
        .map((call) => call[0]);
      expect(locked).toEqual([Person, MemberProfile]);
      expect(record).toMatchObject({
        id: PERSON_ID,
        status: MemberStatus.ACTIVE,
        exitDate: null,
        exitReason: null,
        accessEnabled: false,
      });
    });

    it("answers 200 without writing nor emitting for an active member, a pending registration and a person with role and no profile", async () => {
      const cases: Array<[Person, MemberProfile | null]> = [
        [
          buildPerson({ role: Role.MEMBER, accessEnabled: true }),
          buildProfile({ registrationStatus: MemberRegistrationStatus.APPROVED }),
        ],
        [
          buildPerson({ role: null, accessEnabled: false }),
          buildProfile({ registrationStatus: MemberRegistrationStatus.PENDING }),
        ],
        [buildPerson({ role: Role.COORDINATOR, accessEnabled: true }), null],
      ];

      for (const [person, profile] of cases) {
        state.personById = person;
        state.profile = profile;

        const record = await service.reactivateMember(PERSON_ID, COORDINATOR);

        expect(record).toMatchObject({
          id: PERSON_ID,
          status: MemberStatus.ACTIVE,
          exitDate: null,
          exitReason: null,
          accessEnabled: person.accessEnabled,
        });
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits MEMBER_REACTIVATED after the commit with the exit it cleared", async () => {
      const order: string[] = [];
      dataSource.transaction.mockImplementation(async (...args: unknown[]) => {
        const result = await runTransaction(args);
        order.push("commit");
        return result;
      });
      eventEmitter.emit.mockImplementation(() => order.push("emit"));

      await service.reactivateMember(PERSON_ID, COORDINATOR);

      expect(order).toEqual(["commit", "emit"]);
      const [event] = emittedEvents();
      expect(event).toMatchObject({
        actorId: COORDINATOR.id,
        action: AuditableAction.MEMBER_REACTIVATED,
        targetType: "member",
        targetId: PERSON_ID,
        occurredAt: NOW,
      });
      expect(event.before).toStrictEqual({
        status: MemberStatus.INACTIVE,
        exitDate: "2026-09-30",
        exitReason: "Formou-se.",
      });
      expect(event.after).toStrictEqual({
        status: MemberStatus.ACTIVE,
        exitDate: null,
        exitReason: null,
      });
      expect(JSON.stringify(event)).not.toContain(NOTE);
    });

    it("does not emit when the transaction fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.reactivateMember(PERSON_ID, COORDINATOR)).rejects.toThrow(
        "connection lost",
      );

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("updateMember()", () => {
    const NOT_FOUND_BODY = { error: "MEMBER_NOT_FOUND", message: "Member not found." };
    const FORBIDDEN_SCOPE_BODY = {
      error: "FORBIDDEN_SCOPE",
      message: "You do not have access to this resource.",
    };
    const DEPARTMENT_SCOPE_BODY = {
      error: "DEPARTMENT_SCOPE",
      message: "You cannot move a member to a department outside your scope.",
      details: [
        { field: "departmentId", message: "departmentId must be a department of your scope" },
      ],
    };
    const NEW_CPF = "11144477735";
    const PERSON_EDIT = {
      name: "Ana T.",
      ra: "a2219999",
      email: "ana@example.org",
      birthDate: "1998-01-15",
      phone: "41999990000",
    };
    const PROFILE_EDIT = {
      cpf: NEW_CPF,
      address: "Rua das Araucárias, 10",
      city: "Curitiba",
      state: "PR",
      institutionalEmail: "ana@utfpr.edu.br",
      course: "Engenharia de Software",
      semester: 8,
      className: "ES-2025",
      departmentId: OTHER_DEPARTMENT_ID,
      mainFunction: "Professora",
      joinedAt: "2026-02-01",
      volunteerTermUrl: "https://drive.google.com/file/d/novo/view",
    };

    /** The body as the ValidationPipe hands it over: an instance, already validated. */
    function body(values: Partial<UpdateMemberDto>): UpdateMemberDto {
      return Object.assign(new UpdateMemberDto(), values);
    }

    function approvedProfile(overrides: Partial<MemberProfile> = {}): MemberProfile {
      return buildProfile({
        registrationStatus: MemberRegistrationStatus.APPROVED,
        mainFunction: "Monitora de informática",
        joinedAt: "2026-03-01",
        reviewedById: ACTOR_ID,
        ...overrides,
      });
    }

    beforeEach(() => {
      state.personById = buildPerson({ role: Role.MEMBER, accessEnabled: true });
      state.profile = approvedProfile();
      answerMemberRecordFromState();
    });

    it("throws 404 MEMBER_NOT_FOUND for a malformed id without opening a transaction", async () => {
      for (const id of ["not-a-uuid", "", "me", `${PERSON_ID}-x`]) {
        const failure = await httpFailure(
          service.updateMember(id, body({ name: "Ana T." }), COORDINATOR),
        );

        expect(failure.getStatus()).toBe(404);
        expect(failure.getResponse()).toEqual(NOT_FOUND_BODY);
      }
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("throws 404 MEMBER_NOT_FOUND for an unknown id and for a person without role nor profile, without writing", async () => {
      state.personById = null;
      const unknown = await httpFailure(
        service.updateMember(PERSON_ID, body({ name: "Ana T." }), COORDINATOR),
      );
      expect(unknown.getStatus()).toBe(404);
      expect(unknown.getResponse()).toEqual(NOT_FOUND_BODY);

      state.personById = buildPerson({ role: null, accessEnabled: false });
      state.profile = null;
      const notAMember = await httpFailure(
        service.updateMember(PERSON_ID, body({ name: "Ana T." }), COORDINATOR),
      );
      expect(notAMember.getStatus()).toBe(404);
      expect(notAMember.getResponse()).toEqual(NOT_FOUND_BODY);

      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("locks Person and then the profile, in the default isolation, before any write", async () => {
      await service.updateMember(
        PERSON_ID,
        body({ name: "Ana T.", course: "Engenharia de Software" }),
        COORDINATOR,
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(dataSource.transaction.mock.calls[0]).toHaveLength(1);
      const locked = manager.findOne.mock.calls
        .filter((call) => call[1]?.lock?.mode === "pessimistic_write")
        .map((call) => [call[0], call[1].where]);
      expect(locked).toEqual([
        [Person, { id: PERSON_ID }],
        [MemberProfile, { personId: PERSON_ID }],
      ]);
      const lastLock = Math.max(...manager.findOne.mock.invocationCallOrder);
      expect(Math.min(...manager.save.mock.invocationCallOrder)).toBeGreaterThan(lastLock);
    });

    it("uses the id read from the database, not the upper-case path id, for the scope, the event and the answer", async () => {
      const assertCan = jest.spyOn(policy, "assertCan");

      const record = await service.updateMember(
        PERSON_ID.toUpperCase(),
        body({ name: "Ana T." }),
        DIRECTOR,
      );

      expect(assertCan).toHaveBeenCalledWith(DIRECTOR, Permission.MEMBERS_EDIT, {
        personId: PERSON_ID,
        departmentIds: [DEPARTMENT_ID],
      });
      expect(emittedEvents()[0].targetId).toBe(PERSON_ID);
      expect(record.id).toBe(PERSON_ID);
    });

    it("lets coordination and superadmin edit a member of any department", async () => {
      state.profile = approvedProfile({ departmentId: OTHER_DEPARTMENT_ID });

      for (const actor of [COORDINATOR, SUPERADMIN]) {
        const name = `Ana ${actor.role}`;
        await expect(service.updateMember(PERSON_ID, body({ name }), actor)).resolves.toMatchObject(
          { id: PERSON_ID, name },
        );
      }
      expect(savedOf(Person)).toHaveLength(2);
    });

    it("lets a director edit a member of the own department, the own record included", async () => {
      const assertCan = jest.spyOn(policy, "assertCan");

      await expect(
        service.updateMember(PERSON_ID, body({ phone: "41999990000" }), DIRECTOR),
      ).resolves.toMatchObject({ id: PERSON_ID, phone: "41999990000" });
      expect(assertCan).toHaveBeenCalledWith(DIRECTOR, Permission.MEMBERS_EDIT, {
        personId: PERSON_ID,
        departmentIds: [DEPARTMENT_ID],
      });

      state.personById = buildPerson({
        id: DIRECTOR.id,
        role: Role.DIRECTOR,
        accessEnabled: true,
      });
      state.profile = approvedProfile({ personId: DIRECTOR.id });
      await expect(
        service.updateMember(DIRECTOR.id, body({ name: "Diretora" }), DIRECTOR),
      ).resolves.toMatchObject({ id: DIRECTOR.id, name: "Diretora" });

      expect(savedOf(Person)).toHaveLength(2);
    });

    it("throws 403 FORBIDDEN_SCOPE to a director of another department, to one without department and for a target whose registration is not approved, before any 409", async () => {
      for (const actor of [DIRECTOR_OF_OTHER_DEPARTMENT, DIRECTOR_WITHOUT_DEPARTMENT]) {
        const failure = await httpFailure(
          service.updateMember(PERSON_ID, body({ name: "Ana T." }), actor),
        );
        expect(failure.getStatus()).toBe(403);
        expect(failure.getResponse()).toEqual(FORBIDDEN_SCOPE_BODY);
      }

      const targets: Array<[Person, MemberProfile | null]> = [
        [
          buildPerson({ role: null, accessEnabled: false }),
          buildProfile({
            registrationStatus: MemberRegistrationStatus.PENDING,
            departmentId: DEPARTMENT_ID,
          }),
        ],
        [buildPerson({ role: Role.COORDINATOR, accessEnabled: true }), null],
        [
          buildPerson({ role: Role.MEMBER, accessEnabled: false }),
          approvedProfile({ status: MemberStatus.INACTIVE, exitDate: "2026-08-01" }),
        ],
      ];
      for (const [person, profile] of targets) {
        state.personById = person;
        state.profile = profile;
        const actor =
          profile?.status === MemberStatus.INACTIVE ? DIRECTOR_OF_OTHER_DEPARTMENT : DIRECTOR;

        const failure = await httpFailure(
          service.updateMember(PERSON_ID, body({ name: "Ana T." }), actor),
        );
        expect(failure.getStatus()).toBe(403);
        expect(failure.getResponse()).toEqual(FORBIDDEN_SCOPE_BODY);
      }

      expect(manager.save).not.toHaveBeenCalled();
      expect(departments.exists).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 403 FORBIDDEN_SCOPE to a member (the guard answers first; this is the second line)", async () => {
      const failure = await httpFailure(
        service.updateMember(PERSON_ID, body({ name: "Ana T." }), MEMBER),
      );

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toEqual(FORBIDDEN_SCOPE_BODY);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws 403 DEPARTMENT_SCOPE pointing at departmentId when a director moves the member to another department, before MEMBER_INACTIVE and without looking the department up", async () => {
      const can = jest.spyOn(policy, "can");

      const active = await httpFailure(
        service.updateMember(
          PERSON_ID,
          body({ departmentId: OTHER_DEPARTMENT_ID, name: "Ana T." }),
          DIRECTOR,
        ),
      );
      expect(active.getStatus()).toBe(403);
      expect(active.getResponse()).toEqual(DEPARTMENT_SCOPE_BODY);
      expect(can).toHaveBeenCalledWith(DIRECTOR, Permission.MEMBERS_EDIT, {
        departmentIds: [OTHER_DEPARTMENT_ID],
      });

      state.profile = approvedProfile({ status: MemberStatus.INACTIVE, exitDate: "2026-08-01" });
      const inactive = await httpFailure(
        service.updateMember(PERSON_ID, body({ departmentId: OTHER_DEPARTMENT_ID }), DIRECTOR),
      );
      expect(inactive.getStatus()).toBe(403);
      expect(inactive.getResponse()).toEqual(DEPARTMENT_SCOPE_BODY);

      expect(departments.exists).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(state.personById?.name).toBe("Ana Torres");
    });

    it("lets a director keep the current department of the member", async () => {
      const record = await service.updateMember(
        PERSON_ID,
        body({ departmentId: DEPARTMENT_ID, name: "Ana T." }),
        DIRECTOR,
      );

      expect(record).toMatchObject({
        name: "Ana T.",
        department: { id: DEPARTMENT_ID, name: "Tecnologia" },
      });
      expect(departments.exists).not.toHaveBeenCalled();
      expect(savedOf(MemberProfile)).toEqual([]);
      expect(savedOf(Person)).toHaveLength(1);
    });

    it("throws 409 NO_MEMBER_PROFILE for a person with role and no member profile (coordination, superadmin)", async () => {
      for (const role of [Role.SUPERADMIN, Role.COORDINATOR]) {
        state.personById = buildPerson({ role, accessEnabled: true });
        state.profile = null;

        const failure = await httpFailure(
          service.updateMember(PERSON_ID, body({ name: "Ana T." }), COORDINATOR),
        );

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "NO_MEMBER_PROFILE",
          message: "This person has no member profile.",
        });
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 409 REGISTRATION_NOT_APPROVED for a pending and for a rejected registration", async () => {
      for (const registrationStatus of [
        MemberRegistrationStatus.PENDING,
        MemberRegistrationStatus.REJECTED,
      ]) {
        state.personById = buildPerson({ role: null, accessEnabled: false });
        state.profile = buildProfile({ registrationStatus });

        const failure = await httpFailure(
          service.updateMember(PERSON_ID, body({ name: "Ana T." }), COORDINATOR),
        );

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "REGISTRATION_NOT_APPROVED",
          message: "Only members with an approved registration can be edited.",
        });
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 409 MEMBER_INACTIVE for an inactive member, even with an empty body", async () => {
      state.personById = buildPerson({ role: Role.MEMBER, accessEnabled: false });
      state.profile = approvedProfile({
        status: MemberStatus.INACTIVE,
        exitDate: "2026-08-01",
        exitReason: "Mudou de cidade.",
      });

      for (const dto of [body({ name: "Ana T." }), body({})]) {
        const failure = await httpFailure(service.updateMember(PERSON_ID, dto, COORDINATOR));

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "MEMBER_INACTIVE",
          message: "The member is inactive.",
        });
      }
      expect(state.personById).toMatchObject({ name: "Ana Torres" });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 400 DEPARTMENT_NOT_FOUND for an unknown department sent by coordination, looking it up on the transaction manager", async () => {
      departments.exists.mockResolvedValue(false);

      const failure = await httpFailure(
        service.updateMember(
          PERSON_ID,
          body({ departmentId: OTHER_DEPARTMENT_ID, name: "Ana T." }),
          COORDINATOR,
        ),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "DEPARTMENT_NOT_FOUND",
        message: "Department not found.",
      });
      expect(departments.exists).toHaveBeenCalledWith(manager, OTHER_DEPARTMENT_ID);
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("moves the member to another department when coordination sends an existing one", async () => {
      await service.updateMember(
        PERSON_ID,
        body({ departmentId: OTHER_DEPARTMENT_ID }),
        COORDINATOR,
      );

      expect(departments.exists).toHaveBeenCalledWith(manager, OTHER_DEPARTMENT_ID);
      expect(savedOf(MemberProfile)).toHaveLength(1);
      expect(savedOf(MemberProfile)[0].departmentId).toBe(OTHER_DEPARTMENT_ID);
      expect(savedOf(Person)).toEqual([]);
      expect(departmentRepository.findOne).toHaveBeenCalledWith({
        where: { id: OTHER_DEPARTMENT_ID },
      });
    });

    it("writes the Person fields on people and the profile fields on the profile, in the same transaction, and keeps role and accessEnabled", async () => {
      await service.updateMember(PERSON_ID, body({ ...PERSON_EDIT, ...PROFILE_EDIT }), COORDINATOR);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(savedOf(Person)).toHaveLength(1);
      expect(savedOf(Person)[0]).toMatchObject({
        ...PERSON_EDIT,
        id: PERSON_ID,
        role: Role.MEMBER,
        accessEnabled: true,
      });
      expect(savedOf(MemberProfile)).toHaveLength(1);
      expect(savedOf(MemberProfile)[0]).toMatchObject({
        ...PROFILE_EDIT,
        personId: PERSON_ID,
        status: MemberStatus.ACTIVE,
        registrationStatus: MemberRegistrationStatus.APPROVED,
        reviewedById: ACTOR_ID,
      });
    });

    it("keeps omitted fields and clears address, city, state and volunteerTermUrl with null", async () => {
      await service.updateMember(
        PERSON_ID,
        body({ address: null, city: null, state: null, volunteerTermUrl: null }),
        COORDINATOR,
      );

      expect(savedOf(MemberProfile)[0]).toMatchObject({
        address: null,
        city: null,
        state: null,
        volunteerTermUrl: null,
        cpf: "52998224725",
        institutionalEmail: "ana.torres@example.edu",
        course: "Sistemas de Informação",
        semester: 7,
        className: "SI-2024-N",
        departmentId: DEPARTMENT_ID,
        mainFunction: "Monitora de informática",
        joinedAt: "2026-03-01",
      });
      expect(savedOf(Person)).toEqual([]);
      expect(state.personById).toMatchObject({
        name: "Ana Torres",
        ra: "a2210001",
        email: "ana.torres@example.com",
        birthDate: "1999-07-22",
        phone: "11981813030",
      });
    });

    it("saves only the entity that changed", async () => {
      await service.updateMember(PERSON_ID, body({ phone: "41999990000" }), COORDINATOR);
      expect(savedOf(Person)).toHaveLength(1);
      expect(savedOf(MemberProfile)).toEqual([]);

      manager.save.mockClear();
      await service.updateMember(
        PERSON_ID,
        body({ course: "Engenharia de Software" }),
        COORDINATOR,
      );
      expect(savedOf(Person)).toEqual([]);
      expect(savedOf(MemberProfile)).toHaveLength(1);
    });

    it("answers 200 without writing nor emitting for an empty body or values equal to the stored ones", async () => {
      for (const dto of [
        body({}),
        body({
          name: "Ana Torres",
          departmentId: DEPARTMENT_ID,
          address: "Rua das Acácias, 120, apto 42",
        }),
      ]) {
        const record = await service.updateMember(PERSON_ID, dto, COORDINATOR);

        expect(record).toMatchObject({
          id: PERSON_ID,
          name: "Ana Torres",
          department: { id: DEPARTMENT_ID, name: "Tecnologia" },
        });
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(departments.exists).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("maps uq_people_ra and uq_people_email to 409 RA_ALREADY_IN_USE and EMAIL_ALREADY_IN_USE with details on ra and email, and emits nothing", async () => {
      const cases: Array<[string, Record<string, unknown>]> = [
        [
          "uq_people_ra",
          {
            error: "RA_ALREADY_IN_USE",
            message: "RA already in use.",
            details: [{ field: "ra", message: "ra is already in use" }],
          },
        ],
        [
          "uq_people_email",
          {
            error: "EMAIL_ALREADY_IN_USE",
            message: "Email already in use.",
            details: [{ field: "email", message: "email is already in use" }],
          },
        ],
      ];

      for (const [constraint, expected] of cases) {
        state.personById = buildPerson({ role: Role.MEMBER, accessEnabled: true });
        manager.save.mockRejectedValueOnce(uniqueViolation(constraint));

        const failure = await httpFailure(
          service.updateMember(
            PERSON_ID,
            body({ ra: "a2219999", email: "ana@example.org", course: "Engenharia" }),
            COORDINATOR,
          ),
        );

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual(expected);
        expect(JSON.stringify(failure.getResponse())).not.toContain("a2210001");
      }
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("keeps any other database error as it is", async () => {
      const connectionLost = new Error("connection lost");
      manager.save.mockRejectedValueOnce(connectionLost);
      await expect(
        service.updateMember(PERSON_ID, body({ name: "Ana T." }), COORDINATOR),
      ).rejects.toBe(connectionLost);

      state.personById = buildPerson({ role: Role.MEMBER, accessEnabled: true });
      const otherConstraint = uniqueViolation("uq_something_else");
      manager.save.mockRejectedValueOnce(otherConstraint);
      await expect(
        service.updateMember(PERSON_ID, body({ name: "Ana T." }), COORDINATOR),
      ).rejects.toBe(otherConstraint);
    });

    it("emits MEMBER_UPDATED after the commit with departmentId, mainFunction and joinedAt values and every changed field by name, never a personal value", async () => {
      const order: string[] = [];
      dataSource.transaction.mockImplementation(async (...args: unknown[]) => {
        const result = await runTransaction(args);
        order.push("commit");
        return result;
      });
      eventEmitter.emit.mockImplementation(() => order.push("emit"));

      await service.updateMember(
        PERSON_ID,
        body({
          name: "Ana T.",
          phone: "41999990000",
          cpf: NEW_CPF,
          address: null,
          mainFunction: "Professora",
          departmentId: OTHER_DEPARTMENT_ID,
        }),
        COORDINATOR,
      );

      expect(order).toEqual(["commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit.mock.calls[0][0]).toBe(AUDITABLE_ACTION_EVENT);
      const [event] = emittedEvents();
      expect(event).toMatchObject({
        actorId: COORDINATOR.id,
        action: AuditableAction.MEMBER_UPDATED,
        targetType: "member",
        targetId: PERSON_ID,
        occurredAt: NOW,
      });
      expect(event.before).toStrictEqual({
        mainFunction: "Monitora de informática",
        departmentId: DEPARTMENT_ID,
      });
      expect(event.after).toStrictEqual({
        mainFunction: "Professora",
        departmentId: OTHER_DEPARTMENT_ID,
        changedFields: ["name", "phone", "cpf", "address", "departmentId", "mainFunction"],
      });
      const serialized = JSON.stringify(event);
      expectNoSensitiveValue(serialized);
      for (const value of [NEW_CPF, "41999990000", "Ana T."]) {
        expect(serialized).not.toContain(value);
      }
    });

    it("emits an empty before and only changedFields when no allow-listed field changed", async () => {
      await service.updateMember(PERSON_ID, body({ name: "Ana T.", cpf: NEW_CPF }), COORDINATOR);

      const [event] = emittedEvents();
      expect(event.before).toStrictEqual({});
      expect(event.after).toStrictEqual({ changedFields: ["name", "cpf"] });
    });

    it("does not emit when the transaction fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("could not serialize access"));

      await expect(
        service.updateMember(PERSON_ID, body({ name: "Ana T." }), COORDINATOR),
      ).rejects.toThrow("could not serialize access");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("answers the member record of the edited member with cpfMasked, never the CPF", async () => {
      state.reviewer = buildPerson({
        id: ACTOR_ID,
        name: "Carla Menezes",
        role: Role.COORDINATOR,
        accessEnabled: true,
      });

      const record = await service.updateMember(PERSON_ID, body({ cpf: NEW_CPF }), COORDINATOR);

      expect(record).toMatchObject({
        id: PERSON_ID,
        cpfMasked: "***.***.777-35",
        department: { id: DEPARTMENT_ID, name: "Tecnologia" },
        reviewedBy: { id: ACTOR_ID, name: "Carla Menezes" },
      });
      expect(record).not.toHaveProperty("cpf");
      expect(JSON.stringify(record)).not.toContain(NEW_CPF);
      expect(departmentRepository.findOne).toHaveBeenCalledWith({ where: { id: DEPARTMENT_ID } });
      expect(personRepository.findOne).toHaveBeenCalledWith({ where: { id: ACTOR_ID } });
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

        // The member record (GUS-144): the answer carries personal data on purpose, the logs and
        // the errors (403 and 404) must not.
        state.personById = buildPerson({ role: Role.MEMBER, accessEnabled: true });
        state.profile = buildProfile({
          registrationStatus: MemberRegistrationStatus.APPROVED,
          reviewedById: ACTOR_ID,
        });
        state.reviewer = buildPerson({
          id: ACTOR_ID,
          name: "Carla Menezes",
          role: Role.COORDINATOR,
        });
        answerMemberRecordFromState();
        await service.getMember(PERSON_ID, COORDINATOR);
        // httpFailure fails the test if the call stops rejecting, so the check below always runs.
        const forbidden = await httpFailure(
          service.getMember(PERSON_ID, DIRECTOR_OF_OTHER_DEPARTMENT),
        );
        expectNoSensitiveValue(JSON.stringify(forbidden));
        const notFound = await httpFailure(service.getMember("not-a-uuid", COORDINATOR));
        expectNoSensitiveValue(JSON.stringify(notFound));

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

  describe("memberNotFound()", () => {
    it("builds the 404 shared by the service and the id pipe of the controller", () => {
      const error = memberNotFound();

      expect(error.getStatus()).toBe(404);
      expect(error.getResponse()).toEqual({
        error: "MEMBER_NOT_FOUND",
        message: "Member not found.",
      });
    });
  });

  describe("memberInactive()", () => {
    it("builds the 409 MEMBER_INACTIVE shared by the member writes", () => {
      const error = memberInactive();

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual({
        error: "MEMBER_INACTIVE",
        message: "The member is inactive.",
      });
    });
  });
});
