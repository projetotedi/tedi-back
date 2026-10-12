/**
 * E2e spec for the mandatory password change — GUS-93 (decision 16 of E9.a)
 *
 * Case 1: an account that must change the password reaches only GET /auth/me,
 *         POST /auth/password and POST /auth/logout; everything else answers
 *         403 PASSWORD_CHANGE_REQUIRED, before @RequirePermission.
 * Case 2: POST /auth/password validation (VALIDATION_FAILED, PASSWORD_UNCHANGED).
 * Case 3: a successful change keeps the session, lifts the block and emits PASSWORD_CHANGED.
 * Case 4: without a pending change → 409 PASSWORD_CHANGE_NOT_REQUIRED; without a session → 401.
 * Case 5: the flag is read on every request (a session opened before it existed is blocked).
 * Case 6: two simultaneous changes: exactly one wins (row lock).
 */
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { EventEmitter2, EventEmitterModule } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import { INestApplication } from "@nestjs/common";
import { DataSource } from "typeorm";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { SESSION_COOKIE_NAME } from "../auth.constants";
import { PasswordService } from "../services/password.service";
import { TestModule } from "./test-support/test.module";

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
process.env.JWT_SECRET = "e2e-password-change-secret";

const INITIAL_PASSWORD = "SenhaInicial@1";
const NEW_PASSWORD = "NovaSenha@123";

