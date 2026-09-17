/**
 * E2e spec for initial coordinator seed — GUS-79 CAs
 *
 * CA79-1: banco limpo + seed cria; 2× não duplica.
 * CA79-2: login pós-seed com ADMIN_PASSWORD retorna role: "superadmin".
 * CA79-3: /auth/logout sem cookie → 401 — covered by auth.controller.e2e.spec.ts (sanity).
 */
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { INestApplication } from "@nestjs/common";
import { DataSource } from "typeorm";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AuthModule } from "../../../modules/auth/auth.module";
import { PeopleModule } from "../../../modules/people/people.module";
import { HttpExceptionFilter } from "../../../shared/filters/http-exception.filter";
import { buildValidationPipe } from "../../../shared/filters/validation-pipe.factory";
import { seedInitialCoordinator } from "../initial-coordinator.seed";

// ---------------------------------------------------------------------------
// DB configuration
// ---------------------------------------------------------------------------
const dbUrl = process.env.DATABASE_URL;
const dbConnection = dbUrl
  ? { url: dbUrl }
  : {
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? "tedi",
      password: process.env.DB_PASSWORD ?? "tedi",
      database: process.env.DB_DATABASE ?? "tedi",
    };

process.env.JWT_SECRET = "e2e-seed-secret";

// ADMIN env vars for this spec
const ADMIN_RA = "seed-admin-001";
const ADMIN_NAME = "Admin Seed";
const ADMIN_EMAIL = "admin-seed@example.com";
const ADMIN_PASSWORD = "SeedPass@123";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("seedInitialCoordinator (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;

  beforeAll(async () => {
    // Set ADMIN_* env before module boots so ConfigService can read them.
    process.env.ADMIN_RA = ADMIN_RA;
    process.env.ADMIN_NAME = ADMIN_NAME;
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          entities: [join(__dirname, "..", "..", "..", "modules", "**", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
        AuthModule,
        PeopleModule,
      ],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    // Clean up the seed person created by these tests.
    await dataSource.query("DELETE FROM people WHERE ra = $1", [ADMIN_RA]);
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query("DELETE FROM people WHERE ra = $1", [ADMIN_RA]);
  });

  // -------------------------------------------------------------------------
  // Case 1 (CA79-1): creates on first run, no-op on second
  // -------------------------------------------------------------------------
  describe("Case 1 (CA79-1): creates on first run; second run is a no-op", () => {
    it("creates the coordinator on first run", async () => {
      await seedInitialCoordinator(dataSource);

      const rows = await dataSource.query(
        "SELECT ra, role, access_enabled FROM people WHERE ra = $1",
        [ADMIN_RA],
      ) as Array<{ ra: string; role: string; access_enabled: boolean }>;

      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe("superadmin");
      expect(rows[0].access_enabled).toBe(true);
    });

    it("does not duplicate or overwrite on second run", async () => {
      await seedInitialCoordinator(dataSource);

      // Save the hash from the first run
      const first = await dataSource.query(
        "SELECT password_hash FROM people WHERE ra = $1",
        [ADMIN_RA],
      ) as Array<{ password_hash: string }>;

      await seedInitialCoordinator(dataSource);

      const rows = await dataSource.query(
        "SELECT count(*) as cnt, max(password_hash) as hash FROM people WHERE ra = $1",
        [ADMIN_RA],
      ) as Array<{ cnt: string; hash: string }>;

      expect(Number(rows[0].cnt)).toBe(1);
      expect(rows[0].hash).toBe(first[0].password_hash);
    });
  });

  // -------------------------------------------------------------------------
  // Case 2 (CA79-2): seeded coordinator can log in
  // -------------------------------------------------------------------------
  describe("Case 2 (CA79-2): seeded coordinator can log in with ADMIN_PASSWORD", () => {
    it("POST /auth/login returns role: superadmin after seed", async () => {
      await seedInitialCoordinator(dataSource);

      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: ADMIN_RA, password: ADMIN_PASSWORD })
        .expect(200);

      expect(res.body.role).toBe("superadmin");
      expect(res.body.name).toBe(ADMIN_NAME);
    });
  });
});
