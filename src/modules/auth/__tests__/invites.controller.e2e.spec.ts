/**
 * E2e spec for InvitesController — GUS-80 CAs
 *
 * CA80-1: POST /invites returns 201 with { id, role, expiresAt, url } including token in url.
 * CA80-2: DIRECTOR/MEMBER gets 403 on POST /invites.
 * CA80-3: GET /auth/invites/:token — valid returns 200; invalid/used/expired → 400.
 * CA80-4: POST /auth/invites/accept — full flow provisions Person; login works.
 * CA80-5: Accepting same token twice → second call returns 400.
 * CA80-6: RA with role=null → reuses Person (RN-09); RA with role !== null → 409 no invite consumption.
 * CA80-7: GET /invites (listing) does not leak token — OUT OF SCOPE (GUS-81).
 * Events: INVITE_CREATED/ACCESS_CREATED emitted via EventEmitter2.
 */
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { INestApplication } from "@nestjs/common";
import { DataSource } from "typeorm";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AuthModule } from "../auth.module";
import { PeopleModule } from "@modules/people/people.module";
import { PasswordService } from "../services/password.service";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import { SESSION_COOKIE_NAME } from "../auth.constants";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { JwtService } from "@nestjs/jwt";

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

process.env.JWT_SECRET = "e2e-invites-secret";
process.env.APP_URL = "http://localhost:5173";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("InvitesController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let passwordService: PasswordService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;

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
    peopleService = module.get(PeopleService);
    passwordService = module.get(PasswordService);
    jwtService = module.get(JwtService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query("TRUNCATE TABLE invites, people RESTART IDENTITY CASCADE");
  });

  // Helpers
  async function createCoordinator(): Promise<{ cookie: string; id: string }> {
    const passwordHash = await passwordService.hashPassword("Senha@123");
    const person = await peopleService.save({
      name: "Coordinator",
      ra: "coord001",
      email: "coord@example.com",
      passwordHash,
      role: Role.COORDINATOR,
      accessEnabled: true,
    });
    const token = await jwtService.signAsync({ sub: person.id });
    return { cookie: `${SESSION_COOKIE_NAME}=${token}`, id: person.id };
  }

  async function createMember(ra = "member001"): Promise<{ cookie: string; id: string }> {
    const passwordHash = await passwordService.hashPassword("Senha@123");
    const person = await peopleService.save({
      name: "Member",
      ra,
      email: `${ra}@example.com`,
      passwordHash,
      role: Role.MEMBER,
      accessEnabled: true,
    });
    const token = await jwtService.signAsync({ sub: person.id });
    return { cookie: `${SESSION_COOKIE_NAME}=${token}`, id: person.id };
  }

  async function createDirector(): Promise<{ cookie: string; id: string }> {
    const passwordHash = await passwordService.hashPassword("Senha@123");
    const person = await peopleService.save({
      name: "Director",
      ra: "director001",
      email: "director@example.com",
      passwordHash,
      role: Role.DIRECTOR,
      accessEnabled: true,
    });
    const token = await jwtService.signAsync({ sub: person.id });
    return { cookie: `${SESSION_COOKIE_NAME}=${token}`, id: person.id };
  }

  // -------------------------------------------------------------------------
  // Case 1 (CA80-1): POST /invites creates invite with url containing token
  // -------------------------------------------------------------------------
  describe("Case 1 (CA80-1): creates invite and returns url with token", () => {
    it("POST /invites as COORDINATOR returns 201 with id, role, expiresAt, url", async () => {
      const coord = await createCoordinator();

      const res = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.role).toBe("member");
      expect(res.body.expiresAt).toBeDefined();
      expect(res.body.url).toMatch(/\/invite\?token=.+/);
    });

    it("token in url appears in GET /auth/invites/:token on valid lookup", async () => {
      const coord = await createCoordinator();

      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const url: string = createRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      const getRes = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);

      expect(getRes.body.type).toBe("access");
      expect(getRes.body.role).toBe("member");
      expect(getRes.body.expiresAt).toBeDefined();
      // Token must NOT appear in InviteResponseDto
      expect(getRes.body).not.toHaveProperty("token");
      expect(getRes.body).not.toHaveProperty("url");
    });
  });

  // -------------------------------------------------------------------------
  // Case 2 (CA80-2): DIRECTOR and MEMBER get 403
  // -------------------------------------------------------------------------
  describe("Case 2 (CA80-2): director and member are forbidden from POST /invites", () => {
    it("403 for director", async () => {
      const director = await createDirector();
      await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", director.cookie)
        .send({ role: "member" })
        .expect(403);
    });

    it("403 for member", async () => {
      const member = await createMember();
      await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", member.cookie)
        .send({ role: "member" })
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // Case 3 (CA80-3): GET /auth/invites/:token — valid and invalid states
  // -------------------------------------------------------------------------
  describe("Case 3 (CA80-3): GET /auth/invites/:token validates invite state", () => {
    it("returns 200 for valid token", async () => {
      const coord = await createCoordinator();
      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const url: string = createRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);
    });

    it("returns 400 INVALID_INVITE for nonexistent token", async () => {
      const res = await request(app.getHttpServer())
        .get("/auth/invites/nonexistent-token")
        .expect(400);
      expect(res.body.error).toBe("INVALID_INVITE");
    });

    it("returns 400 INVALID_INVITE for used token", async () => {
      const coord = await createCoordinator();

      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const url: string = createRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      // Accept to mark as used
      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          name: "Alice",
          ra: "a2210001",
          email: "alice@example.com",
          password: "Senha@123",
        })
        .expect(204);

      // Now GET should return 400
      const res = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(400);
      expect(res.body.error).toBe("INVALID_INVITE");
    });
  });

  // -------------------------------------------------------------------------
  // Case 4 (CA80-4): full acceptance flow; login works after
  // -------------------------------------------------------------------------
  describe("Case 4 (CA80-4): accept invite provisions Person; login works", () => {
    it("accept returns 204 and new person can log in", async () => {
      const coord = await createCoordinator();

      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const url: string = createRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          name: "Alice Silva",
          ra: "a2210001",
          email: "alice@example.com",
          password: "Senha@123",
        })
        .expect(204);

      // Login should work
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210001", password: "Senha@123" })
        .expect(200);

      expect(loginRes.body.role).toBe("member");
      expect(loginRes.body.name).toBe("Alice Silva");
    });
  });

  // -------------------------------------------------------------------------
  // Case 5 (CA80-5): accepting same token twice returns 400
  // -------------------------------------------------------------------------
  describe("Case 5 (CA80-5): accepting same token twice returns 400", () => {
    it("second accept returns 400 INVALID_INVITE", async () => {
      const coord = await createCoordinator();

      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const url: string = createRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          name: "Alice",
          ra: "a2210001",
          email: "alice@example.com",
          password: "Senha@123",
        })
        .expect(204);

      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          name: "Bob",
          ra: "b2210002",
          email: "bob@example.com",
          password: "Senha@123",
        })
        .expect(400);

      expect(res.body.error).toBe("INVALID_INVITE");
    });
  });

  // -------------------------------------------------------------------------
  // Case 6 (CA80-6): RA reuse rules (RN-09) and 409 without consuming invite
  // -------------------------------------------------------------------------
  describe("Case 6 (CA80-6): RA reuse logic", () => {
    it("reuses Person with role=null (RN-09)", async () => {
      // Pre-create person with no role (not yet provisioned)
      await peopleService.save({
        name: "Placeholder",
        ra: "a2210001",
        email: null,
        passwordHash: null,
        role: null,
        accessEnabled: true,
      });

      const coord = await createCoordinator();
      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const url: string = createRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          name: "Alice Updated",
          ra: "a2210001",
          email: "alice@example.com",
          password: "Senha@123",
        })
        .expect(204);

      // Should be able to login with updated credentials
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210001", password: "Senha@123" })
        .expect(200);

      expect(loginRes.body.name).toBe("Alice Updated");

      // Ensure only one person exists with this RA
      const count = (await dataSource.query(
        "SELECT count(*) FROM people WHERE ra = 'a2210001'",
      )) as Array<{ count: string }>;
      expect(Number(count[0].count)).toBe(1);
    });

    it("409 RA_ALREADY_IN_USE for RA with role, and invite is NOT consumed", async () => {
      // Pre-create person WITH a role (already provisioned)
      await peopleService.save({
        name: "Bob",
        ra: "b2210002",
        email: "bob@example.com",
        passwordHash: await passwordService.hashPassword("Senha@123"),
        role: Role.MEMBER,
        accessEnabled: true,
      });

      const coord = await createCoordinator();
      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const url: string = createRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          name: "Bob Clone",
          ra: "b2210002",
          email: "bobclone@example.com",
          password: "Senha@123",
        })
        .expect(409);

      expect(res.body.error).toBe("RA_ALREADY_IN_USE");

      // Invite should still be valid (not consumed)
      const getRes = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);
      expect(getRes.body.type).toBe("access");
    });
  });

  // -------------------------------------------------------------------------
  // CA80-7: Events INVITE_CREATED / ACCESS_CREATED emitted
  // -------------------------------------------------------------------------
  describe("CA80-7: events INVITE_CREATED and ACCESS_CREATED are emitted", () => {
    it("emits INVITE_CREATED after POST /invites", async () => {
      const coord = await createCoordinator();
      const events: AuditableActionEvent[] = [];
      eventEmitter.on(AUDITABLE_ACTION_EVENT, (e: AuditableActionEvent) => events.push(e));

      await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const inviteCreated = events.find((e) => e.action === AuditableAction.INVITE_CREATED);
      expect(inviteCreated).toBeDefined();
      expect(inviteCreated!.targetType).toBe("invite");
    });

    it("emits ACCESS_CREATED after POST /auth/invites/accept", async () => {
      const coord = await createCoordinator();
      const events: AuditableActionEvent[] = [];
      eventEmitter.on(AUDITABLE_ACTION_EVENT, (e: AuditableActionEvent) => events.push(e));

      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const url: string = createRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          name: "Alice",
          ra: "a2210001",
          email: "alice@example.com",
          password: "Senha@123",
        })
        .expect(204);

      const accessCreated = events.find((e) => e.action === AuditableAction.ACCESS_CREATED);
      expect(accessCreated).toBeDefined();
      expect(accessCreated!.targetType).toBe("person");
    });
  });

  // -------------------------------------------------------------------------
  // Case 8: EMAIL_ALREADY_IN_USE — email owned by different person
  // -------------------------------------------------------------------------
  describe("email uniqueness check", () => {
    it("409 EMAIL_ALREADY_IN_USE when email belongs to a different person", async () => {
      // Pre-create a person who already owns the target email
      await peopleService.save({
        name: "Existing",
        ra: "x9990001",
        email: "taken@example.com",
        passwordHash: await passwordService.hashPassword("Senha@123"),
        role: Role.MEMBER,
        accessEnabled: true,
      });

      const coord = await createCoordinator();
      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const url: string = createRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          name: "New Person",
          ra: "n1110001",
          email: "taken@example.com",
          password: "Senha@123",
        })
        .expect(409);

      expect(res.body.error).toBe("EMAIL_ALREADY_IN_USE");

      // Invite must NOT be consumed — still valid for another attempt
      await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  describe("validation", () => {
    it("POST /invites with SUPERADMIN role returns 400 INVALID_ROLE", async () => {
      const coord = await createCoordinator();

      const res = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "superadmin" })
        .expect(400);

      expect(res.body.error).toBe("INVALID_ROLE");
    });

    it("POST /auth/invites/accept with password < 8 chars returns 400 VALIDATION_FAILED", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({ token: "abc", name: "Alice", ra: "a1", email: "a@a.com", password: "short" })
        .expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
    });
  });
});
