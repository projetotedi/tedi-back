import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, Repository } from "typeorm";
import { AccessService } from "../services/access.service";
import { InvitesService } from "../services/invites.service";
import { Person } from "@modules/people/entities/person.entity";
import { Role } from "@shared/enums/role.enum";
import { AUDITABLE_ACTION_EVENT, AuditableAction } from "@shared/events/auditable-action.event";
import { UpdateAccessRoleDto } from "../dto/update-access-role.dto";
import { UpdateAccessEnabledDto } from "../dto/update-access-enabled.dto";
import { ConfigService } from "@nestjs/config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-uuid-1",
    name: "Alice",
    ra: "a2210001",
    email: "alice@example.com",
    passwordHash: "$argon2id$v=19$...",
    role: Role.COORDINATOR,
    accessEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    assignUuidV7: jest.fn(),
    ...overrides,
  } as unknown as Person;
}

function makeManager(findResult: Person | null, countResult = 2): jest.Mocked<EntityManager> {
  return {
    findOne: jest.fn().mockResolvedValue(findResult),
    count: jest.fn().mockResolvedValue(countResult),
    save: jest.fn().mockImplementation(async (_entity: unknown, obj: unknown) => obj),
  } as unknown as jest.Mocked<EntityManager>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AccessService", () => {
  let service: AccessService;
  let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let invitesService: jest.Mocked<InvitesService>;
  let configService: jest.Mocked<ConfigService>;
  let personRepo: jest.Mocked<Partial<Repository<Person>>>;

  beforeEach(() => {
    personRepo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Partial<Repository<Person>>>;

    dataSource = {
      transaction: jest.fn(),
      getRepository: jest.fn().mockReturnValue(personRepo),
    };

    eventEmitter = { emit: jest.fn() } as unknown as jest.Mocked<EventEmitter2>;

    invitesService = {
      createPasswordReset: jest.fn().mockResolvedValue({
        url: "http://localhost:5173/reset-password?token=tok",
        expiresAt: new Date(),
      }),
    } as unknown as jest.Mocked<InvitesService>;

    configService = {
      getOrThrow: jest.fn().mockReturnValue("http://localhost:5173"),
    } as unknown as jest.Mocked<ConfigService>;

    service = new AccessService(
      dataSource as unknown as DataSource,
      eventEmitter,
      invitesService,
      configService,
    );
  });

  // ---------------------------------------------------------------------------
  // updateRole()
  // ---------------------------------------------------------------------------

  describe("updateRole()", () => {
    const actorId = "actor-uuid";
    const targetId = "person-uuid-1";

    it("Case 4/CA81-4: rejects SUPERADMIN role with 400 INVALID_ROLE (before tx)", async () => {
      const dto: UpdateAccessRoleDto = { role: Role.SUPERADMIN };

      let thrown: HttpException | null = null;
      try {
        await service.updateRole(targetId, dto, actorId, Role.COORDINATOR);
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown!.getStatus()).toBe(400);
      expect((thrown!.getResponse() as Record<string, unknown>).error).toBe("INVALID_ROLE");
      // tx must NOT be called for INVALID_ROLE
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("CA81-4: 403 OWN_ACCOUNT when actor targets themselves (before tx)", async () => {
      const dto: UpdateAccessRoleDto = { role: Role.MEMBER };

      let thrown: HttpException | null = null;
      try {
        await service.updateRole(actorId, dto, actorId, Role.COORDINATOR); // same id
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown!.getStatus()).toBe(403);
      expect((thrown!.getResponse() as Record<string, unknown>).error).toBe("OWN_ACCOUNT");
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("404 when person is not found in tx", async () => {
      const dto: UpdateAccessRoleDto = { role: Role.MEMBER };

      dataSource.transaction.mockImplementation(
        async (_level: string, cb: (mgr: EntityManager) => Promise<void>) => {
          const mgr = makeManager(null);
          await cb(mgr);
        },
      );

      let thrown: HttpException | null = null;
      try {
        await service.updateRole(targetId, dto, actorId, Role.COORDINATOR);
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(404);
    });

    it("404 when person has role=null in tx", async () => {
      const dto: UpdateAccessRoleDto = { role: Role.MEMBER };
      const personWithNullRole = makePerson({ id: targetId, role: null });

      dataSource.transaction.mockImplementation(
        async (_level: string, cb: (mgr: EntityManager) => Promise<void>) => {
          const mgr = makeManager(personWithNullRole);
          await cb(mgr);
        },
      );

      let thrown: HttpException | null = null;
      try {
        await service.updateRole(targetId, dto, actorId, Role.COORDINATOR);
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(404);
    });

    it("CA81-5 (coordinator): 409 LAST_COORDINATOR when demoting last active coordinator", async () => {
      const dto: UpdateAccessRoleDto = { role: Role.MEMBER };
      const coordinator = makePerson({ id: targetId, role: Role.COORDINATOR });

      dataSource.transaction.mockImplementation(
        async (_level: string, cb: (mgr: EntityManager) => Promise<void>) => {
          // count = 1 → last coordinator
          const mgr = makeManager(coordinator, 1);
          await cb(mgr);
        },
      );

      let thrown: HttpException | null = null;
      try {
        await service.updateRole(targetId, dto, actorId, Role.COORDINATOR);
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(409);
      expect((thrown!.getResponse() as Record<string, unknown>).error).toBe("LAST_COORDINATOR");
    });

    it("CA81-5 (superadmin allowed): NO exception when superadmin demotes last coordinator", async () => {
      const dto: UpdateAccessRoleDto = { role: Role.MEMBER };
      const coordinator = makePerson({ id: targetId, role: Role.COORDINATOR });
      // Superadmin actor — different id from target
      const superadminId = "superadmin-uuid";

      dataSource.transaction.mockImplementation(
        async (_level: string, cb: (mgr: EntityManager) => Promise<void>) => {
          // count = 1 → would be last coordinator, but actor is superadmin → bypass
          const mgr = makeManager(coordinator, 1);
          await cb(mgr);
        },
      );

      // Superadmin bypasses LAST_COORDINATOR check
      const result = await service.updateRole(targetId, dto, superadminId, Role.SUPERADMIN);
      expect(result).toBeDefined();
    });

    it("emits ROLE_CHANGED after successful update", async () => {
      const dto: UpdateAccessRoleDto = { role: Role.MEMBER };
      const coordinator = makePerson({ id: targetId, role: Role.COORDINATOR });

      dataSource.transaction.mockImplementation(
        async (_level: string, cb: (mgr: EntityManager) => Promise<void>) => {
          const mgr = makeManager(coordinator, 2);
          await cb(mgr);
        },
      );

      await service.updateRole(targetId, dto, actorId, Role.COORDINATOR);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        AUDITABLE_ACTION_EVENT,
        expect.objectContaining({
          action: AuditableAction.ROLE_CHANGED,
          targetType: "person",
          targetId,
          before: { role: Role.COORDINATOR },
          after: { role: Role.MEMBER },
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateEnabled()
  // ---------------------------------------------------------------------------

  describe("updateEnabled()", () => {
    const actorId = "actor-uuid";
    const targetId = "person-uuid-1";

    it("CA81-4: 403 OWN_ACCOUNT when actor targets themselves", async () => {
      const dto: UpdateAccessEnabledDto = { enabled: false };

      let thrown: HttpException | null = null;
      try {
        await service.updateEnabled(actorId, dto, actorId, Role.COORDINATOR);
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(403);
      expect((thrown!.getResponse() as Record<string, unknown>).error).toBe("OWN_ACCOUNT");
    });

    it("CA81-5: 409 LAST_COORDINATOR when disabling last active coordinator", async () => {
      const dto: UpdateAccessEnabledDto = { enabled: false };
      const coordinator = makePerson({ id: targetId, role: Role.COORDINATOR });

      dataSource.transaction.mockImplementation(
        async (_level: string, cb: (mgr: EntityManager) => Promise<void>) => {
          const mgr = makeManager(coordinator, 1);
          await cb(mgr);
        },
      );

      let thrown: HttpException | null = null;
      try {
        await service.updateEnabled(targetId, dto, actorId, Role.COORDINATOR);
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(409);
      expect((thrown!.getResponse() as Record<string, unknown>).error).toBe("LAST_COORDINATOR");
    });

    it("CA81-5 (superadmin): superadmin can disable last coordinator", async () => {
      const dto: UpdateAccessEnabledDto = { enabled: false };
      const coordinator = makePerson({ id: targetId, role: Role.COORDINATOR });
      const superadminId = "superadmin-uuid";

      dataSource.transaction.mockImplementation(
        async (_level: string, cb: (mgr: EntityManager) => Promise<void>) => {
          // count = 1 → last coordinator, but actor is superadmin → bypass
          const mgr = makeManager(coordinator, 1);
          await cb(mgr);
        },
      );

      const result = await service.updateEnabled(targetId, dto, superadminId, Role.SUPERADMIN);
      expect(result).toBeDefined();
    });

    it("does NOT check LAST_COORDINATOR when enabling (not disabling)", async () => {
      const dto: UpdateAccessEnabledDto = { enabled: true };
      const coordinator = makePerson({
        id: targetId,
        role: Role.COORDINATOR,
        accessEnabled: false,
      });

      dataSource.transaction.mockImplementation(
        async (_level: string, cb: (mgr: EntityManager) => Promise<void>) => {
          // count = 0 (no active coordinators yet)
          const mgr = makeManager(coordinator, 0);
          await cb(mgr);
        },
      );

      // Should NOT throw even with count = 0 because we're enabling, not disabling
      const result = await service.updateEnabled(targetId, dto, actorId, Role.COORDINATOR);
      expect(result).toBeDefined();
    });

    it("emits ACCESS_DISABLED when disabling", async () => {
      const dto: UpdateAccessEnabledDto = { enabled: false };
      const member = makePerson({ id: targetId, role: Role.MEMBER });

      dataSource.transaction.mockImplementation(
        async (_level: string, cb: (mgr: EntityManager) => Promise<void>) => {
          const mgr = makeManager(member, 3);
          await cb(mgr);
        },
      );

      await service.updateEnabled(targetId, dto, actorId, Role.COORDINATOR);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        AUDITABLE_ACTION_EVENT,
        expect.objectContaining({ action: AuditableAction.ACCESS_DISABLED }),
      );
    });

    it("emits ACCESS_ENABLED when enabling", async () => {
      const dto: UpdateAccessEnabledDto = { enabled: true };
      const member = makePerson({ id: targetId, role: Role.MEMBER, accessEnabled: false });

      dataSource.transaction.mockImplementation(
        async (_level: string, cb: (mgr: EntityManager) => Promise<void>) => {
          const mgr = makeManager(member, 3);
          await cb(mgr);
        },
      );

      await service.updateEnabled(targetId, dto, actorId, Role.COORDINATOR);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        AUDITABLE_ACTION_EVENT,
        expect.objectContaining({ action: AuditableAction.ACCESS_ENABLED }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // createPasswordReset()
  // ---------------------------------------------------------------------------

  describe("createPasswordReset()", () => {
    it("CA81-7: creates reset URL for valid person", async () => {
      const person = makePerson({ id: "person-1" });
      (personRepo.findOne as jest.Mock).mockResolvedValue(person);

      const result = await service.createPasswordReset("person-1", "actor-1");

      expect(invitesService.createPasswordReset).toHaveBeenCalledWith(
        "person-1",
        "actor-1",
        "http://localhost:5173",
      );
      expect(result.url).toContain("reset-password");
    });

    it("404 when person not found", async () => {
      (personRepo.findOne as jest.Mock).mockResolvedValue(null);

      let thrown: HttpException | null = null;
      try {
        await service.createPasswordReset("nonexistent-id", "actor-1");
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(404);
    });

    it("404 when person has role=null", async () => {
      const unprovisioned = makePerson({ role: null });
      (personRepo.findOne as jest.Mock).mockResolvedValue(unprovisioned);

      let thrown: HttpException | null = null;
      try {
        await service.createPasswordReset("person-1", "actor-1");
      } catch (e) {
        thrown = e as HttpException;
      }

      expect(thrown!.getStatus()).toBe(404);
    });

    it("CA81-7: coordinator can create reset for own account (no OWN_ACCOUNT check)", async () => {
      const person = makePerson({ id: "actor-1", role: Role.COORDINATOR });
      (personRepo.findOne as jest.Mock).mockResolvedValue(person);

      // Should NOT throw even when actor === target
      const result = await service.createPasswordReset("actor-1", "actor-1");
      expect(result).toBeDefined();
    });
  });
});
