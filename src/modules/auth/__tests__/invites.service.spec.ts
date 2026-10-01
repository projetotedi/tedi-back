import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Repository, DataSource, EntityManager } from "typeorm";
import { InvitesService } from "../services/invites.service";
import { PasswordService } from "../services/password.service";
import { Invite, InviteType } from "../entities/invite.entity";
import { CreateInviteDto } from "../dto/create-invite.dto";
import { AcceptInviteDto } from "../dto/accept-invite.dto";
import { Role } from "@shared/enums/role.enum";
import { Person } from "@modules/people/entities/person.entity";
import { MemberRegistrationFormDto } from "@modules/people/dto/member-registration-form.dto";
import { DepartmentsService } from "@modules/people/services/departments.service";
import { MembersService } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: "invite-uuid-1",
    type: InviteType.ACCESS,
    role: Role.MEMBER,
    personId: null,
    tokenHash: "abc123hash",
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    usedAt: null,
    revokedAt: null,
    createdById: "actor-uuid-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    assignUuidV7: jest.fn(),
    ...overrides,
  } as unknown as Invite;
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-uuid-1",
    name: "Alice",
    ra: "a2210001",
    email: "alice@example.com",
    passwordHash: "$argon2id$v=19$...",
    role: null,
    accessEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    assignUuidV7: jest.fn(),
    ...overrides,
  } as unknown as Person;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("InvitesService", () => {
  let service: InvitesService;
  let inviteRepo: jest.Mocked<Repository<Invite>>;
  let dataSource: { transaction: jest.Mock };
  let passwordService: jest.Mocked<PasswordService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let peopleService: jest.Mocked<PeopleService>;
  let members: jest.Mocked<Pick<MembersService, "submitFromInvite">>;
  let departments: jest.Mocked<Pick<DepartmentsService, "list">>;

  beforeEach(() => {
    inviteRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<Invite>>;

    dataSource = { transaction: jest.fn() };

    passwordService = {
      hashPassword: jest.fn().mockResolvedValue("$argon2id$v=19$hashed"),
    } as unknown as jest.Mocked<PasswordService>;

    eventEmitter = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<EventEmitter2>;

    peopleService = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<PeopleService>;

    members = { submitFromInvite: jest.fn() };
    departments = { list: jest.fn().mockResolvedValue([]) };

    service = new InvitesService(
      inviteRepo,
      dataSource as unknown as DataSource,
      passwordService,
      eventEmitter,
      peopleService,
      members as unknown as MembersService,
      departments as unknown as DepartmentsService,
    );
  });

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------

  describe("create()", () => {
    it("rejects SUPERADMIN with 400 INVALID_ROLE", async () => {
      const dto: CreateInviteDto = { role: Role.SUPERADMIN };

      let thrown: HttpException | null = null;
      try {
        await service.create(dto, "actor-1");
      } catch (e) {
        thrown = e as HttpException;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown!.getStatus()).toBe(400);
      const body = thrown!.getResponse() as Record<string, unknown>;
      expect(body.error).toBe("INVALID_ROLE");
      expect(body.message).toBe("Role cannot be assigned via invite.");
    });

    it("saves invite and returns token in clear text", async () => {
      const dto: CreateInviteDto = { role: Role.MEMBER };
      const saved = makeInvite({ id: "invite-1" });

      inviteRepo.create.mockReturnValue(saved);
      inviteRepo.save.mockResolvedValue(saved);

      const result = await service.create(dto, "actor-1");

      expect(inviteRepo.save).toHaveBeenCalledTimes(1);
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe("string");
      expect(result.invite.id).toBe("invite-1");
    });

    it("emits INVITE_CREATED AFTER save", async () => {
      const callOrder: string[] = [];
      const dto: CreateInviteDto = { role: Role.MEMBER };
      const saved = makeInvite();

      inviteRepo.create.mockReturnValue(saved);
      inviteRepo.save.mockImplementation(async () => {
        callOrder.push("save");
        return saved;
      });
      eventEmitter.emit.mockImplementation(() => {
        callOrder.push("emit");
        return true;
      });

      await service.create(dto, "actor-1");

      expect(callOrder).toEqual(["save", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        AUDITABLE_ACTION_EVENT,
        expect.objectContaining({
          action: AuditableAction.INVITE_CREATED,
          targetType: "invite",
        }),
      );
    });

    it("does not emit if save throws", async () => {
      const dto: CreateInviteDto = { role: Role.MEMBER };
      const pending = makeInvite();

      inviteRepo.create.mockReturnValue(pending);
      inviteRepo.save.mockRejectedValue(new Error("DB error"));

      await expect(service.create(dto, "actor-1")).rejects.toThrow("DB error");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getByToken()
  // -------------------------------------------------------------------------

  describe("getByToken()", () => {
    it("returns invite for a valid token", async () => {
      const invite = makeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);

      const result = await service.getByToken("some-token");
      expect(result).toBe(invite);
    });

    it("throws 400 INVALID_INVITE when token not found", async () => {
      inviteRepo.findOne.mockResolvedValue(null);

      let thrown: HttpException | null = null;
      try {
        await service.getByToken("bad-token");
      } catch (e) {
        thrown = e as HttpException;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown!.getStatus()).toBe(400);
      expect((thrown!.getResponse() as Record<string, unknown>).error).toBe("INVALID_INVITE");
    });

    it("throws 400 INVALID_INVITE when invite is already used", async () => {
      const invite = makeInvite({ usedAt: new Date() });
      inviteRepo.findOne.mockResolvedValue(invite);

      let thrown: HttpException | null = null;
      try {
        await service.getByToken("used-token");
      } catch (e) {
        thrown = e as HttpException;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown!.getStatus()).toBe(400);
    });

    it("throws 400 INVALID_INVITE when invite is revoked", async () => {
      const invite = makeInvite({ revokedAt: new Date() });
      inviteRepo.findOne.mockResolvedValue(invite);

      let thrown: HttpException | null = null;
      try {
        await service.getByToken("revoked-token");
      } catch (e) {
        thrown = e as HttpException;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown!.getStatus()).toBe(400);
    });

    it("throws 400 INVALID_INVITE when invite is expired", async () => {
      const invite = makeInvite({ expiresAt: new Date(Date.now() - 1000) });
      inviteRepo.findOne.mockResolvedValue(invite);

      let thrown: HttpException | null = null;
      try {
        await service.getByToken("expired-token");
      } catch (e) {
        thrown = e as HttpException;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown!.getStatus()).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // accept()
  // -------------------------------------------------------------------------

  describe("accept()", () => {
    // Valid form, already normalized as the ValidationPipe leaves it.
    const registration: MemberRegistrationFormDto = {
      name: "Ana Torres",
      ra: "a2210001",
      personalEmail: "ana.torres@example.com",
      birthDate: "1999-07-22",
      cpf: "52998224725",
      phone: "11981813030",
      institutionalEmail: "ana.torres@example.edu",
      course: "Sistemas de Informação",
      semester: 7,
      className: "SI-2024-N",
    };
    const dto: AcceptInviteDto = { token: "valid-token", password: "Senha@123", registration };

    const submission = {
      personId: "new-person-1",
      auditEvent: Object.assign(new AuditableActionEvent(), {
        actorId: "new-person-1",
        action: AuditableAction.MEMBER_REGISTRATION_SUBMITTED,
        targetType: "member",
        targetId: "new-person-1",
        before: null,
        after: { registrationStatus: "pending" },
        occurredAt: new Date(),
      }),
    };

    function buildManager(invite: Invite | null): EntityManager {
      return {
        findOne: jest.fn().mockImplementation(async (entity: unknown) => {
          if (entity === Invite) return invite;
          return null;
        }),
        save: jest.fn().mockImplementation(async (_entity: unknown, obj: unknown) => obj),
      } as unknown as EntityManager;
    }

    function runWith(manager: EntityManager): void {
      dataSource.transaction.mockImplementation(async (cb: (em: EntityManager) => Promise<void>) =>
        cb(manager),
      );
    }

    async function httpFailure(promise: Promise<unknown>): Promise<HttpException> {
      try {
        await promise;
      } catch (e) {
        return e as HttpException;
      }
      throw new Error("expected the call to throw");
    }

    beforeEach(() => {
      members.submitFromInvite.mockResolvedValue(submission);
    });

    it("delegates the registration to MembersService.submitFromInvite with the hashed password, the invite role and the invite id", async () => {
      const invite = makeInvite({ id: "invite-77", role: Role.DIRECTOR });
      const manager = buildManager(invite);
      runWith(manager);

      await service.accept(dto);

      expect(passwordService.hashPassword).toHaveBeenCalledWith("Senha@123");
      expect(members.submitFromInvite).toHaveBeenCalledTimes(1);
      // Same manager: Person, profile and invite.usedAt commit together.
      expect(members.submitFromInvite).toHaveBeenCalledWith(manager, {
        ...registration,
        passwordHash: "$argon2id$v=19$hashed",
        requestedRole: Role.DIRECTOR,
        inviteId: "invite-77",
      });
    });

    it("marks the invite used with the person id returned by the registration", async () => {
      const invite = makeInvite();
      const manager = buildManager(invite);
      runWith(manager);

      await service.accept(dto);

      expect(invite.usedAt).toBeInstanceOf(Date);
      expect(invite.personId).toBe("new-person-1");
      expect(manager.save).toHaveBeenCalledWith(Invite, invite);
    });

    it("emits the submission event AFTER the transaction commits, not inside", async () => {
      const callOrder: string[] = [];

      dataSource.transaction.mockImplementation(
        async (cb: (em: EntityManager) => Promise<void>) => {
          const manager = buildManager(makeInvite());
          (manager.save as jest.Mock).mockImplementation(async (_e: unknown, obj: unknown) => {
            callOrder.push("tx-save");
            return obj;
          });
          await cb(manager);
          callOrder.push("tx-commit");
        },
      );

      eventEmitter.emit.mockImplementation(() => {
        callOrder.push("emit");
        return true;
      });

      await service.accept(dto);

      // emit must come AFTER the transaction commits
      const txCommitIdx = callOrder.indexOf("tx-commit");
      const emitIdx = callOrder.indexOf("emit");
      expect(txCommitIdx).toBeGreaterThan(-1);
      expect(emitIdx).toBeGreaterThan(txCommitIdx);

      // The event is the one MembersService built with the allow-list: emitted as is.
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(AUDITABLE_ACTION_EVENT, submission.auditEvent);
    });

    it("throws 400 VALIDATION_FAILED with field registration for an access invite without registration and does not consume the invite", async () => {
      const invite = makeInvite();
      const manager = buildManager(invite);
      runWith(manager);

      const failure = await httpFailure(
        service.accept({ token: "valid-token", password: "Senha@123" }),
      );

      expect(failure.getStatus()).toBe(400);
      // Same shape the ValidationPipe produces, so the filter answers details[0].field.
      expect(failure.getResponse()).toMatchObject({
        error: "VALIDATION_FAILED",
        rawErrors: [{ field: "registration", message: expect.any(String) }],
      });
      expect(members.submitFromInvite).not.toHaveBeenCalled();
      expect(invite.usedAt).toBeNull();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not consume the invite when submitFromInvite throws 409 RA_ALREADY_IN_USE", async () => {
      const invite = makeInvite();
      const manager = buildManager(invite);
      runWith(manager);
      members.submitFromInvite.mockRejectedValue(
        new HttpException({ error: "RA_ALREADY_IN_USE", message: "RA already in use." }, 409),
      );

      const failure = await httpFailure(service.accept(dto));

      expect(failure.getStatus()).toBe(409);
      expect((failure.getResponse() as Record<string, unknown>).error).toBe("RA_ALREADY_IN_USE");
      // The rule moved to people; here only the consequence matters: nothing consumed or emitted.
      expect(invite.usedAt).toBeNull();
      expect(invite.personId).toBeNull();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 400 INVALID_INVITE when token is already used inside accept", async () => {
      const usedInvite = makeInvite({ usedAt: new Date() });
      runWith(buildManager(usedInvite));

      const failure = await httpFailure(service.accept(dto));

      expect(failure).toBeInstanceOf(HttpException);
      expect(failure.getStatus()).toBe(400);
      expect((failure.getResponse() as Record<string, unknown>).error).toBe("INVALID_INVITE");
      expect(members.submitFromInvite).not.toHaveBeenCalled();
    });

    it("does not emit when the transaction throws", async () => {
      dataSource.transaction.mockRejectedValue(new Error("tx failed"));

      await expect(service.accept(dto)).rejects.toThrow("tx failed");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("locks the invite row while accepting", async () => {
      const manager = buildManager(makeInvite());
      runWith(manager);

      await service.accept(dto);

      // Double click on the same link: the second request waits, then sees usedAt and fails.
      expect(manager.findOne).toHaveBeenCalledWith(Invite, {
        where: { tokenHash: expect.any(String) },
        lock: { mode: "pessimistic_write" },
      });
    });
  });

  // -------------------------------------------------------------------------
  // accept() — PASSWORD_RESET branch
  // -------------------------------------------------------------------------

  describe("accept() — PASSWORD_RESET branch", () => {
    function buildPasswordResetManager(
      invite: Invite | null,
      person: Person | null,
    ): Partial<EntityManager> {
      return {
        findOne: jest.fn().mockImplementation(async (entity: unknown) => {
          if (entity === Invite) return invite;
          if (entity === Person) return person;
          return null;
        }),
        save: jest.fn().mockImplementation(async (_entity: unknown, obj: unknown) => obj),
      };
    }

    it("CA81-7: accepts PASSWORD_RESET invite and updates passwordHash", async () => {
      const resetInvite = makeInvite({
        type: InviteType.PASSWORD_RESET,
        personId: "person-uuid-1",
      });
      const person = makePerson({ id: "person-uuid-1", role: Role.MEMBER });
      const callOrder: string[] = [];

      dataSource.transaction.mockImplementation(
        async (cb: (em: EntityManager) => Promise<void>) => {
          const manager = buildPasswordResetManager(resetInvite, person) as EntityManager;
          (manager.save as jest.Mock).mockImplementation(async () => {
            callOrder.push("save");
            return person;
          });
          await cb(manager);
          callOrder.push("tx-commit");
        },
      );

      eventEmitter.emit.mockImplementation(() => {
        callOrder.push("emit");
        return true;
      });

      await service.accept({
        token: "reset-token",
        password: "NewPassw@123",
      });

      // emit must come AFTER tx commit
      const txIdx = callOrder.indexOf("tx-commit");
      const emitIdx = callOrder.indexOf("emit");
      expect(txIdx).toBeGreaterThan(-1);
      expect(emitIdx).toBeGreaterThan(txIdx);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        AUDITABLE_ACTION_EVENT,
        expect.objectContaining({
          action: AuditableAction.PASSWORD_RESET,
          targetType: "person",
        }),
      );
    });

    it("ignores the registration of a password_reset invite and only changes the password", async () => {
      const resetInvite = makeInvite({
        type: InviteType.PASSWORD_RESET,
        personId: "person-uuid-1",
      });
      const person = makePerson({ id: "person-uuid-1", role: Role.MEMBER });

      dataSource.transaction.mockImplementation(async (cb: (em: EntityManager) => Promise<void>) =>
        cb(buildPasswordResetManager(resetInvite, person) as EntityManager),
      );

      await service.accept({
        token: "reset-token",
        password: "NewPassw@123",
        registration: { name: "Outro Nome" } as MemberRegistrationFormDto,
      });

      expect(members.submitFromInvite).not.toHaveBeenCalled();
      expect(person.passwordHash).toBe("$argon2id$v=19$hashed");
      expect(person.name).toBe("Alice");
      expect(resetInvite.usedAt).toBeInstanceOf(Date);
    });

    it("400 INVALID_INVITE when invite.personId is null", async () => {
      const resetInvite = makeInvite({
        type: InviteType.PASSWORD_RESET,
        personId: null,
      });

      dataSource.transaction.mockImplementation(
        async (cb: (em: EntityManager) => Promise<void>) => {
          const manager = buildPasswordResetManager(resetInvite, null) as EntityManager;
          await cb(manager);
        },
      );

      let thrown: HttpException | null = null;
      try {
        await service.accept({ token: "reset-token", password: "NewPassw@123" });
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(400);
      expect((thrown!.getResponse() as Record<string, unknown>).error).toBe("INVALID_INVITE");
    });

    it("400 INVALID_INVITE when person referenced by personId not found", async () => {
      const resetInvite = makeInvite({
        type: InviteType.PASSWORD_RESET,
        personId: "missing-person",
      });

      dataSource.transaction.mockImplementation(
        async (cb: (em: EntityManager) => Promise<void>) => {
          const manager = buildPasswordResetManager(resetInvite, null) as EntityManager;
          await cb(manager);
        },
      );

      let thrown: HttpException | null = null;
      try {
        await service.accept({ token: "reset-token", password: "NewPassw@123" });
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // revoke()
  // -------------------------------------------------------------------------

  describe("revoke()", () => {
    it("CA81-8: 404 when invite not found", async () => {
      inviteRepo.findOne.mockResolvedValue(null);

      let thrown: HttpException | null = null;
      try {
        await service.revoke("nonexistent-id", "actor-1");
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(404);
    });

    it("CA81-8: 409 INVITE_ALREADY_USED when invite is used", async () => {
      inviteRepo.findOne.mockResolvedValue(makeInvite({ usedAt: new Date() }));

      let thrown: HttpException | null = null;
      try {
        await service.revoke("invite-1", "actor-1");
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(409);
      expect((thrown!.getResponse() as Record<string, unknown>).error).toBe("INVITE_ALREADY_USED");
    });

    it("CA81-8: 409 INVITE_ALREADY_REVOKED when invite is already revoked", async () => {
      inviteRepo.findOne.mockResolvedValue(makeInvite({ revokedAt: new Date() }));

      let thrown: HttpException | null = null;
      try {
        await service.revoke("invite-1", "actor-1");
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(409);
      expect((thrown!.getResponse() as Record<string, unknown>).error).toBe(
        "INVITE_ALREADY_REVOKED",
      );
    });

    it("saves revokedAt and emits INVITE_REVOKED for pending invite", async () => {
      const invite = makeInvite();
      inviteRepo.findOne.mockResolvedValue(invite);
      inviteRepo.save.mockResolvedValue({ ...invite, revokedAt: new Date() } as Invite);

      await service.revoke("invite-uuid-1", "actor-1");

      expect(inviteRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        AUDITABLE_ACTION_EVENT,
        expect.objectContaining({ action: AuditableAction.INVITE_REVOKED }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------

  describe("list()", () => {
    it("CA81-2: never includes tokenHash in results", async () => {
      const mockQb = {
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([makeInvite({ id: "i1", tokenHash: "secret-hash" })]),
      };
      inviteRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const results = await service.list();
      expect(results[0]).not.toHaveProperty("tokenHash");
    });

    it("computes status correctly for pending invite", async () => {
      const mockQb = {
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([makeInvite()]),
      };
      inviteRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const results = await service.list();
      expect(results[0].status).toBe("pending");
    });

    it("computes status 'used' for used invite", async () => {
      const mockQb = {
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([makeInvite({ usedAt: new Date() })]),
      };
      inviteRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const results = await service.list();
      expect(results[0].status).toBe("used");
    });

    it("computes status 'revoked' for revoked invite", async () => {
      const mockQb = {
        orderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([makeInvite({ revokedAt: new Date() })]),
      };
      inviteRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);

      const results = await service.list();
      expect(results[0].status).toBe("revoked");
    });
  });

  // -------------------------------------------------------------------------
  // getByToken() — updated: no type check
  // -------------------------------------------------------------------------

  describe("getByToken() — accepts any invite type", () => {
    it("returns PASSWORD_RESET invite (no longer filtered by type)", async () => {
      const resetInvite = makeInvite({ type: InviteType.PASSWORD_RESET });
      inviteRepo.findOne.mockResolvedValue(resetInvite);

      const result = await service.getByToken("some-token");
      expect(result.type).toBe(InviteType.PASSWORD_RESET);
    });
  });

  // -------------------------------------------------------------------------
  // getPublicView() — GUS-112
  // -------------------------------------------------------------------------

  describe("getPublicView()", () => {
    async function catchHttp(promise: Promise<unknown>): Promise<HttpException> {
      try {
        await promise;
      } catch (e) {
        return e as HttpException;
      }
      throw new Error("expected the call to throw");
    }

    function expectInvalidInvite(thrown: HttpException): void {
      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown.getStatus()).toBe(400);
      expect((thrown.getResponse() as Record<string, unknown>).error).toBe("INVALID_INVITE");
    }

    it("returns person null and the departments for an access invite without loading any person", async () => {
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const list = [
        { id: "01999a3e-1111-7000-8000-000000000002", name: "Comunicação" },
        { id: "01999a3e-1111-7000-8000-000000000001", name: "Tecnologia" },
      ];
      departments.list.mockResolvedValue(list);
      inviteRepo.findOne.mockResolvedValue(
        makeInvite({ type: InviteType.ACCESS, role: Role.MEMBER, expiresAt }),
      );

      const result = await service.getPublicView("some-token");

      expect(result).toStrictEqual({
        type: "access",
        role: "member",
        expiresAt,
        departments: list,
        person: null,
      });
      expect(peopleService.findById).not.toHaveBeenCalled();
    });

    it("returns the account name and RA for a password_reset invite", async () => {
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      inviteRepo.findOne.mockResolvedValue(
        makeInvite({
          type: InviteType.PASSWORD_RESET,
          role: null,
          personId: "person-uuid-1",
          expiresAt,
        }),
      );
      peopleService.findById.mockResolvedValue(
        makePerson({ name: "Beatriz Nunes Carvalho", ra: "202400003", role: Role.MEMBER }),
      );

      const result = await service.getPublicView("some-token");

      expect(result).toStrictEqual({
        type: "password_reset",
        role: null,
        expiresAt,
        departments: [],
        person: { name: "Beatriz Nunes Carvalho", ra: "202400003" },
      });
      expect(peopleService.findById).toHaveBeenCalledWith("person-uuid-1");
      // A reset screen has no use for departments: nothing is queried.
      expect(departments.list).not.toHaveBeenCalled();
    });

    it("returns only name and ra, never id, email, role or passwordHash", async () => {
      inviteRepo.findOne.mockResolvedValue(
        makeInvite({ type: InviteType.PASSWORD_RESET, role: null, personId: "person-uuid-1" }),
      );
      peopleService.findById.mockResolvedValue(
        makePerson({ name: "Beatriz Nunes Carvalho", ra: "202400003", role: Role.MEMBER }),
      );

      const result = await service.getPublicView("some-token");

      expect(result.person).toStrictEqual({ name: "Beatriz Nunes Carvalho", ra: "202400003" });
    });

    it.each([
      ["used", { usedAt: new Date() }],
      ["revoked", { revokedAt: new Date() }],
      ["expired", { expiresAt: new Date(Date.now() - 1000) }],
    ])(
      "throws 400 INVALID_INVITE without loading the person when the token is not usable (%s)",
      async (_label, overrides) => {
        inviteRepo.findOne.mockResolvedValue(
          makeInvite({
            type: InviteType.PASSWORD_RESET,
            role: null,
            personId: "person-uuid-1",
            ...overrides,
          }),
        );

        expectInvalidInvite(await catchHttp(service.getPublicView("some-token")));
        expect(peopleService.findById).not.toHaveBeenCalled();
      },
    );

    it("throws 400 INVALID_INVITE without loading the person when the token does not exist", async () => {
      inviteRepo.findOne.mockResolvedValue(null);

      expectInvalidInvite(await catchHttp(service.getPublicView("bad-token")));
      expect(peopleService.findById).not.toHaveBeenCalled();
      expect(departments.list).not.toHaveBeenCalled();
    });

    it("throws 400 INVALID_INVITE when the password_reset invite has no personId", async () => {
      inviteRepo.findOne.mockResolvedValue(
        makeInvite({ type: InviteType.PASSWORD_RESET, role: null, personId: null }),
      );

      expectInvalidInvite(await catchHttp(service.getPublicView("some-token")));
      expect(peopleService.findById).not.toHaveBeenCalled();
    });

    it("throws 400 INVALID_INVITE when the person of the password_reset invite no longer exists", async () => {
      inviteRepo.findOne.mockResolvedValue(
        makeInvite({ type: InviteType.PASSWORD_RESET, role: null, personId: "person-uuid-1" }),
      );
      peopleService.findById.mockResolvedValue(null);

      expectInvalidInvite(await catchHttp(service.getPublicView("some-token")));
    });

    it("throws 400 INVALID_INVITE when the person of the password_reset invite has no RA", async () => {
      inviteRepo.findOne.mockResolvedValue(
        makeInvite({ type: InviteType.PASSWORD_RESET, role: null, personId: "person-uuid-1" }),
      );
      peopleService.findById.mockResolvedValue(makePerson({ ra: null, role: Role.MEMBER }));

      expectInvalidInvite(await catchHttp(service.getPublicView("some-token")));
    });
  });
});
