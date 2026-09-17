import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { DataSource } from "typeorm";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import request from "supertest";
import { TestModule } from "./test-support/test.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import { SESSION_COOKIE_NAME } from "../auth.constants";

// ---------------------------------------------------------------------------
// DB configuration — same defaults as people.repository.e2e.spec.ts
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

// Set JWT_SECRET before module compilation so ConfigService.getOrThrow() resolves.
const TEST_SECRET = "e2e-test-secret";
process.env.JWT_SECRET = TEST_SECRET;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCookie(jwt: string): string {
  return `${SESSION_COOKIE_NAME}=${jwt}`;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AuthGuard (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let jwtService: JwtService;
  let peopleService: PeopleService;
  let dataSource: DataSource;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          entities: [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
        TestModule,
      ],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    jwtService = module.get(JwtService);
    peopleService = module.get(PeopleService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query("TRUNCATE TABLE people RESTART IDENTITY CASCADE");
  });

  // -----------------------------------------------------------------------
  // CA3: Public route — no cookie needed
  // -----------------------------------------------------------------------
  describe("public route responds without cookie", () => {
    it("GET /test/public returns 200 without a cookie", async () => {
      await request(app.getHttpServer()).get("/test/public").expect(200).expect({ ok: true });
    });
  });

  // -----------------------------------------------------------------------
  // CA2: Unprotected route — requires valid session
  // -----------------------------------------------------------------------
  describe("unprotected route requires a valid session", () => {
    // TODO(GUS-76): once ApiErrorDto lands, assert body.error === 'Unauthorized' instead.
    it("GET /test/open returns 401 without a cookie", async () => {
      await request(app.getHttpServer()).get("/test/open").expect(401);
    });

    it("GET /test/open returns 200 with a valid cookie for any role", async () => {
      const person = await peopleService.save({
        name: "Alice",
        role: Role.MEMBER,
        accessEnabled: true,
      });
      const token = await jwtService.signAsync({ sub: person.id }, { secret: TEST_SECRET });

      await request(app.getHttpServer())
        .get("/test/open")
        .set("Cookie", buildCookie(token))
        .expect(200)
        .expect({ userId: person.id, role: Role.MEMBER });
    });
  });

  // -----------------------------------------------------------------------
  // CA1 / Case 1: Role hierarchy — DIRECTOR route
  // -----------------------------------------------------------------------
  describe("hierarchy: DIRECTOR route accepts director and coordinator, rejects member", () => {
    it("member returns 403", async () => {
      const person = await peopleService.save({
        name: "Member User",
        role: Role.MEMBER,
        accessEnabled: true,
      });
      const token = await jwtService.signAsync({ sub: person.id }, { secret: TEST_SECRET });

      await request(app.getHttpServer())
        .get("/test/director")
        .set("Cookie", buildCookie(token))
        .expect(403);
    });

    it("director returns 200", async () => {
      const person = await peopleService.save({
        name: "Director User",
        role: Role.DIRECTOR,
        accessEnabled: true,
      });
      const token = await jwtService.signAsync({ sub: person.id }, { secret: TEST_SECRET });

      await request(app.getHttpServer())
        .get("/test/director")
        .set("Cookie", buildCookie(token))
        .expect(200)
        .expect({ userId: person.id, role: Role.DIRECTOR });
    });

    it("coordinator returns 200", async () => {
      const person = await peopleService.save({
        name: "Coordinator User",
        role: Role.COORDINATOR,
        accessEnabled: true,
      });
      const token = await jwtService.signAsync({ sub: person.id }, { secret: TEST_SECRET });

      await request(app.getHttpServer())
        .get("/test/director")
        .set("Cookie", buildCookie(token))
        .expect(200)
        .expect({ userId: person.id, role: Role.COORDINATOR });
    });
  });

  // -----------------------------------------------------------------------
  // CA4 / Case 3: Immediate revocation — accessEnabled=false
  // -----------------------------------------------------------------------
  describe("revocation: flipping accessEnabled to false returns 401 on next request", () => {
    it("valid cookie returns 401 after accessEnabled is set to false", async () => {
      const person = await peopleService.save({
        name: "Director Bob",
        role: Role.DIRECTOR,
        accessEnabled: true,
      });
      const token = await jwtService.signAsync({ sub: person.id }, { secret: TEST_SECRET });

      // First request: should succeed.
      await request(app.getHttpServer())
        .get("/test/open")
        .set("Cookie", buildCookie(token))
        .expect(200);

      // Flip accessEnabled to false in the DB.
      await dataSource.query(`UPDATE people SET access_enabled = false WHERE id = $1`, [person.id]);

      // Second request: 401 immediately (decision 19).
      await request(app.getHttpServer())
        .get("/test/open")
        .set("Cookie", buildCookie(token))
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // CA5 / Case 4: SUPERADMIN bypasses role hierarchy
  // -----------------------------------------------------------------------
  describe("superadmin bypasses role hierarchy", () => {
    it("SUPERADMIN passes @Roles(COORDINATOR)", async () => {
      const person = await peopleService.save({
        name: "Super Admin",
        role: Role.SUPERADMIN,
        accessEnabled: true,
      });
      const token = await jwtService.signAsync({ sub: person.id }, { secret: TEST_SECRET });

      await request(app.getHttpServer())
        .get("/test/director")
        .set("Cookie", buildCookie(token))
        .expect(200)
        .expect({ userId: person.id, role: Role.SUPERADMIN });
    });
  });

  // -----------------------------------------------------------------------
  // CA6 / Case 5: DEV_FAKE_ROLE
  // -----------------------------------------------------------------------
  describe("DEV_FAKE_ROLE", () => {
    describe("in non-production: request without cookie is treated as the fake role", () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalFakeRole = process.env.DEV_FAKE_ROLE;

      beforeAll(() => {
        process.env.NODE_ENV = "development";
        process.env.DEV_FAKE_ROLE = "director";
      });

      afterAll(() => {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalFakeRole === undefined) {
          delete process.env.DEV_FAKE_ROLE;
        } else {
          process.env.DEV_FAKE_ROLE = originalFakeRole;
        }
      });

      it("GET /test/director returns 200 without cookie when DEV_FAKE_ROLE=director", async () => {
        await request(app.getHttpServer()).get("/test/director").expect(200);
      });
    });

    describe("in production: DEV_FAKE_ROLE has no effect", () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalFakeRole = process.env.DEV_FAKE_ROLE;

      beforeAll(() => {
        process.env.NODE_ENV = "production";
        process.env.DEV_FAKE_ROLE = "coordinator";
      });

      afterAll(() => {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalFakeRole === undefined) {
          delete process.env.DEV_FAKE_ROLE;
        } else {
          process.env.DEV_FAKE_ROLE = originalFakeRole;
        }
      });

      // TODO(GUS-76): assert body.error === 'Unauthorized' once ApiErrorDto is in place.
      it("GET /test/open returns 401 without cookie even with DEV_FAKE_ROLE set", async () => {
        await request(app.getHttpServer()).get("/test/open").expect(401);
      });
    });
  });
});
