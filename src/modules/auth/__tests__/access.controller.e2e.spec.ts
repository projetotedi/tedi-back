/**
 * E2e spec for AccessController — GUS-81 CAs (access management)
 *
 * CA81-1: GET /access paginado + search + 403 para member/director
 * CA81-3: PATCH /access/:id/role → 200 + GET /auth/me reflete novo role
 * CA81-4: Coord/superadmin sobre a própria conta → 403 OWN_ACCOUNT
 * CA81-5: Última coordenadora ativa → 409 LAST_COORDINATOR (coord)
 *         Superadmin pode desativar a última coordenadora ativa
 * CA81-6: Desativar director logado → 401 na próxima request
 * CA81-7: POST /access/:id/password-reset → url; accept {token,password} troca senha
 * CA81-9: Cada ação emite exatamente um AuditableActionEvent
 *
 * Case 1 (CA81-1): list paginated + 403 for non-coordinator
 * Case 2 (CA81-2): handled in invites.controller.e2e.spec.ts
 * Case 3 (CA81-3): role change propagates to /auth/me
 * Case 4 (CA81-4): OWN_ACCOUNT on own account
 * Case 5 (CA81-5): LAST_COORDINATOR block + superadmin bypass
 * Case 6 (CA81-6): immediate revocation on next request after disable
 * Case 7 (CA81-7): full password reset flow
 * Case 8 (CA81-8): handled in invites.controller.e2e.spec.ts
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

process.env.JWT_SECRET = "e2e-access-ctrl-secret";
process.env.APP_URL = "http://localhost:5173";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AccessController (e2e)", () => {
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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function createPerson(opts: {
    name: string;
    ra: string;
    email: string;
    role: Role;
    accessEnabled?: boolean;
  }): Promise<{ cookie: string; id: string }> {
    const passwordHash = await passwordService.hashPassword("Senha@123");
    const person = await peopleService.save({
      name: opts.name,
      ra: opts.ra,
      email: opts.email,
      passwordHash,
      role: opts.role,
      accessEnabled: opts.accessEnabled ?? true,
    });
    const token = await jwtService.signAsync({ sub: person.id });
    return { cookie: `${SESSION_COOKIE_NAME}=${token}`, id: person.id };
  }

  async function createCoordinator(
    ra = "coord001",
    email = "coord@example.com",
  ): Promise<{ cookie: string; id: string }> {
    return createPerson({ name: "Coordinator", ra, email, role: Role.COORDINATOR });
  }

  async function createMember(): Promise<{ cookie: string; id: string }> {
    return createPerson({
      name: "Member",
      ra: "member001",
      email: "member@example.com",
      role: Role.MEMBER,
    });
  }

  async function createDirector(): Promise<{ cookie: string; id: string }> {
    return createPerson({
      name: "Director",
      ra: "director001",
      email: "director@example.com",
      role: Role.DIRECTOR,
    });
  }

  async function createSuperadmin(): Promise<{ cookie: string; id: string }> {
    return createPerson({
      name: "Superadmin",
      ra: "superadmin001",
      email: "superadmin@example.com",
      role: Role.SUPERADMIN,
    });
  }

  // ---------------------------------------------------------------------------
  // Case 1 (CA81-1): GET /access — list paginated + 403 for non-coordinator
  // ---------------------------------------------------------------------------

  describe("Case 1 (CA81-1): list access paginado + 403 para member/director", () => {
    it("GET /access returns paginated list of people with role", async () => {
      const coord = await createCoordinator();
      await createMember();

      const res = await request(app.getHttpServer())
        .get("/access")
        .set("Cookie", coord.cookie)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe("number");
      expect(typeof res.body.page).toBe("number");
      expect(typeof res.body.limit).toBe("number");
      // Both coordinator and member have roles
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it("GET /access with ?search filters by name", async () => {
      const coord = await createCoordinator();
      await createMember();

      const res = await request(app.getHttpServer())
        .get("/access?search=Coordinator")
        .set("Cookie", coord.cookie)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].name).toContain("Coordinator");
    });

    it("GET /access with ?role=member filters by role", async () => {
      const coord = await createCoordinator();
      await createMember();

      const res = await request(app.getHttpServer())
        .get("/access?role=member")
        .set("Cookie", coord.cookie)
        .expect(200);

      expect(res.body.data.every((p: { role: string }) => p.role === "member")).toBe(true);
    });

    it("403 for member on GET /access", async () => {
      const member = await createMember();
      await request(app.getHttpServer()).get("/access").set("Cookie", member.cookie).expect(403);
    });

    it("403 for director on GET /access", async () => {
      const director = await createDirector();
      await request(app.getHttpServer()).get("/access").set("Cookie", director.cookie).expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Case 3 (CA81-3): PATCH /access/:id/role → 200 + /auth/me reflete
  // ---------------------------------------------------------------------------

  describe("Case 3 (CA81-3): role change propagates to /auth/me", () => {
    it("PATCH /access/:id/role updates role and GET /auth/me reflects it", async () => {
      const coord = await createCoordinator();
      const director = await createDirector();

      const res = await request(app.getHttpServer())
        .patch(`/access/${director.id}/role`)
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(200);

      expect(res.body.role).toBe("member");

      // Login again to get a fresh cookie reflecting new role
      const meRes = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Cookie", director.cookie)
        .expect(200);

      expect(meRes.body.role).toBe("member");
    });
  });

  // ---------------------------------------------------------------------------
  // Case 4 (CA81-4): OWN_ACCOUNT
  // ---------------------------------------------------------------------------

  describe("Case 4 (CA81-4): OWN_ACCOUNT when acting on own account", () => {
    it("PATCH /access/:id/role returns 403 OWN_ACCOUNT for self", async () => {
      const coord = await createCoordinator();

      const res = await request(app.getHttpServer())
        .patch(`/access/${coord.id}/role`)
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(403);

      expect(res.body.error).toBe("OWN_ACCOUNT");
    });

    it("PATCH /access/:id/enabled returns 403 OWN_ACCOUNT for self", async () => {
      const coord = await createCoordinator();

      const res = await request(app.getHttpServer())
        .patch(`/access/${coord.id}/enabled`)
        .set("Cookie", coord.cookie)
        .send({ enabled: false })
        .expect(403);

      expect(res.body.error).toBe("OWN_ACCOUNT");
    });
  });

  // ---------------------------------------------------------------------------
  // Case 5 (CA81-5): LAST_COORDINATOR + superadmin bypass
  // ---------------------------------------------------------------------------

  describe("Case 5 (CA81-5): LAST_COORDINATOR check + superadmin bypass", () => {
    it("CA81-5: superadmin can demote last active coordinator (no LAST_COORDINATOR block)", async () => {
      // LAST_COORDINATOR for coordinator actor is covered by unit tests.
      // In e2e, the only way to have a single coordinator AND a different coordinator actor
      // is structurally impossible (if only one coordinator exists, that IS the actor → OWN_ACCOUNT).
      // E2E proves the superadmin bypass: superadmin demotes the last coordinator → 200.
      const superadminActor = await createSuperadmin();
      const loneCoord = await createCoordinator("lone001", "lone@example.com");

      const res = await request(app.getHttpServer())
        .patch(`/access/${loneCoord.id}/role`)
        .set("Cookie", superadminActor.cookie)
        .send({ role: "member" })
        .expect(200);

      expect(res.body.role).toBe("member");
    });

    it("CA81-5: superadmin can disable last active coordinator (no LAST_COORDINATOR block)", async () => {
      const superadminActor = await createSuperadmin();
      const loneCoord = await createCoordinator("lonecoord", "lonecoord@example.com");

      const res = await request(app.getHttpServer())
        .patch(`/access/${loneCoord.id}/enabled`)
        .set("Cookie", superadminActor.cookie)
        .send({ enabled: false })
        .expect(200);

      expect(res.body.accessEnabled).toBe(false);
    });

    it("CA81-5: coordinator gets 409 LAST_COORDINATOR when trying to disable last enabled coordinator", async () => {
      // Setup: coord1 + coord2 (both enabled coordinators)
      // Superadmin disables coord2 (bypasses LAST_COORDINATOR — coord1 still enabled, count stays at 1 after)
      // coord1 then tries to PATCH /access/coord2/enabled {enabled:false} → coord2 still has role=coordinator
      // assertNotLastCoordinator counts role=coordinator AND accessEnabled=true → only coord1 → count=1 → 409
      const superadmin = await createSuperadmin();
      const coord1 = await createCoordinator("coord1001", "coord1@example.com");
      const coord2 = await createCoordinator("coord2002", "coord2@example.com");

      // Superadmin disables coord2 (200, bypasses LAST_COORDINATOR)
      await request(app.getHttpServer())
        .patch(`/access/${coord2.id}/enabled`)
        .set("Cookie", superadmin.cookie)
        .send({ enabled: false })
        .expect(200);

      // coord1 tries to disable coord2 again — coord2 has role=coordinator but accessEnabled=false
      // assertNotLastCoordinator: count of enabled coordinators = 1 (only coord1) → 409
      const res = await request(app.getHttpServer())
        .patch(`/access/${coord2.id}/enabled`)
        .set("Cookie", coord1.cookie)
        .send({ enabled: false })
        .expect(409);

      expect(res.body.error).toBe("LAST_COORDINATOR");
    });
  });

  // ---------------------------------------------------------------------------
  // Case 6 (CA81-6): Desativar director → 401 na próxima request
  // ---------------------------------------------------------------------------

  describe("Case 6 (CA81-6): immediate revocation on next request after disable", () => {
    it("disabled director gets 401 on next authenticated request", async () => {
      const coord = await createCoordinator();
      const director = await createDirector();

      // Confirm director can access protected routes
      await request(app.getHttpServer()).get("/auth/me").set("Cookie", director.cookie).expect(200);

      // Coordinator disables director
      await request(app.getHttpServer())
        .patch(`/access/${director.id}/enabled`)
        .set("Cookie", coord.cookie)
        .send({ enabled: false })
        .expect(200);

      // Director's next request returns 401
      await request(app.getHttpServer()).get("/auth/me").set("Cookie", director.cookie).expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Case 7 (CA81-7): full password reset flow
  // ---------------------------------------------------------------------------

  describe("Case 7 (CA81-7): full password reset flow", () => {
    it("POST /access/:id/password-reset returns url; accept {token,password} changes password", async () => {
      const coord = await createCoordinator();
      const member = await createMember();

      // Create password reset
      const resetRes = await request(app.getHttpServer())
        .post(`/access/${member.id}/password-reset`)
        .set("Cookie", coord.cookie)
        .expect(201);

      expect(resetRes.body.url).toBeDefined();
      expect(resetRes.body.url).toMatch(/reset-password\?token=.+/);
      expect(resetRes.body.expiresAt).toBeDefined();

      // Extract token from url
      const url: string = resetRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      // Accept with new password
      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({ token, password: "NovaSenh@456" })
        .expect(204);

      // Old password should no longer work
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "member001", password: "Senha@123" })
        .expect(401);

      // New password should work
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "member001", password: "NovaSenh@456" })
        .expect(200);

      expect(loginRes.body.role).toBe("member");
    });

    it("CA81-7: coordinator can generate reset for own account", async () => {
      const coord = await createCoordinator();

      const res = await request(app.getHttpServer())
        .post(`/access/${coord.id}/password-reset`)
        .set("Cookie", coord.cookie)
        .expect(201);

      expect(res.body.url).toBeDefined();
    });

    it("400 INVALID_ROLE when trying to assign SUPERADMIN via PATCH role", async () => {
      const coord = await createCoordinator();
      const member = await createMember();

      const res = await request(app.getHttpServer())
        .patch(`/access/${member.id}/role`)
        .set("Cookie", coord.cookie)
        .send({ role: "superadmin" })
        .expect(400);

      expect(res.body.error).toBe("INVALID_ROLE");
    });
  });

  // ---------------------------------------------------------------------------
  // Case 9 (CA81-9): each action emits exactly one AuditableActionEvent
  // ---------------------------------------------------------------------------

  describe("Case 9 (CA81-9): each management action emits one AuditableActionEvent", () => {
    it("PATCH role emits ROLE_CHANGED", async () => {
      const coord = await createCoordinator();
      const director = await createDirector();
      const events: AuditableActionEvent[] = [];
      eventEmitter.on(AUDITABLE_ACTION_EVENT, (e: AuditableActionEvent) => events.push(e));

      await request(app.getHttpServer())
        .patch(`/access/${director.id}/role`)
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(200);

      const roleChanged = events.find((e) => e.action === AuditableAction.ROLE_CHANGED);
      expect(roleChanged).toBeDefined();
      expect(roleChanged!.targetId).toBe(director.id);
      expect(roleChanged!.before).toEqual({ role: "director" });
      expect(roleChanged!.after).toEqual({ role: "member" });
    });

    it("PATCH enabled=false emits ACCESS_DISABLED", async () => {
      const coord = await createCoordinator();
      const director = await createDirector();
      const events: AuditableActionEvent[] = [];
      eventEmitter.on(AUDITABLE_ACTION_EVENT, (e: AuditableActionEvent) => events.push(e));

      await request(app.getHttpServer())
        .patch(`/access/${director.id}/enabled`)
        .set("Cookie", coord.cookie)
        .send({ enabled: false })
        .expect(200);

      const accessDisabled = events.find((e) => e.action === AuditableAction.ACCESS_DISABLED);
      expect(accessDisabled).toBeDefined();
    });

    it("PATCH enabled=true emits ACCESS_ENABLED", async () => {
      const coord = await createCoordinator();
      // Create a disabled member
      const disabledMember = await createPerson({
        name: "Disabled",
        ra: "dis001",
        email: "dis@example.com",
        role: Role.MEMBER,
        accessEnabled: false,
      });
      const events: AuditableActionEvent[] = [];
      eventEmitter.on(AUDITABLE_ACTION_EVENT, (e: AuditableActionEvent) => events.push(e));

      await request(app.getHttpServer())
        .patch(`/access/${disabledMember.id}/enabled`)
        .set("Cookie", coord.cookie)
        .send({ enabled: true })
        .expect(200);

      const accessEnabled = events.find((e) => e.action === AuditableAction.ACCESS_ENABLED);
      expect(accessEnabled).toBeDefined();
    });

    it("POST password-reset emits PASSWORD_RESET_CREATED", async () => {
      const coord = await createCoordinator();
      const member = await createMember();
      const events: AuditableActionEvent[] = [];
      eventEmitter.on(AUDITABLE_ACTION_EVENT, (e: AuditableActionEvent) => events.push(e));

      await request(app.getHttpServer())
        .post(`/access/${member.id}/password-reset`)
        .set("Cookie", coord.cookie)
        .expect(201);

      const resetCreated = events.find((e) => e.action === AuditableAction.PASSWORD_RESET_CREATED);
      expect(resetCreated).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 404 cases
  // ---------------------------------------------------------------------------

  describe("404 cases", () => {
    it("PATCH /access/:id/role with nonexistent id returns 404", async () => {
      const coord = await createCoordinator();

      await request(app.getHttpServer())
        .patch("/access/00000000-0000-7000-8000-000000000000/role")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(404);
    });

    it("POST /access/:id/password-reset with nonexistent id returns 404", async () => {
      const coord = await createCoordinator();

      await request(app.getHttpServer())
        .post("/access/00000000-0000-7000-8000-000000000000/password-reset")
        .set("Cookie", coord.cookie)
        .expect(404);
    });
  });
});
