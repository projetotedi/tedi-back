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
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
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

    service = new InvitesService(
      inviteRepo,
      dataSource as unknown as DataSource,
      passwordService,
      eventEmitter,
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
    const dto: AcceptInviteDto = {
      token: "valid-token",
      name: "Alice",
      ra: "A2210001",
      email: "ALICE@EXAMPLE.COM",
      password: "Senha@123",
    };

    function buildManager(
      invite: Invite | null,
      existingByRa: Person | null = null,
      existingByEmail: Person | null = null,
    ): Partial<EntityManager> {
      const savedPerson = makePerson({
        id: "new-person-1",
        role: invite?.role ?? Role.MEMBER,
      });

      return {
        findOne: jest.fn().mockImplementation(
          async (
            entity: unknown,
            opts: { where: { tokenHash?: string; ra?: string; email?: string } },
          ) => {
            if (entity === Invite) {
              return invite;
            }
            if (opts.where.ra !== undefined) return existingByRa;
            if (opts.where.email !== undefined) return existingByEmail;
            return null;
          },
        ),
        create: jest.fn().mockReturnValue(savedPerson),
        save: jest.fn().mockResolvedValue(savedPerson),
      };
    }

    it("emits ACCESS_CREATED AFTER transaction commits, not inside", async () => {
      const callOrder: string[] = [];

      dataSource.transaction.mockImplementation(
        async (cb: (em: EntityManager) => Promise<void>) => {
          const manager = buildManager(makeInvite()) as EntityManager;
          (manager.save as jest.Mock).mockImplementation(async () => {
            callOrder.push("tx-save");
            return makePerson({ id: "p1", role: Role.MEMBER });
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

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        AUDITABLE_ACTION_EVENT,
        expect.objectContaining({
          action: AuditableAction.ACCESS_CREATED,
          targetType: "person",
        }),
      );
    });

    it("throws 409 RA_ALREADY_IN_USE when person by RA has role, and does NOT consume invite", async () => {
      const invite = makeInvite();
      const personWithRole = makePerson({ role: Role.MEMBER });

      dataSource.transaction.mockImplementation(
        async (cb: (em: EntityManager) => Promise<void>) => {
          const manager = buildManager(invite, personWithRole) as EntityManager;
          await cb(manager);
        },
      );

      let thrown: HttpException | null = null;
      try {
        await service.accept(dto);
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown!.getStatus()).toBe(409);
      expect((thrown!.getResponse() as Record<string, unknown>).error).toBe("RA_ALREADY_IN_USE");

      // Event must NOT be emitted when tx is rolled back via exception.
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 400 INVALID_INVITE when token is already used inside accept", async () => {
      const usedInvite = makeInvite({ usedAt: new Date() });

      dataSource.transaction.mockImplementation(
        async (cb: (em: EntityManager) => Promise<void>) => {
          const manager = buildManager(usedInvite) as EntityManager;
          await cb(manager);
        },
      );

      let thrown: HttpException | null = null;
      try {
        await service.accept(dto);
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown!.getStatus()).toBe(400);
      expect((thrown!.getResponse() as Record<string, unknown>).error).toBe("INVALID_INVITE");
    });

    it("does not emit ACCESS_CREATED when transaction throws", async () => {
      dataSource.transaction.mockRejectedValue(new Error("tx failed"));

      await expect(service.accept(dto)).rejects.toThrow("tx failed");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
