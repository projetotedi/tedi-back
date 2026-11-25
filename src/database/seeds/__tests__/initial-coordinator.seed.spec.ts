/**
 * Unit spec for the initial coordinator seed — GUS-93 (decision 16 of E9.a).
 * Only the creation of the account turns mustChangePassword on; an account that already exists
 * is never touched. The repository is a fake: what is under test is the decision the seed takes
 * for each case, not the SQL (the e2e spec next to this one covers the database).
 */
import "reflect-metadata";
import { DataSource } from "typeorm";
import { argon2id, hash, verify } from "argon2";
import type { HashOptions } from "argon2";
import { Person } from "../../../modules/people/entities/person.entity";
import { Role } from "../../../shared/enums/role.enum";
import { seedInitialCoordinator } from "../initial-coordinator.seed";

const ADMIN_RA = "seed-unit-001";
const ADMIN_PASSWORD = "SeedPass@123";
const OTHER_PASSWORD = "SenhaTrocada@9";

const ARGON2_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

function makeExisting(overrides: Partial<Person>): Person {
  return {
    id: "01999a3e-1111-7000-8000-000000000001",
    name: "Admin Seed",
    ra: ADMIN_RA,
    email: "admin-seed@example.com",
    role: Role.SUPERADMIN,
    accessEnabled: true,
    mustChangePassword: false,
    ...overrides,
  } as Person;
}

function makeDataSource(existing: Person | null) {
  const repo = {
    findOne: jest.fn(() => Promise.resolve(existing)),
    create: jest.fn((input: Partial<Person>) => ({ ...input })),
    save: jest.fn((entity: Partial<Person>) => Promise.resolve(entity)),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
  };
  const ds = { getRepository: jest.fn(() => repo) } as unknown as DataSource;
  return { ds, repo };
}

describe("seedInitialCoordinator (unit)", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let adminHash: string;
  let otherHash: string;
  let log: jest.SpyInstance;

  beforeAll(async () => {
    adminHash = await hash(ADMIN_PASSWORD, ARGON2_OPTIONS);
    otherHash = await hash(OTHER_PASSWORD, ARGON2_OPTIONS);
  });

  beforeEach(() => {
    for (const key of ["ADMIN_RA", "ADMIN_NAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"]) {
      savedEnv[key] = process.env[key];
    }
    process.env.ADMIN_RA = ADMIN_RA;
    process.env.ADMIN_NAME = "Admin Seed";
    process.env.ADMIN_EMAIL = "admin-seed@example.com";
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe("no account with ADMIN_RA", () => {
    it("creates a superadmin that must change the password, hashed from ADMIN_PASSWORD", async () => {
      const { ds, repo } = makeDataSource(null);

      await seedInitialCoordinator(ds);

      expect(repo.save).toHaveBeenCalledTimes(1);
      const created = repo.create.mock.calls[0][0];
      expect(created).toMatchObject({
        name: "Admin Seed",
        ra: ADMIN_RA,
        role: Role.SUPERADMIN,
        accessEnabled: true,
        mustChangePassword: true,
      });
      expect(created.passwordHash).not.toBe(ADMIN_PASSWORD);
      expect(await verify(created.passwordHash as string, ADMIN_PASSWORD)).toBe(true);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe("an account with ADMIN_RA already exists", () => {
    it("leaves the flag off and writes nothing, even when the hash still matches ADMIN_PASSWORD", async () => {
      // The coordinator already running in production: seeded before the flag existed and still
      // on the password of the environment. The seed must not reach it at boot.
      const existing = makeExisting({ passwordHash: adminHash });
      const before = { ...existing };
      const { ds, repo } = makeDataSource(existing);

      await seedInitialCoordinator(ds);

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(existing).toEqual(before);
      expect(existing.mustChangePassword).toBe(false);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("already exists — skipping"));
    });

    it("overwrites neither its password nor its role", async () => {
      // Another role and a password of its own: nothing here is the environment's to decide.
      const existing = makeExisting({ role: Role.COORDINATOR, passwordHash: otherHash });
      const before = { ...existing };
      const { ds, repo } = makeDataSource(existing);

      await seedInitialCoordinator(ds);

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(existing).toEqual(before);
      expect(existing.role).toBe(Role.COORDINATOR);
      expect(existing.passwordHash).toBe(otherHash);
    });

    it("does not touch the flag of an account that already has the change pending", async () => {
      const existing = makeExisting({ passwordHash: adminHash, mustChangePassword: true });
      const before = { ...existing };
      const { ds, repo } = makeDataSource(existing);

      await seedInitialCoordinator(ds);

      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(existing).toEqual(before);
      expect(existing.mustChangePassword).toBe(true);
    });
  });

  describe("second run", () => {
    it("finds the account the first run created and writes nothing", async () => {
      const first = makeDataSource(null);
      await seedInitialCoordinator(first.ds);
      expect(first.repo.save).toHaveBeenCalledTimes(1);

      // What the database holds after the first run.
      const persisted = makeExisting(first.repo.save.mock.calls[0][0]);
      expect(persisted.mustChangePassword).toBe(true);
      const second = makeDataSource(persisted);

      await seedInitialCoordinator(second.ds);

      expect(second.repo.create).not.toHaveBeenCalled();
      expect(second.repo.save).not.toHaveBeenCalled();
      expect(second.repo.update).not.toHaveBeenCalled();
    });
  });
});
