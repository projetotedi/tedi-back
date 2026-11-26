/**
 * E2e spec for InvitesController — GUS-80 CAs
 *
 * CA80-1: POST /invites returns 201 with { id, role, expiresAt, url } including token in url.
 * CA80-2: DIRECTOR/MEMBER gets 403 on POST /invites.
 * CA80-3: GET /auth/invites/:token — valid returns 200; invalid/used/expired → 400.
 * CA80-4: POST /auth/invites/accept — creates a pending member registration (GUS-91); the login of
 *         that RA answers 401 REGISTRATION_PENDING until coordination approves it.
 * CA80-5: Accepting same token twice → second call returns 400.
 * CA80-6: RA with role=null → reuses Person (RN-09); RA with role !== null → 409 no invite consumption.
 * CA80-7: GET /invites (listing) does not leak token — OUT OF SCOPE (GUS-81).
 * Events: INVITE_CREATED/MEMBER_REGISTRATION_SUBMITTED emitted via EventEmitter2.
 *
 * GUS-91: the accept body is { token, password, registration } (MemberRegistrationFormDto);
 * GET /auth/invites/:token carries the departments of the sign-up form.
 *
 * GUS-112: GET /auth/invites/:token returns `person` ({ name, ra }) only for password_reset
 * invites (usable token); access invites get `person: null`; unusable tokens get 400 INVALID_INVITE
 * with no person data.
 */
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { INestApplication } from "@nestjs/common";
import { DataSource } from "typeorm";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AuthModule } from "../auth.module";
import { PeopleModule } from "@modules/people/people.module";
import {
  REGISTRATION_SENSITIVE_VALUES,
  buildRegistration,
  insertDepartment,
} from "@modules/people/__tests__/fixtures/member-registration.fixture";
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
        // No EventEmitterModule.forRoot() here: AuthModule already registers the global one.
        // A second forRoot() creates a second EventEmitter2, and a service of PeopleModule would
        // emit on a different instance than the one this test listens to (module.get).
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
    // CASCADE from people also truncates member_profiles and student_profiles.
    await dataSource.query("TRUNCATE TABLE invites, departments, people RESTART IDENTITY CASCADE");
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
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

  /** Creates an access invite as the given coordinator and returns its raw token. */
  async function createInviteToken(coord: { cookie: string }, role = "member"): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/invites")
      .set("Cookie", coord.cookie)
      .send({ role })
      .expect(201);
    return new URL(res.body.url as string).searchParams.get("token") ?? "";
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
      const res = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", director.cookie)
        .send({ role: "member" })
        .expect(403);
      expect(res.body.error).toBe("FORBIDDEN");
    });

    it("403 for member", async () => {
      const member = await createMember();
      const res = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", member.cookie)
        .send({ role: "member" })
        .expect(403);
      expect(res.body.error).toBe("FORBIDDEN");
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
          password: "Senha@123",
          registration: buildRegistration({
            name: "Alice",
            ra: "a2210001",
            personalEmail: "alice@example.com",
          }),
        })
        .expect(204);

      // Now GET should return 400
      const res = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(400);
      expect(res.body.error).toBe("INVALID_INVITE");
    });
  });

  // -------------------------------------------------------------------------
  // Case 4 (CA80-4): full acceptance flow; the registration waits for validation (GUS-91)
  // -------------------------------------------------------------------------
  describe("Case 4 (CA80-4): accept invite creates a pending registration, without access", () => {
    it("accept returns 204, creates a pending registration and login answers 401 REGISTRATION_PENDING", async () => {
      const coord = await createCoordinator();
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      const token = await createInviteToken(coord, "director");

      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          password: "Senha@123",
          registration: buildRegistration({ name: "Alice Silva", ra: "A2210001", departmentId }),
        })
        .expect(204);

      // The Person exists without access; the requested role waits in the profile.
      const people = (await dataSource.query(
        `SELECT name, ra, email, role, access_enabled, birth_date::text AS birth_date, phone
           FROM people WHERE ra = 'a2210001'`,
      )) as Array<Record<string, unknown>>;
      expect(people).toEqual([
        {
          name: "Alice Silva",
          ra: "a2210001",
          email: "ana.torres@example.com",
          role: null,
          access_enabled: false,
          birth_date: "1999-07-22",
          phone: "11981813030",
        },
      ]);

      const profiles = (await dataSource.query(
        `SELECT registration_status, requested_role, cpf, state, institutional_email, semester,
                department_id, main_function, joined_at
           FROM member_profiles`,
      )) as Array<Record<string, unknown>>;
      expect(profiles).toEqual([
        {
          registration_status: "pending",
          requested_role: "director",
          cpf: "52998224725",
          state: "SP",
          institutional_email: "ana.torres@example.edu",
          semester: 7,
          department_id: departmentId,
          main_function: null,
          joined_at: null,
        },
      ]);

      // The invite is consumed.
      await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(400);

      // Login: the right password reaches the status of the registration.
      const pending = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210001", password: "Senha@123" })
        .expect(401);
      expect(pending.body).toMatchObject({
        error: "REGISTRATION_PENDING",
        message: "Registration awaiting validation.",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Case 5 (CA80-5): accepting same token twice returns 400
  // -------------------------------------------------------------------------
  describe("Case 5 (CA80-5): accepting same token twice returns 400", () => {
    it("second accept returns 400 INVALID_INVITE", async () => {
      const coord = await createCoordinator();
      const token = await createInviteToken(coord);

      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          password: "Senha@123",
          registration: buildRegistration({
            name: "Alice",
            ra: "a2210001",
            personalEmail: "alice@example.com",
          }),
        })
        .expect(204);

      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          password: "Senha@123",
          registration: buildRegistration({
            name: "Bob",
            ra: "b2210002",
            personalEmail: "bob@example.com",
          }),
        })
        .expect(400);

      expect(res.body.error).toBe("INVALID_INVITE");
    });
  });

  // -------------------------------------------------------------------------
  // Case 6 (CA80-6): RA reuse rules (RN-09) and 409 without consuming invite
  // -------------------------------------------------------------------------
  describe("Case 6 (CA80-6): RA reuse logic", () => {
    it("reuses Person with role=null and no member profile (RN-09)", async () => {
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
      const token = await createInviteToken(coord);

      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          password: "Senha@123",
          registration: buildRegistration({
            name: "Alice Updated",
            ra: "a2210001",
            personalEmail: "alice@example.com",
          }),
        })
        .expect(204);

      // The credentials were set, but the registration still has to be approved.
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210001", password: "Senha@123" })
        .expect(401);
      expect(loginRes.body.error).toBe("REGISTRATION_PENDING");

      // Ensure only one person exists with this RA, and it carries the new data.
      const people = (await dataSource.query(
        "SELECT id, name, email FROM people WHERE ra = 'a2210001'",
      )) as Array<{ id: string; name: string; email: string }>;
      expect(people).toHaveLength(1);
      expect(people[0]).toMatchObject({ name: "Alice Updated", email: "alice@example.com" });

      const profiles = (await dataSource.query(
        "SELECT person_id, registration_status FROM member_profiles",
      )) as Array<{ person_id: string; registration_status: string }>;
      expect(profiles).toEqual([{ person_id: people[0].id, registration_status: "pending" }]);
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
      const token = await createInviteToken(coord);

      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          password: "Senha@123",
          registration: buildRegistration({
            name: "Bob Clone",
            ra: "b2210002",
            personalEmail: "bobclone@example.com",
          }),
        })
        .expect(409);

      expect(res.body.error).toBe("RA_ALREADY_IN_USE");

      // Invite should still be valid (not consumed)
      const getRes = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);
      expect(getRes.body.type).toBe("access");
    });

    it("409 RA_ALREADY_IN_USE when the RA has a pending registration, and the pending data is kept", async () => {
      const coord = await createCoordinator();
      const firstToken = await createInviteToken(coord);
      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token: firstToken,
          password: "Senha@123",
          registration: buildRegistration({
            name: "Alice",
            ra: "a2210001",
            personalEmail: "alice@example.com",
          }),
        })
        .expect(204);

      // Someone else holding another link tries the same RA.
      const secondToken = await createInviteToken(coord);
      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token: secondToken,
          password: "Outra@1234",
          registration: buildRegistration({
            name: "Impostor",
            ra: "a2210001",
            personalEmail: "impostor@example.com",
          }),
        })
        .expect(409);
      expect(res.body.error).toBe("RA_ALREADY_IN_USE");

      // Nothing of the pending registration was overwritten, password included.
      const people = (await dataSource.query(
        "SELECT name, email FROM people WHERE ra = 'a2210001'",
      )) as Array<{ name: string; email: string }>;
      expect(people).toEqual([{ name: "Alice", email: "alice@example.com" }]);
      const original = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210001", password: "Senha@123" })
        .expect(401);
      expect(original.body.error).toBe("REGISTRATION_PENDING");
      const impostor = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ ra: "a2210001", password: "Outra@1234" })
        .expect(401);
      expect(impostor.body.error).toBe("INVALID_CREDENTIALS");

      // The second invite was not consumed.
      await request(app.getHttpServer()).get(`/auth/invites/${secondToken}`).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  // CA80-7: Events INVITE_CREATED / MEMBER_REGISTRATION_SUBMITTED emitted
  // -------------------------------------------------------------------------
  describe("CA80-7: events INVITE_CREATED and MEMBER_REGISTRATION_SUBMITTED are emitted", () => {
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

    it("emits MEMBER_REGISTRATION_SUBMITTED after POST /auth/invites/accept, without personal data", async () => {
      const coord = await createCoordinator();
      const token = await createInviteToken(coord);
      const events: AuditableActionEvent[] = [];
      eventEmitter.on(AUDITABLE_ACTION_EVENT, (e: AuditableActionEvent) => events.push(e));

      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({ token, password: "Senha@123", registration: buildRegistration() })
        .expect(204);

      const submitted = events.filter(
        (e) => e.action === AuditableAction.MEMBER_REGISTRATION_SUBMITTED,
      );
      expect(submitted).toHaveLength(1);
      const event = submitted[0];
      expect(event.targetType).toBe("member");
      // The acceptor IS the person being registered.
      expect(event.actorId).toBe(event.targetId);
      expect(event.before).toBeNull();
      expect(event.after).toMatchObject({
        registrationStatus: "pending",
        requestedRole: "member",
        resubmitted: false,
      });
      // The allow-list keeps CPF, address, phone, e-mails and birth date out of the event.
      const raw = JSON.stringify(event);
      for (const value of REGISTRATION_SENSITIVE_VALUES) {
        expect(raw).not.toContain(value);
      }
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
      const token = await createInviteToken(coord);

      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          password: "Senha@123",
          registration: buildRegistration({
            name: "New Person",
            ra: "n1110001",
            personalEmail: "taken@example.com",
          }),
        })
        .expect(409);

      expect(res.body.error).toBe("EMAIL_ALREADY_IN_USE");

      // Invite must NOT be consumed — still valid for another attempt
      await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);
    });

    it("409 EMAIL_ALREADY_IN_USE when the personal e-mail belongs to a student without RA (RN-09 reuse is by RA only)", async () => {
      const coord = await createCoordinator();
      // A student is a Person without RA: the accept finds nothing by RA and then hits the e-mail.
      await request(app.getHttpServer())
        .post("/students")
        .set("Cookie", coord.cookie)
        .send({
          name: "Maria Silva Santos",
          birthDate: "1958-04-12",
          email: "maria.santos@example.com",
        })
        .expect(201);
      const token = await createInviteToken(coord);

      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          password: "Senha@123",
          registration: buildRegistration({
            name: "Maria Silva Santos",
            ra: "n1110002",
            personalEmail: "maria.santos@example.com",
          }),
        })
        .expect(409);

      expect(res.body.error).toBe("EMAIL_ALREADY_IN_USE");

      // No second Person was created and the invite is still valid.
      const rows = (await dataSource.query(
        "SELECT count(*) FROM people WHERE email = 'maria.santos@example.com'",
      )) as Array<{ count: string }>;
      expect(Number(rows[0].count)).toBe(1);
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
        .send({ token: "abc", password: "short", registration: buildRegistration() })
        .expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
    });

    it("400 VALIDATION_FAILED with field registration for an access invite without registration, invite not consumed", async () => {
      const coord = await createCoordinator();
      const token = await createInviteToken(coord);

      // The pre-GUS-91 body (name, ra and email at the top level) has no registration either:
      // whitelist drops the extra fields and the service asks for the object.
      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          password: "Senha@123",
          name: "Alice",
          ra: "a2210001",
          email: "alice@example.com",
        })
        .expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect((res.body.details as Array<{ field: string }>)[0].field).toBe("registration");

      await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);
      const created = (await dataSource.query(
        "SELECT count(*) FROM people WHERE ra = 'a2210001'",
      )) as Array<{ count: string }>;
      expect(Number(created[0].count)).toBe(0);
    });

    it("400 VALIDATION_FAILED with fields registration.cpf and registration.state for an invalid CPF and UF", async () => {
      const coord = await createCoordinator();
      const token = await createInviteToken(coord);

      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          password: "Senha@123",
          registration: buildRegistration({ cpf: "529.982.247-24", state: "XX" }),
        })
        .expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      const fields = (res.body.details as Array<{ field: string }>).map((d) => d.field).sort();
      expect(fields).toEqual(["registration.cpf", "registration.state"]);
      // The answer never echoes the CPF (RNF-14).
      expect(JSON.stringify(res.body)).not.toContain("52998224724");
      await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);
    });

    it("400 DEPARTMENT_NOT_FOUND for an unknown departmentId, invite not consumed", async () => {
      const coord = await createCoordinator();
      const token = await createInviteToken(coord);

      const res = await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          password: "Senha@123",
          registration: buildRegistration({ departmentId: "01999a3e-0000-7000-8000-000000000000" }),
        })
        .expect(400);

      expect(res.body.error).toBe("DEPARTMENT_NOT_FOUND");
      await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);
      const created = (await dataSource.query(
        "SELECT count(*) FROM people WHERE ra = 'a2210001'",
      )) as Array<{ count: string }>;
      expect(Number(created[0].count)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // CA81-2: GET /invites — list sem tokenHash, status calculado
  // -------------------------------------------------------------------------
  describe("CA81-2: GET /invites — no tokenHash, computed status", () => {
    it("GET /invites returns list without tokenHash", async () => {
      const coord = await createCoordinator();

      // Create a couple of invites
      await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get("/invites")
        .set("Cookie", coord.cookie)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      for (const invite of res.body as Array<Record<string, unknown>>) {
        expect(invite).not.toHaveProperty("tokenHash");
        expect(invite).toHaveProperty("status");
        expect(invite).toHaveProperty("type");
        expect(invite).toHaveProperty("id");
      }
    });

    it("GET /invites with ?status=pending returns only pending invites", async () => {
      const coord = await createCoordinator();

      await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get("/invites?status=pending")
        .set("Cookie", coord.cookie)
        .expect(200);

      for (const invite of res.body as Array<{ status: string }>) {
        expect(invite.status).toBe("pending");
      }
    });

    it("403 for member on GET /invites", async () => {
      const member = await createMember();
      const res = await request(app.getHttpServer())
        .get("/invites")
        .set("Cookie", member.cookie)
        .expect(403);
      expect(res.body.error).toBe("FORBIDDEN");
    });
  });

  // -------------------------------------------------------------------------
  // CA81-8: Revogar convite
  // -------------------------------------------------------------------------
  describe("CA81-8: revogar convite pendente/usado", () => {
    it("DELETE /invites/:id revokes pending invite → GET /auth/invites/:token returns 400", async () => {
      const coord = await createCoordinator();

      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const url: string = createRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      // Extract invite id from list
      const listRes = await request(app.getHttpServer())
        .get("/invites?status=pending")
        .set("Cookie", coord.cookie)
        .expect(200);

      const inviteId = (listRes.body as Array<{ id: string }>)[0].id;

      // Revoke
      await request(app.getHttpServer())
        .delete(`/invites/${inviteId}`)
        .set("Cookie", coord.cookie)
        .expect(204);

      // GET /auth/invites/:token should now return 400
      const getRes = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(400);
      expect(getRes.body.error).toBe("INVALID_INVITE");
    });

    it("DELETE /invites/:id on used invite → 409 INVITE_ALREADY_USED", async () => {
      const coord = await createCoordinator();

      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const url: string = createRes.body.url as string;
      const token = new URL(url).searchParams.get("token") ?? "";

      // Accept the invite to mark as used
      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({
          token,
          password: "Senha@123",
          registration: buildRegistration({
            name: "Alice",
            ra: "alice001",
            personalEmail: "alice@example.com",
          }),
        })
        .expect(204);

      // Get invite id
      const listRes = await request(app.getHttpServer())
        .get("/invites?status=used")
        .set("Cookie", coord.cookie)
        .expect(200);

      const inviteId = (listRes.body as Array<{ id: string }>)[0].id;

      // Trying to revoke used invite → 409
      const res = await request(app.getHttpServer())
        .delete(`/invites/${inviteId}`)
        .set("Cookie", coord.cookie)
        .expect(409);

      expect(res.body.error).toBe("INVITE_ALREADY_USED");
    });

    it("DELETE /invites/:id on already revoked invite → 409 INVITE_ALREADY_REVOKED", async () => {
      const coord = await createCoordinator();

      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      // Get invite id from list
      const listRes = await request(app.getHttpServer())
        .get("/invites?status=pending")
        .set("Cookie", coord.cookie)
        .expect(200);

      const inviteId = (listRes.body as Array<{ id: string }>)[0].id;
      void createRes;

      // First revoke
      await request(app.getHttpServer())
        .delete(`/invites/${inviteId}`)
        .set("Cookie", coord.cookie)
        .expect(204);

      // Second revoke → 409 INVITE_ALREADY_REVOKED
      const res = await request(app.getHttpServer())
        .delete(`/invites/${inviteId}`)
        .set("Cookie", coord.cookie)
        .expect(409);

      expect(res.body.error).toBe("INVITE_ALREADY_REVOKED");
    });

    it("CA81-9: DELETE /invites/:id emits INVITE_REVOKED event", async () => {
      const coord = await createCoordinator();
      const events: AuditableActionEvent[] = [];
      eventEmitter.on(AUDITABLE_ACTION_EVENT, (e: AuditableActionEvent) => events.push(e));

      await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);

      const listRes = await request(app.getHttpServer())
        .get("/invites?status=pending")
        .set("Cookie", coord.cookie)
        .expect(200);

      const inviteId = (listRes.body as Array<{ id: string }>)[0].id;

      await request(app.getHttpServer())
        .delete(`/invites/${inviteId}`)
        .set("Cookie", coord.cookie)
        .expect(204);

      const inviteRevoked = events.find((e) => e.action === AuditableAction.INVITE_REVOKED);
      expect(inviteRevoked).toBeDefined();
      expect(inviteRevoked!.targetId).toBe(inviteId);
    });
  });

  // -------------------------------------------------------------------------
  // GUS-112: GET /auth/invites/:token exposes the account only on password_reset
  // -------------------------------------------------------------------------
  describe("GUS-112: GET /auth/invites/:token exposes the account only on password_reset", () => {
    async function createPasswordResetToken(): Promise<string> {
      const coord = await createCoordinator();
      const passwordHash = await passwordService.hashPassword("Senha@123");
      const person = await peopleService.save({
        name: "Beatriz Nunes Carvalho",
        ra: "202400003",
        email: "beatriz@example.com",
        passwordHash,
        role: Role.MEMBER,
        accessEnabled: true,
      });

      const res = await request(app.getHttpServer())
        .post(`/access/${person.id}/password-reset`)
        .set("Cookie", coord.cookie)
        .expect(201);

      const token = new URL(res.body.url as string).searchParams.get("token");
      expect(token).toBeTruthy();
      return token as string;
    }

    function expectNoPersonData(res: { body: unknown }): void {
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain("Beatriz");
      expect(raw).not.toContain("202400003");
    }

    it("returns person null, not omitted, for an access invite", async () => {
      const coord = await createCoordinator();
      const createRes = await request(app.getHttpServer())
        .post("/invites")
        .set("Cookie", coord.cookie)
        .send({ role: "member" })
        .expect(201);
      const token = new URL(createRes.body.url as string).searchParams.get("token");
      expect(token).toBeTruthy();

      const res = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);

      expect(res.body).toStrictEqual({
        type: "access",
        role: "member",
        expiresAt: expect.any(String),
        departments: [],
        person: null,
      });
    });

    it("returns the departments ordered by name for an access invite", async () => {
      const coord = await createCoordinator();
      const tecnologiaId = await insertDepartment(dataSource, "Tecnologia");
      const comunicacaoId = await insertDepartment(dataSource, "Comunicação");
      const token = await createInviteToken(coord);

      const res = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);

      // Explicit projection: only id and name, ordered by name.
      expect(res.body.departments).toStrictEqual([
        { id: comunicacaoId, name: "Comunicação" },
        { id: tecnologiaId, name: "Tecnologia" },
      ]);
    });

    it("returns the account name and RA for a password_reset invite", async () => {
      const token = await createPasswordResetToken();

      const res = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(200);

      expect(res.body).toStrictEqual({
        type: "password_reset",
        role: null,
        expiresAt: expect.any(String),
        departments: [],
        person: { name: "Beatriz Nunes Carvalho", ra: "202400003" },
      });
    });

    it("returns 400 INVALID_INVITE without person data for a used password_reset invite", async () => {
      const token = await createPasswordResetToken();
      await request(app.getHttpServer())
        .post("/auth/invites/accept")
        .send({ token, password: "NovaSenh@456" })
        .expect(204);

      const res = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(400);

      expect(res.body.error).toBe("INVALID_INVITE");
      expectNoPersonData(res);
    });

    it("returns 400 INVALID_INVITE without person data for an expired password_reset invite", async () => {
      const token = await createPasswordResetToken();
      await dataSource.query(
        "UPDATE invites SET expires_at = now() - interval '1 hour' WHERE type = 'password_reset'",
      );

      const res = await request(app.getHttpServer()).get(`/auth/invites/${token}`).expect(400);

      expect(res.body.error).toBe("INVALID_INVITE");
      expectNoPersonData(res);
    });
  });
});
