import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { INestApplication } from "@nestjs/common";
import { DataSource } from "typeorm";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PeopleService } from "@modules/people/services/people.service";
import { PasswordService } from "../services/password.service";
import { Role } from "@shared/enums/role.enum";
import { SESSION_COOKIE_NAME } from "../auth.constants";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { AuthModule } from "../auth.module";
import { PeopleModule } from "@modules/people/people.module";

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

// Set JWT_SECRET before module compilation so ConfigService.getOrThrow() resolves.
const TEST_SECRET = "e2e-auth-controller-secret";
process.env.JWT_SECRET = TEST_SECRET;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AuthController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let peopleService: PeopleService;
  let passwordService: PasswordService;
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
        AuthModule,
        PeopleModule,
      ],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    peopleService = module.get(PeopleService);
    passwordService = module.get(PasswordService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query("TRUNCATE TABLE people RESTART IDENTITY CASCADE");
  });

  // -------------------------------------------------------------------------
  // Case 1: Happy path — CA1
  // -------------------------------------------------------------------------
  describe("Case 1 (CA1): happy path login returns 200 + MeResponseDto + Set-Cookie", () => {
    it("POST /auth/login with valid credentials returns 200 and sets tedi_session cookie", async () => {
      const passwordHash = await passwordService.hashPassword("Senha@123");
      await peopleService.save({
        name: "Alice",
        ra: "a2210001",
        email: "alice@example.com",
        passwordHash,
        role: Role.MEMBER,
        accessEnabled: true,
      });

      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210001", password: "Senha@123" })
        .expect(200);

      // CA1: response body is MeResponseDto
      expect(res.body).toMatchObject({
        id: expect.any(String) as string,
        name: "Alice",
        ra: "a2210001",
        email: "alice@example.com",
        role: Role.MEMBER,
      });
      expect(res.body).not.toHaveProperty("passwordHash");

      // CA1: Set-Cookie header with httpOnly
      const setCookieHeader = res.headers["set-cookie"] as string[] | string | undefined;
      expect(setCookieHeader).toBeDefined();
      const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
      expect(cookieStr).toContain(SESSION_COOKIE_NAME);
      expect(cookieStr?.toLowerCase()).toContain("httponly");
    });

    it("accepts RA in uppercase (normalizes to lowercase)", async () => {
      const passwordHash = await passwordService.hashPassword("Senha@123");
      await peopleService.save({
        name: "Bob",
        ra: "a2210002",
        passwordHash,
        role: Role.MEMBER,
        accessEnabled: true,
      });

      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "A2210002", password: "Senha@123" })
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------
  // Case 2: Same error for RA not found and wrong password — CA2
  // -------------------------------------------------------------------------
  describe("Case 2 (CA2): INVALID_CREDENTIALS same response for RA not found and wrong password", () => {
    it("unknown RA and wrong password produce identical error body", async () => {
      const passwordHash = await passwordService.hashPassword("Senha@123");
      await peopleService.save({
        name: "Charlie",
        ra: "a2210003",
        passwordHash,
        role: Role.MEMBER,
        accessEnabled: true,
      });

      const resUnknownRa = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a9999999", password: "wrongpass1" })
        .expect(401);

      const resWrongPassword = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210003", password: "wrongpass1" })
        .expect(401);

      expect(resUnknownRa.body.error).toBe("INVALID_CREDENTIALS");
      expect(resWrongPassword.body.error).toBe("INVALID_CREDENTIALS");
      expect(resUnknownRa.body.error).toBe(resWrongPassword.body.error);
      expect(resUnknownRa.body.message).toBe(resWrongPassword.body.message);
    });
  });

  // -------------------------------------------------------------------------
  // Case 3: accessEnabled=false — CA3
  // -------------------------------------------------------------------------
  describe("Case 3 (CA3): ACCESS_DISABLED when accessEnabled is false", () => {
    it("POST /auth/login with correct password but accessEnabled=false returns 401 ACCESS_DISABLED", async () => {
      const passwordHash = await passwordService.hashPassword("Senha@123");
      await peopleService.save({
        name: "Diana",
        ra: "a2210004",
        passwordHash,
        role: Role.MEMBER,
        accessEnabled: false,
      });

      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210004", password: "Senha@123" })
        .expect(401);

      expect(res.body.error).toBe("ACCESS_DISABLED");
      expect(res.body.message).toBe("Access disabled. Contact coordination.");
    });
  });

  // -------------------------------------------------------------------------
  // Case 4: /auth/me and /auth/logout — CA4, CA5
  // -------------------------------------------------------------------------
  describe("Case 4 (CA4 + CA5): /auth/me returns MeResponseDto without passwordHash; logout clears cookie", () => {
    it("CA4: GET /auth/me with valid cookie returns user without passwordHash", async () => {
      const passwordHash = await passwordService.hashPassword("Senha@123");
      await peopleService.save({
        name: "Eve",
        ra: "a2210005",
        email: "eve@example.com",
        passwordHash,
        role: Role.DIRECTOR,
        accessEnabled: true,
      });

      // Login to get cookie
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210005", password: "Senha@123" })
        .expect(200);

      const rawCookies = loginRes.headers["set-cookie"] as string | string[] | undefined;
      const cookieStr = Array.isArray(rawCookies) ? rawCookies[0] : rawCookies;
      const cookieValue = cookieStr?.split(";")[0] ?? "";

      // Use cookie on /auth/me
      const meRes = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Cookie", cookieValue)
        .expect(200);

      expect(meRes.body).toMatchObject({
        name: "Eve",
        ra: "a2210005",
        role: Role.DIRECTOR,
      });
      expect(meRes.body).not.toHaveProperty("passwordHash");
    });

    it("CA4: GET /auth/me without cookie returns 401 UNAUTHORIZED", async () => {
      const res = await request(app.getHttpServer()).get("/auth/me").expect(401);
      expect(res.body.error).toBe("UNAUTHORIZED");
    });

    it("CA5: logout sets expired Set-Cookie and subsequent /auth/me returns 401", async () => {
      const passwordHash = await passwordService.hashPassword("Senha@123");
      await peopleService.save({
        name: "Frank",
        ra: "a2210006",
        passwordHash,
        role: Role.MEMBER,
        accessEnabled: true,
      });

      // Use an agent so the cookie jar is maintained across requests.
      // When the server sends Max-Age=0 / Expires on logout, the agent drops
      // the cookie and the follow-up GET /auth/me has no session → 401.
      const agent = request.agent(app.getHttpServer());

      await agent.post("/auth/login").send({ ra: "a2210006", password: "Senha@123" }).expect(200);

      // Confirm /auth/me works while logged in
      await agent.get("/auth/me").expect(200);

      // Logout — server clears the cookie
      await agent.post("/auth/logout").expect(204);

      // After logout the agent's cookie jar no longer has tedi_session → 401
      const finalRes = await agent.get("/auth/me").expect(401);
      expect(finalRes.body.error).toBe("UNAUTHORIZED");
    });
  });

  // -------------------------------------------------------------------------
  // Case 5: Rate limiting — CA6
  // -------------------------------------------------------------------------
  describe("Case 5 (CA6): 11th login attempt returns 429 TOO_MANY_ATTEMPTS", () => {
    it("exceeds rate limit and returns 429 on 11th attempt", async () => {
      // Use a unique RA per test run to avoid contaminating other tests
      const uniqueRa = `a221${Math.floor(Math.random() * 1e6)
        .toString()
        .padStart(6, "0")}`;

      // Send 10 requests — these may succeed or fail with 401, but not 429
      for (let i = 0; i < 10; i++) {
        const res = await request(app.getHttpServer())
          .post("/auth/login")
          .send({ ra: uniqueRa, password: "wrongpass1" });
        expect(res.status).not.toBe(429);
      }

      // 11th request — should be throttled
      const throttledRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: uniqueRa, password: "wrongpass1" })
        .expect(429);

      expect(throttledRes.body.error).toBe("TOO_MANY_ATTEMPTS");
      expect(throttledRes.body.message).toBe("Too many attempts. Try again in a few minutes.");
    });
  });

  // -------------------------------------------------------------------------
  // Case 6: Login without passwordHash — covers null passwordHash path
  // -------------------------------------------------------------------------
  describe("Case 6: person with null passwordHash returns INVALID_CREDENTIALS", () => {
    it("POST /auth/login for person without passwordHash returns 401 INVALID_CREDENTIALS", async () => {
      await peopleService.save({
        name: "Grace",
        ra: "a2210007",
        passwordHash: null,
        role: Role.MEMBER,
        accessEnabled: true,
      });

      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210007", password: "Senha@123" })
        .expect(401);

      expect(res.body.error).toBe("INVALID_CREDENTIALS");
    });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  describe("validation", () => {
    it("POST /auth/login with password shorter than 8 chars returns 400 VALIDATION_FAILED", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210001", password: "short" })
        .expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
    });

    it("POST /auth/login missing ra returns 400 VALIDATION_FAILED", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ password: "Senha@123" })
        .expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
    });
  });
});
