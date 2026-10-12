/**
 * Seed: Initial Coordinator
 *
 * Creates the first coordinator (SUPERADMIN role) from environment variables, with
 * mustChangePassword = true: ADMIN_PASSWORD is known to whoever configured the environment,
 * so the first access has to replace it (GUS-93, decision 16 of E9.a).
 * Only the creation turns the flag on. Idempotent: if a Person with ADMIN_RA already exists, the
 * seed returns without touching it, so an existing account is never changed (password, role and
 * flag stay as they are). To require the change on an account that already exists, set
 * must_change_password on it in the database.
 *
 * Required env vars:
 *   ADMIN_RA       — registration number (e.g. "a1234567")
 *   ADMIN_NAME     — full name
 *   ADMIN_EMAIL    — e-mail address
 *   ADMIN_PASSWORD — initial password (plain text; hashed with argon2id)
 *
 * Usage (development):
 *   yarn seed
 *
 * Usage (production — compiled JS):
 *   yarn seed:prod
 */
import "reflect-metadata";
import { config } from "dotenv";
import { DataSource } from "typeorm";
import { hash, argon2id } from "argon2";
import type { HashOptions } from "argon2";
import { AppDataSource } from "../data-source";
import { Person } from "../../modules/people/entities/person.entity";
import { Role } from "../../shared/enums/role.enum";

// Load .env in development (no-op in compiled JS if already loaded by the process).
config();

/** Argon2id options matching PasswordService defaults (OWASP). */
const ARGON2_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Reads and validates required ADMIN_* env vars.
 * Throws if any are missing.
 */
function readAdminEnv(): { ra: string; name: string; email: string; password: string } {
  const ra = process.env.ADMIN_RA?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!ra || !name || !email || !password) {
    throw new Error(
      "Missing required env vars: ADMIN_RA, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD. " +
        "Set them before running the seed.",
    );
  }

  return { ra, name, email, password };
}

/**
 * Creates the initial coordinator in the given DataSource.
 * Idempotent: exits early if a Person with the same RA already exists.
 */
export async function seedInitialCoordinator(ds: DataSource): Promise<void> {
  const { ra, name, email, password } = readAdminEnv();

  const repo = ds.getRepository(Person);

  const existing = await repo.findOne({ where: { ra } });
  if (existing !== null) {
    console.log(`[seed] Person with RA "${ra}" already exists — skipping.`);
    return;
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const person = repo.create({
    name,
    ra,
    email,
    passwordHash,
    role: Role.SUPERADMIN,
    accessEnabled: true,
    mustChangePassword: true,
  });

  await repo.save(person);
  console.log(`[seed] Initial coordinator created: ${name} (${ra}).`);
}

/**
 * CLI entry-point — called directly via ts-node or node dist/...
 */
async function run(): Promise<void> {
  const ds = AppDataSource;
  await ds.initialize();

  try {
    await seedInitialCoordinator(ds);
  } finally {
    await ds.destroy();
  }
}

// Allow both `ts-node seed.ts` and `node dist/seed.js`
if (require.main === module) {
  run().catch((err: unknown) => {
    console.error("[seed] Fatal error:", err);
    process.exit(1);
  });
}