interface Account {
  id: string;
  ra: string;
  cookie: string;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Mandatory password change (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let passwordService: PasswordService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;
  const events: AuditableActionEvent[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        EventEmitterModule.forRoot(),
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
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    passwordService = module.get(PasswordService);
    jwtService = module.get(JwtService);
    eventEmitter = module.get(EventEmitter2);
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    events.length = 0;
    await dataSource.query("TRUNCATE TABLE invites, people RESTART IDENTITY CASCADE");
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** One distinct RA per test: the login throttle counts attempts per RA and IP. */
  async function createAccount(
    ra: string,
    options: { role?: Role; mustChangePassword?: boolean; accessEnabled?: boolean } = {},
  ): Promise<Account> {
    const person = await peopleService.save({
      name: `Account ${ra}`,
      ra,
      email: `${ra}@example.com`,
      passwordHash: await passwordService.hashPassword(INITIAL_PASSWORD),
      role: options.role ?? Role.COORDINATOR,
      accessEnabled: options.accessEnabled ?? true,
      mustChangePassword: options.mustChangePassword ?? true,
    });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, ra, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  async function readAccount(
    id: string,
  ): Promise<{ password_hash: string; must_change_password: boolean }> {
    const rows = (await dataSource.query(
      "SELECT password_hash, must_change_password FROM people WHERE id = $1",
      [id],
    )) as Array<{ password_hash: string; must_change_password: boolean }>;
    return rows[0];
  }

  function changePassword(account: Account, newPassword: unknown): request.Test {
    return request(app.getHttpServer())
      .post("/auth/password")
      .set("Cookie", account.cookie)
      .send({ newPassword });
  }

  function passwordChangedEvents(): AuditableActionEvent[] {
    return events.filter((event) => event.action === AuditableAction.PASSWORD_CHANGED);
  }

  // ---------------------------------------------------------------------------
  // Case 1: what a flagged account can reach
  // ---------------------------------------------------------------------------

  describe("Case 1: an account that must change the password reaches only three routes", () => {
    it("GET /auth/me answers 200 and reports mustChangePassword true", async () => {
      const account = await createAccount("pc-me-001");

      const res = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Cookie", account.cookie)
        .expect(200);

      expect(res.body).toMatchObject({
        id: account.id,
        ra: "pc-me-001",
        role: Role.COORDINATOR,
        mustChangePassword: true,
      });
    });

    it("blocks every other authenticated route with 403 PASSWORD_CHANGE_REQUIRED", async () => {
      // A coordinator has access.manage and invites.manage: it is the flag that denies, not the
      // permission.
      const account = await createAccount("pc-block-001");

      for (const path of ["/test/open", "/access", "/invites"]) {
        const res = await request(app.getHttpServer())
          .get(path)
          .set("Cookie", account.cookie)
          .expect(403);

        expect(res.body).toMatchObject({
          statusCode: 403,
          error: "PASSWORD_CHANGE_REQUIRED",
          message: "Password change required.",
        });
      }
    });

    it("answers PASSWORD_CHANGE_REQUIRED, not FORBIDDEN, to a member that also lacks the permission", async () => {
      const member = await createAccount("pc-block-002", { role: Role.MEMBER });

      const res = await request(app.getHttpServer())
        .get("/access")
        .set("Cookie", member.cookie)
        .expect(403);

      expect(res.body.error).toBe("PASSWORD_CHANGE_REQUIRED");
    });

    it("POST /auth/logout still answers 204 and clears the cookie", async () => {
      const account = await createAccount("pc-logout-001");

      const res = await request(app.getHttpServer())
        .post("/auth/logout")
        .set("Cookie", account.cookie)
        .expect(204);

      expect(String(res.headers["set-cookie"])).toContain(`${SESSION_COOKIE_NAME}=;`);
    });
  });

  // ---------------------------------------------------------------------------
  // Case 2: validation
  // ---------------------------------------------------------------------------

  describe("Case 2: POST /auth/password validation", () => {
    it("answers 400 VALIDATION_FAILED with field newPassword for a missing, short or non-string password", async () => {
      const account = await createAccount("pc-valid-001");

      for (const newPassword of [undefined, "curta", 12345678]) {
        const res = await changePassword(account, newPassword).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(res.body.details.map((detail: { field: string }) => detail.field)).toEqual([
          "newPassword",
        ]);
      }

      // Nothing happened: still flagged, same hash, no event.
      expect((await readAccount(account.id)).must_change_password).toBe(true);
      expect(events).toHaveLength(0);
    });

    it("answers 400 PASSWORD_UNCHANGED when the new password is the current one, and changes nothing", async () => {
      const account = await createAccount("pc-same-001");
      const before = await readAccount(account.id);

      const res = await changePassword(account, INITIAL_PASSWORD).expect(400);

      expect(res.body).toMatchObject({ statusCode: 400, error: "PASSWORD_UNCHANGED" });
      expect(await readAccount(account.id)).toEqual(before);
      expect(events).toHaveLength(0);
      // The account is still blocked: the rejected attempt did not count as a change.
      await request(app.getHttpServer())
        .get("/test/open")
        .set("Cookie", account.cookie)
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Case 3: the successful change
  // ---------------------------------------------------------------------------

  describe("Case 3: a successful change", () => {
    it("answers 200 with mustChangePassword false and issues no new cookie", async () => {
      const account = await createAccount("pc-change-001");

      const res = await changePassword(account, NEW_PASSWORD).expect(200);

      expect(res.body).toMatchObject({
        id: account.id,
        ra: "pc-change-001",
        role: Role.COORDINATOR,
        mustChangePassword: false,
      });
      expect(res.body.permissions).toBeDefined();
      expect(res.body).not.toHaveProperty("passwordHash");
      expect(JSON.stringify(res.body)).not.toContain(NEW_PASSWORD);
      // The cookie carries only the person id: the session goes on as it is.
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("keeps the session and opens the routes the guard was blocking", async () => {
      const account = await createAccount("pc-change-002");
      await request(app.getHttpServer()).get("/access").set("Cookie", account.cookie).expect(403);

      await changePassword(account, NEW_PASSWORD).expect(200);

      await request(app.getHttpServer())
        .get("/test/open")
        .set("Cookie", account.cookie)
        .expect(200);
      await request(app.getHttpServer()).get("/access").set("Cookie", account.cookie).expect(200);
    });

    it("stores the new hash and clears the flag; the old password stops working and the new one logs in", async () => {
      const account = await createAccount("pc-change-003");
      const before = await readAccount(account.id);

      await changePassword(account, NEW_PASSWORD).expect(200);

      const after = await readAccount(account.id);
      expect(after.must_change_password).toBe(false);
      expect(after.password_hash).not.toBe(before.password_hash);
      expect(await passwordService.verify(after.password_hash, NEW_PASSWORD)).toBe(true);

      const oldLogin = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: account.ra, password: INITIAL_PASSWORD })
        .expect(401);
      expect(oldLogin.body.error).toBe("INVALID_CREDENTIALS");

      const newLogin = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: account.ra, password: NEW_PASSWORD })
        .expect(200);
      expect(newLogin.body).toMatchObject({ id: account.id, mustChangePassword: false });
    });

    it("emits exactly one PASSWORD_CHANGED event with the person as actor and target, and no secret", async () => {
      const account = await createAccount("pc-event-001");

      await changePassword(account, NEW_PASSWORD).expect(200);

      const changed = passwordChangedEvents();
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatchObject({
        actorId: account.id,
        action: AuditableAction.PASSWORD_CHANGED,
        targetType: "person",
        targetId: account.id,
        before: { mustChangePassword: true },
        after: { mustChangePassword: false },
      });
      const stored = await readAccount(account.id);
      const serialized = JSON.stringify(changed[0]);
      expect(serialized).not.toContain(NEW_PASSWORD);
      expect(serialized).not.toContain(stored.password_hash);
    });
  });

  // ---------------------------------------------------------------------------
  // Case 4: nothing to change, no session
  // ---------------------------------------------------------------------------

  describe("Case 4: no pending change, no session", () => {
    it("answers 409 PASSWORD_CHANGE_NOT_REQUIRED and keeps the old password valid", async () => {
      const account = await createAccount("pc-none-001", { mustChangePassword: false });
      const before = await readAccount(account.id);

      const res = await changePassword(account, NEW_PASSWORD).expect(409);

      expect(res.body).toMatchObject({ statusCode: 409, error: "PASSWORD_CHANGE_NOT_REQUIRED" });
      expect(await readAccount(account.id)).toEqual(before);
      expect(events).toHaveLength(0);
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: account.ra, password: INITIAL_PASSWORD })
        .expect(200);
    });

    it("answers 401 UNAUTHORIZED without a session", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/password")
        .send({ newPassword: NEW_PASSWORD })
        .expect(401);

      expect(res.body.error).toBe("UNAUTHORIZED");
    });

    it("answers 401, not 403, when the flagged account has its access disabled", async () => {
      const account = await createAccount("pc-off-001", { accessEnabled: false });

      const res = await changePassword(account, NEW_PASSWORD).expect(401);

      expect(res.body.error).toBe("UNAUTHORIZED");
      expect((await readAccount(account.id)).must_change_password).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Case 5: the flag is read on every request
  // ---------------------------------------------------------------------------

  describe("Case 5: the flag is read on every request", () => {
    it("blocks a session opened before the flag existed, and the change reopens it", async () => {
      const account = await createAccount("pc-late-001", { mustChangePassword: false });
      const agent = request.agent(app.getHttpServer());
      await agent
        .post("/auth/login")
        .send({ ra: account.ra, password: INITIAL_PASSWORD })
        .expect(200);
      await agent.get("/test/open").expect(200);

      await dataSource.query("UPDATE people SET must_change_password = true WHERE id = $1", [
        account.id,
      ]);

      const blocked = await agent.get("/test/open").expect(403);
      expect(blocked.body.error).toBe("PASSWORD_CHANGE_REQUIRED");
      const me = await agent.get("/auth/me").expect(200);
      expect(me.body.mustChangePassword).toBe(true);

      await agent.post("/auth/password").send({ newPassword: NEW_PASSWORD }).expect(200);
      await agent.get("/test/open").expect(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Case 6: simultaneous requests
  // ---------------------------------------------------------------------------

  describe("Case 6: two simultaneous changes", () => {
    it("lets exactly one win: the other answers 409 PASSWORD_CHANGE_NOT_REQUIRED", async () => {
      const account = await createAccount("pc-race-001");

      const [first, second] = await Promise.all([
        changePassword(account, "PrimeiraSenha@1"),
        changePassword(account, "SegundaSenha@2"),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      expect(loser.body.error).toBe("PASSWORD_CHANGE_NOT_REQUIRED");
      expect(passwordChangedEvents()).toHaveLength(1);
      expect((await readAccount(account.id)).must_change_password).toBe(false);
    });
  });
});
