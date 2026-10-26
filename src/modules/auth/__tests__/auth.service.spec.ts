import { HttpException, UnauthorizedException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager } from "typeorm";
import { AuthService } from "../services/auth.service";
import { PasswordService } from "../services/password.service";
import { PeopleService } from "@modules/people/services/people.service";
import { MemberRegistrationStatus } from "@modules/people/enums/member-registration-status.enum";
import { MemberAccessFacts, MembersService } from "@modules/people/services/members.service";
import { Role } from "@shared/enums/role.enum";
import { Person } from "@modules/people/entities/person.entity";
import { buildPermissionMap } from "@shared/permissions/permission-matrix";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "uuid-1",
    name: "Alice",
    ra: "a2210001",
    email: "alice@example.com",
    role: Role.MEMBER,
    accessEnabled: true,
    mustChangePassword: false,
    passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$fake-hash",
    ...overrides,
  } as Person;
}

const NO_MEMBER_PROFILE: MemberAccessFacts = { registrationStatus: null, departmentIds: [] };

function makeMembers(facts: MemberAccessFacts = NO_MEMBER_PROFILE): MembersService {
  return {
    findAccessFacts: jest.fn(() => Promise.resolve(facts)),
  } as unknown as MembersService;
}

function makeService(overrides: {
  person?: Person | null;
  passwordOk?: boolean;
  dummyHash?: string;
  facts?: MemberAccessFacts;
  members?: MembersService;
}): AuthService {
  const {
    person = makePerson(),
    passwordOk = true,
    dummyHash = "dummy-hash",
    facts = NO_MEMBER_PROFILE,
  } = overrides;

  const people = {
    findByRa: jest.fn(() => Promise.resolve(person)),
    findById: jest.fn(() => Promise.resolve(person)),
  } as unknown as PeopleService;

  const password = {
    verify: jest.fn(() => Promise.resolve(passwordOk)),
    getDummyHash: jest.fn(() => Promise.resolve(dummyHash)),
  } as unknown as PasswordService;

  return new AuthService(
    people,
    password,
    overrides.members ?? makeMembers(facts),
    { transaction: jest.fn() } as unknown as DataSource,
    { emit: jest.fn() } as unknown as EventEmitter2,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthService", () => {
  const VALID_DTO = { ra: "a2210001", password: "Senha@123" };

  describe("login", () => {
    it("CA1: returns MeResponseDto on happy path", async () => {
      const service = makeService({});
      const result = await service.login(VALID_DTO);
      expect(result).toMatchObject({
        id: "uuid-1",
        name: "Alice",
        ra: "a2210001",
        email: "alice@example.com",
        role: Role.MEMBER,
      });
    });

    it("login returns the permission map of the person's role", async () => {
      const service = makeService({ person: makePerson({ role: Role.MEMBER }) });
      const result = await service.login(VALID_DTO);
      expect(result.permissions).toEqual(buildPermissionMap(Role.MEMBER));
      expect(result.permissions["members.list"]).toBe("none");
      expect(result.permissions["account.manageOwn"]).toBe("own");
    });

    it("CA1: does not include passwordHash in the response", async () => {
      const service = makeService({});
      const result = await service.login(VALID_DTO);
      expect(result).not.toHaveProperty("passwordHash");
    });

    describe("GUS-93: account that must change the password", () => {
      it("returns mustChangePassword false for an ordinary account", async () => {
        const service = makeService({});

        await expect(service.login(VALID_DTO)).resolves.toMatchObject({
          mustChangePassword: false,
        });
      });

      it("logs the account in and reports mustChangePassword true", async () => {
        const service = makeService({
          person: makePerson({ role: Role.SUPERADMIN, mustChangePassword: true }),
        });

        await expect(service.login(VALID_DTO)).resolves.toMatchObject({
          id: "uuid-1",
          role: Role.SUPERADMIN,
          mustChangePassword: true,
        });
      });

      it("keeps INVALID_CREDENTIALS for a wrong password, flag or not", async () => {
        const service = makeService({
          person: makePerson({ mustChangePassword: true }),
          passwordOk: false,
        });

        const error = await service.login(VALID_DTO).catch((e: unknown) => e);

        expect((error as HttpException).getStatus()).toBe(401);
        expect(((error as HttpException).getResponse() as { error: string }).error).toBe(
          "INVALID_CREDENTIALS",
        );
      });

      it("keeps ACCESS_DISABLED for a disabled account that also has the flag", async () => {
        const service = makeService({
          person: makePerson({ accessEnabled: false, mustChangePassword: true }),
        });

        const error = await service.login(VALID_DTO).catch((e: unknown) => e);

        expect(((error as HttpException).getResponse() as { error: string }).error).toBe(
          "ACCESS_DISABLED",
        );
      });
    });

    describe("CA2: INVALID_CREDENTIALS errors", () => {
      it("throws INVALID_CREDENTIALS when RA does not exist", async () => {
        const service = makeService({ person: null });
        const error = await service.login(VALID_DTO).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpException);
        const httpErr = error as HttpException;
        expect(httpErr.getStatus()).toBe(401);
        const body = httpErr.getResponse() as { error: string; message: string };
        expect(body.error).toBe("INVALID_CREDENTIALS");
        expect(body.message).toBe("Invalid credentials.");
      });

      it("CA2: INVALID_CREDENTIALS for wrong RA and wrong password are identical", async () => {
        const serviceRaNotFound = makeService({ person: null });
        const serviceWrongPassword = makeService({ passwordOk: false });

        const errorRa = await serviceRaNotFound.login(VALID_DTO).catch((e: unknown) => e);
        const errorPwd = await serviceWrongPassword.login(VALID_DTO).catch((e: unknown) => e);

        const bodyRa = (errorRa as HttpException).getResponse() as {
          error: string;
          message: string;
        };
        const bodyPwd = (errorPwd as HttpException).getResponse() as {
          error: string;
          message: string;
        };

        expect(bodyRa.error).toBe(bodyPwd.error);
        expect(bodyRa.message).toBe(bodyPwd.message);
        expect((errorRa as HttpException).getStatus()).toBe(
          (errorPwd as HttpException).getStatus(),
        );
      });

      it("throws INVALID_CREDENTIALS when passwordHash is null", async () => {
        const service = makeService({ person: makePerson({ passwordHash: null }) });
        const error = await service.login(VALID_DTO).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpException);
        const body = (error as HttpException).getResponse() as { error: string };
        expect(body.error).toBe("INVALID_CREDENTIALS");
      });

      it("throws INVALID_CREDENTIALS when password is wrong", async () => {
        const service = makeService({ passwordOk: false });
        const error = await service.login(VALID_DTO).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpException);
        const body = (error as HttpException).getResponse() as { error: string };
        expect(body.error).toBe("INVALID_CREDENTIALS");
      });

      it("throws INVALID_CREDENTIALS when role is null", async () => {
        const service = makeService({ person: makePerson({ role: null }) });
        const error = await service.login(VALID_DTO).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpException);
        const body = (error as HttpException).getResponse() as { error: string };
        expect(body.error).toBe("INVALID_CREDENTIALS");
      });
    });

    describe("GUS-91: member registration under validation", () => {
      // What the database holds for a registration that is not approved yet.
      const WITHOUT_ACCESS = { role: null, accessEnabled: false };

      async function failureOf(promise: Promise<unknown>): Promise<HttpException> {
        const error = await promise.catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpException);
        return error as HttpException;
      }

      it("throws 401 REGISTRATION_PENDING after a correct password when the registration is pending", async () => {
        const service = makeService({
          person: makePerson(WITHOUT_ACCESS),
          facts: { registrationStatus: MemberRegistrationStatus.PENDING, departmentIds: [] },
        });

        const failure = await failureOf(service.login(VALID_DTO));

        expect(failure.getStatus()).toBe(401);
        expect(failure.getResponse()).toEqual({
          error: "REGISTRATION_PENDING",
          message: "Registration awaiting validation.",
        });
      });

      it("throws 401 REGISTRATION_REJECTED after a correct password when the registration was rejected", async () => {
        const service = makeService({
          person: makePerson(WITHOUT_ACCESS),
          facts: { registrationStatus: MemberRegistrationStatus.REJECTED, departmentIds: [] },
        });

        const failure = await failureOf(service.login(VALID_DTO));

        expect(failure.getStatus()).toBe(401);
        expect(failure.getResponse()).toEqual({
          error: "REGISTRATION_REJECTED",
          message: "Registration rejected. Contact coordination.",
        });
      });

      it("throws INVALID_CREDENTIALS, not the registration status, when the password is wrong", async () => {
        const members = makeMembers({
          registrationStatus: MemberRegistrationStatus.PENDING,
          departmentIds: [],
        });
        const service = makeService({
          person: makePerson(WITHOUT_ACCESS),
          passwordOk: false,
          members,
        });

        const failure = await failureOf(service.login(VALID_DTO));

        expect(failure.getStatus()).toBe(401);
        expect((failure.getResponse() as { error: string }).error).toBe("INVALID_CREDENTIALS");
        // Nothing about the account is revealed (not even queried) before the password is right.
        expect(members.findAccessFacts).not.toHaveBeenCalled();
      });

      it("does not look at the registration when the RA does not exist", async () => {
        const members = makeMembers();
        const service = makeService({ person: null, members });

        const failure = await failureOf(service.login(VALID_DTO));

        expect((failure.getResponse() as { error: string }).error).toBe("INVALID_CREDENTIALS");
        expect(members.findAccessFacts).not.toHaveBeenCalled();
      });

      it("logs in an approved member and a person without member profile", async () => {
        const approved = makeService({
          person: makePerson({ id: "uuid-approved", role: Role.MEMBER }),
          facts: { registrationStatus: MemberRegistrationStatus.APPROVED, departmentIds: ["d1"] },
        });
        const withoutProfile = makeService({
          person: makePerson({ id: "uuid-coordinator", role: Role.COORDINATOR }),
        });

        await expect(approved.login(VALID_DTO)).resolves.toMatchObject({
          id: "uuid-approved",
          role: Role.MEMBER,
        });
        await expect(withoutProfile.login(VALID_DTO)).resolves.toMatchObject({
          id: "uuid-coordinator",
          role: Role.COORDINATOR,
        });
      });

      it("keeps ACCESS_DISABLED for an approved member whose access was disabled later", async () => {
        const service = makeService({
          person: makePerson({ accessEnabled: false }),
          facts: { registrationStatus: MemberRegistrationStatus.APPROVED, departmentIds: [] },
        });

        const failure = await failureOf(service.login(VALID_DTO));

        expect((failure.getResponse() as { error: string }).error).toBe("ACCESS_DISABLED");
      });
    });

    describe("CA3: ACCESS_DISABLED", () => {
      it("throws ACCESS_DISABLED when accessEnabled is false and password is correct", async () => {
        const service = makeService({ person: makePerson({ accessEnabled: false }) });
        const error = await service.login(VALID_DTO).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpException);
        const httpErr = error as HttpException;
        expect(httpErr.getStatus()).toBe(401);
        const body = httpErr.getResponse() as { error: string; message: string };
        expect(body.error).toBe("ACCESS_DISABLED");
        expect(body.message).toBe("Access disabled. Contact coordination.");
      });
    });

    it("verifies dummy hash when person is not found (constant-time)", async () => {
      const passwordService = {
        verify: jest.fn(() => Promise.resolve(false)),
        getDummyHash: jest.fn(() => Promise.resolve("dummy-hash")),
      } as unknown as PasswordService;

      const people = {
        findByRa: jest.fn(() => Promise.resolve(null)),
      } as unknown as PeopleService;

      const service = new AuthService(
        people,
        passwordService,
        makeMembers(),
        { transaction: jest.fn() } as unknown as DataSource,
        { emit: jest.fn() } as unknown as EventEmitter2,
      );
      await service.login(VALID_DTO).catch(() => undefined);

      expect(passwordService.getDummyHash).toHaveBeenCalledTimes(1);
      expect(passwordService.verify).toHaveBeenCalledWith("dummy-hash", VALID_DTO.password);
    });
  });

  describe("getMe", () => {
    it("getMe returns the permission map of the person's role", async () => {
      const service = makeService({ person: makePerson({ role: Role.DIRECTOR }) });
      const result = await service.getMe("uuid-1");
      expect(result.permissions["members.view"]).toBe("department");
      expect(result.permissions["members.deactivate"]).toBe("none");
      expect(result.permissions).toEqual(buildPermissionMap(Role.DIRECTOR));
    });

    it("CA4: returns MeResponseDto without passwordHash", async () => {
      const service = makeService({});
      const result = await service.getMe("uuid-1");
      expect(result).toMatchObject({ id: "uuid-1", name: "Alice", role: Role.MEMBER });
      expect(result).not.toHaveProperty("passwordHash");
    });

    it("getMe reports mustChangePassword as stored (GUS-93)", async () => {
      const ordinary = makeService({ person: makePerson({ mustChangePassword: false }) });
      const flagged = makeService({ person: makePerson({ mustChangePassword: true }) });

      await expect(ordinary.getMe("uuid-1")).resolves.toMatchObject({ mustChangePassword: false });
      await expect(flagged.getMe("uuid-1")).resolves.toMatchObject({ mustChangePassword: true });
    });

    it("throws UNAUTHORIZED when person not found", async () => {
      const service = makeService({ person: null });
      await expect(service.getMe("ghost-id")).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("throws UNAUTHORIZED when person.role is null", async () => {
      const service = makeService({ person: makePerson({ role: null }) });
      await expect(service.getMe("uuid-1")).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("changeOwnPassword (GUS-93)", () => {
    const CURRENT_HASH = "$argon2id$v=19$m=19456,t=2,p=1$current-hash";
    const NEW_HASH = "$argon2id$v=19$m=19456,t=2,p=1$new-hash";
    const NEW_PASSWORD = "NovaSenha@123";

    /** A person as the database holds the initial coordinator before the first change. */
    function makeFlagged(overrides: Partial<Person> = {}): Person {
      return makePerson({
        role: Role.SUPERADMIN,
        mustChangePassword: true,
        passwordHash: CURRENT_HASH,
        ...overrides,
      });
    }

    function setup(options: { locked: Person | null; sameAsCurrent?: boolean }) {
      const callOrder: string[] = [];

      const manager = {
        findOne: jest.fn(() => Promise.resolve(options.locked)),
        save: jest.fn((_entity: unknown, person: Person) => {
          callOrder.push("save");
          return Promise.resolve(person);
        }),
      };
      const dataSource = {
        transaction: jest.fn(async (work: (m: EntityManager) => Promise<unknown>) => {
          const result = await work(manager as unknown as EntityManager);
          callOrder.push("commit");
          return result;
        }),
      } as unknown as DataSource;
      const password = {
        verify: jest.fn(() => Promise.resolve(options.sameAsCurrent ?? false)),
        hashPassword: jest.fn(() => Promise.resolve(NEW_HASH)),
        getDummyHash: jest.fn(),
      } as unknown as jest.Mocked<PasswordService>;
      const eventEmitter = {
        emit: jest.fn(() => {
          callOrder.push("emit");
          return true;
        }),
      } as unknown as jest.Mocked<EventEmitter2>;

      const service = new AuthService(
        { findByRa: jest.fn(), findById: jest.fn() } as unknown as PeopleService,
        password,
        makeMembers(),
        dataSource,
        eventEmitter,
      );

      return { service, manager, password, eventEmitter, callOrder };
    }

    async function failureOf(promise: Promise<unknown>): Promise<HttpException> {
      const error = await promise.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      return error as HttpException;
    }

    it("replaces the hash, clears the flag and returns the account with mustChangePassword false", async () => {
      const person = makeFlagged();
      const { service, manager, password } = setup({ locked: person });

      const result = await service.changeOwnPassword("uuid-1", { newPassword: NEW_PASSWORD });

      expect(password.hashPassword).toHaveBeenCalledWith(NEW_PASSWORD);
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(person.passwordHash).toBe(NEW_HASH);
      expect(person.mustChangePassword).toBe(false);
      expect(result).toMatchObject({
        id: "uuid-1",
        role: Role.SUPERADMIN,
        mustChangePassword: false,
      });
      expect(result.permissions).toEqual(buildPermissionMap(Role.SUPERADMIN));
      expect(result).not.toHaveProperty("passwordHash");
    });

    it("locks the person row while it checks and replaces the password", async () => {
      const { service, manager } = setup({ locked: makeFlagged() });

      await service.changeOwnPassword("uuid-1", { newPassword: NEW_PASSWORD });

      expect(manager.findOne).toHaveBeenCalledWith(Person, {
        where: { id: "uuid-1" },
        lock: { mode: "pessimistic_write" },
      });
    });

    it("compares the new password with the current hash before it replaces it", async () => {
      const { service, password } = setup({ locked: makeFlagged() });

      await service.changeOwnPassword("uuid-1", { newPassword: NEW_PASSWORD });

      expect(password.verify).toHaveBeenCalledWith(CURRENT_HASH, NEW_PASSWORD);
    });

    it("emits PASSWORD_CHANGED after the commit, with no password and no hash", async () => {
      const { service, eventEmitter, callOrder } = setup({ locked: makeFlagged() });

      await service.changeOwnPassword("uuid-1", { newPassword: NEW_PASSWORD });

      expect(callOrder).toEqual(["save", "commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      const [channel, event] = eventEmitter.emit.mock.calls[0] as unknown as [
        string,
        AuditableActionEvent,
      ];
      expect(channel).toBe(AUDITABLE_ACTION_EVENT);
      expect(event).toMatchObject({
        actorId: "uuid-1",
        action: AuditableAction.PASSWORD_CHANGED,
        targetType: "person",
        targetId: "uuid-1",
        before: { mustChangePassword: true },
        after: { mustChangePassword: false },
      });
      expect(event.occurredAt).toBeInstanceOf(Date);
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain(NEW_PASSWORD);
      expect(serialized).not.toContain(NEW_HASH);
      expect(serialized).not.toContain(CURRENT_HASH);
    });

    it("throws 409 PASSWORD_CHANGE_NOT_REQUIRED when the flag is off, without verifying, hashing, saving or emitting", async () => {
      const person = makeFlagged({ mustChangePassword: false });
      const { service, manager, password, eventEmitter } = setup({ locked: person });

      const failure = await failureOf(
        service.changeOwnPassword("uuid-1", { newPassword: NEW_PASSWORD }),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "PASSWORD_CHANGE_NOT_REQUIRED",
        message: "Password change not required.",
      });
      expect(password.verify).not.toHaveBeenCalled();
      expect(password.hashPassword).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(person.passwordHash).toBe(CURRENT_HASH);
    });

    it("throws 400 PASSWORD_UNCHANGED when the new password is the current one and leaves the account as it was", async () => {
      const person = makeFlagged();
      const { service, manager, password, eventEmitter } = setup({
        locked: person,
        sameAsCurrent: true,
      });

      const failure = await failureOf(
        service.changeOwnPassword("uuid-1", { newPassword: NEW_PASSWORD }),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "PASSWORD_UNCHANGED",
        message: "New password must be different from the current one.",
      });
      expect(password.hashPassword).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(person.passwordHash).toBe(CURRENT_HASH);
      expect(person.mustChangePassword).toBe(true);
    });

    it("sets the password without comparing when the account has no hash yet", async () => {
      const person = makeFlagged({ passwordHash: null });
      const { service, password } = setup({ locked: person });

      await service.changeOwnPassword("uuid-1", { newPassword: NEW_PASSWORD });

      expect(password.verify).not.toHaveBeenCalled();
      expect(person.passwordHash).toBe(NEW_HASH);
      expect(person.mustChangePassword).toBe(false);
    });

    it("throws UNAUTHORIZED when the person does not exist or has no role", async () => {
      for (const locked of [null, makeFlagged({ role: null })]) {
        const { service, manager, eventEmitter } = setup({ locked });

        await expect(
          service.changeOwnPassword("uuid-1", { newPassword: NEW_PASSWORD }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(manager.save).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      }
    });

    it("does not emit when the save fails", async () => {
      const { service, manager, eventEmitter } = setup({ locked: makeFlagged() });
      manager.save.mockRejectedValueOnce(new Error("db down"));

      await expect(
        service.changeOwnPassword("uuid-1", { newPassword: NEW_PASSWORD }),
      ).rejects.toThrow("db down");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
