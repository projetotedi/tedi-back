/**
 * E2e spec for MemberRegistrationsController — GUS-91 (member registration and validation).
 *
 * Card cases:
 *  1. accept -> "A validar" -> approve -> login
 *  2. accept -> reject -> login of the rejected registration
 *  3. the queue, the detail and the permissions (invites.manage: coordination only)
 *
 * The registrations are created through the real flow (POST /invites + POST /auth/invites/accept),
 * so these tests also prove that the accept leaves a pending registration, without access.
 */
import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import cookieParser from "cookie-parser";
import { join } from "node:path";
import request from "supertest";
import { DataSource } from "typeorm";
import { AuthModule } from "@modules/auth/auth.module";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { PeopleModule } from "../people.module";
import { PeopleService } from "../services/people.service";
import {
  REGISTRATION_PERSONAL_VALUES,
  REGISTRATION_SENSITIVE_VALUES,
  buildRegistration,
  insertDepartment,
} from "./fixtures/member-registration.fixture";

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

process.env.JWT_SECRET = "e2e-member-registrations-secret";
process.env.APP_URL = "http://localhost:5173";

// Name of the session cookie set by the auth module (kept local: tests do not import module internals).
const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";
const PASSWORD = "Senha@123";
// A fixed past date: the join date cannot be in the future.
const JOINED_AT = "2025-03-01";
const MAIN_FUNCTION = "Monitora de informática";

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field);
}

/** Overrides of buildRegistration with a RA, an e-mail and a name that are unique per applicant. */
function applicant(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Aluno ${n}`,
    ra: `m22100${n}`,
    personalEmail: `aluno${n}@example.com`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("MemberRegistrationsController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;

  let coordinator: Actor;
  let director: Actor;
  let member: Actor;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // No EventEmitterModule.forRoot() here: AuthModule already registers the global one.
        // A second forRoot() creates a second EventEmitter2, and the services would emit on a
        // different instance than the one this test listens to (module.get).
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
    jwtService = module.get(JwtService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    // CASCADE from people also truncates member_profiles and student_profiles.
    await dataSource.query("TRUNCATE TABLE invites, departments, people RESTART IDENTITY CASCADE");

    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    director = await createActor("Director", Role.DIRECTOR);
    member = await createActor("Member", Role.MEMBER);
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /**
   * Registers a member through the real flow: coordination creates an invite and the
   * applicant accepts it with the registration form. Returns the id of the Person.
   */
  async function submitViaInvite(
    overrides: Record<string, unknown> = {},
    requestedRole = "member",
  ): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/invites")
      .set("Cookie", coordinator.cookie)
      .send({ role: requestedRole })
      .expect(201);
    const token = new URL(created.body.url as string).searchParams.get("token") ?? "";

    const registration = buildRegistration(overrides);
    await request(app.getHttpServer())
      .post("/auth/invites/accept")
      .send({ token, password: PASSWORD, registration })
      .expect(204);

    const rows = (await dataSource.query("SELECT id FROM people WHERE ra = $1", [
      String(registration.ra).toLowerCase(),
    ])) as Array<{ id: string }>;
    return rows[0].id;
  }

  function approvalBody(departmentId: string | null, overrides: Record<string, unknown> = {}) {
    return {
      role: "member",
      ...(departmentId === null ? {} : { departmentId }),
      mainFunction: MAIN_FUNCTION,
      joinedAt: JOINED_AT,
      ...overrides,
    };
  }

  function approve(id: string, body: Record<string, unknown>, actor: Actor = coordinator) {
    return request(app.getHttpServer())
      .patch(`/member-registrations/${id}/approve`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  function reject(id: string, body: Record<string, unknown>, actor: Actor = coordinator) {
    return request(app.getHttpServer())
      .patch(`/member-registrations/${id}/reject`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  function login(ra: string, password = PASSWORD) {
    return request(app.getHttpServer()).post("/auth/login").send({ ra, password });
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  async function profileOf(personId: string): Promise<Record<string, unknown>> {
    const rows = (await dataSource.query(
      `SELECT registration_status, department_id, main_function, joined_at::text AS joined_at,
              reviewed_by_id, reviewed_at, review_note, cpf, submitted_at
         FROM member_profiles WHERE person_id = $1`,
      [personId],
    )) as Array<Record<string, unknown>>;
    return rows[0];
  }

  async function personRow(
    personId: string,
  ): Promise<{ role: string | null; access_enabled: boolean }> {
    const rows = (await dataSource.query("SELECT role, access_enabled FROM people WHERE id = $1", [
      personId,
    ])) as Array<{ role: string | null; access_enabled: boolean }>;
    return rows[0];
  }

  /** Personal data: only the detail for coordination carries it (queue and errors do not). */
  function expectNoPersonalData(value: unknown): void {
    const raw = JSON.stringify(value);
    for (const personal of [...REGISTRATION_PERSONAL_VALUES, "aluno1@example.com"]) {
      expect(raw).not.toContain(personal);
    }
  }

  /** Audit events carry neither personal nor academic data. */
  function expectNoSensitiveValue(value: unknown): void {
    const raw = JSON.stringify(value);
    for (const sensitive of [...REGISTRATION_SENSITIVE_VALUES, "aluno1@example.com"]) {
      expect(raw).not.toContain(sensitive);
    }
  }

  // ---------------------------------------------------------------------------
  // Card e2e cases
  // ---------------------------------------------------------------------------

  describe("registration flow (card e2e)", () => {
    it("accept → pending → approve → login: 401 REGISTRATION_PENDING before approval, 200 with the approved role after", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      const id = await submitViaInvite(applicant(1, { ra: "f2210001", departmentId }), "director");

      // Before the approval the right password is not enough.
      const pending = await login("f2210001").expect(401);
      expect(pending.body).toMatchObject({
        error: "REGISTRATION_PENDING",
        message: "Registration awaiting validation.",
      });

      const approved = await approve(id, approvalBody(departmentId, { role: "director" })).expect(
        200,
      );
      expect(approved.body).toMatchObject({
        id,
        role: "director",
        accessEnabled: true,
        registrationStatus: "approved",
      });

      // After the approval the login answers with the role chosen by coordination.
      const ok = await login("f2210001").expect(200);
      expect(ok.body).toMatchObject({ id, ra: "f2210001", role: "director" });

      const setCookie = ok.headers["set-cookie"] as string[] | string;
      const sessionCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
      const me = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Cookie", sessionCookie)
        .expect(200);
      expect(me.body).toMatchObject({ id, role: "director" });
    });

    it("accept → reject → login: 401 REGISTRATION_REJECTED with the right password", async () => {
      const id = await submitViaInvite(applicant(1, { ra: "f2210002" }));

      await reject(id, { note: "O RA informado não confere com o termo de voluntariado." }).expect(
        200,
      );

      const rejected = await login("f2210002").expect(401);
      expect(rejected.body).toMatchObject({
        error: "REGISTRATION_REJECTED",
        message: "Registration rejected. Contact coordination.",
      });
      // With a wrong password nothing about the registration is revealed.
      const wrong = await login("f2210002", "Errada@123").expect(401);
      expect(wrong.body.error).toBe("INVALID_CREDENTIALS");
    });

    it("a rejected person resubmits with a new invite: same Person, pending again", async () => {
      const events = collectEvents();
      const overrides = applicant(1, { ra: "f2210003", personalEmail: "reenvio@example.com" });
      const id = await submitViaInvite(overrides);
      await reject(id, { note: "CPF ilegível no termo." }).expect(200);

      // New invite, corrected data (a valid CPF other than the first one).
      const again = await submitViaInvite({
        ...overrides,
        name: "Aluno Corrigido",
        cpf: "111.444.777-35",
      });

      expect(again).toBe(id);
      const people = (await dataSource.query(
        "SELECT name FROM people WHERE ra = 'f2210003'",
      )) as Array<{ name: string }>;
      expect(people).toEqual([{ name: "Aluno Corrigido" }]);

      const profiles = (await dataSource.query(
        "SELECT count(*) FROM member_profiles WHERE person_id = $1",
        [id],
      )) as Array<{ count: string }>;
      expect(Number(profiles[0].count)).toBe(1);
      expect(await profileOf(id)).toMatchObject({
        registration_status: "pending",
        cpf: "11144477735",
        reviewed_at: null,
        reviewed_by_id: null,
        review_note: null,
      });

      const pending = await login("f2210003").expect(401);
      expect(pending.body.error).toBe("REGISTRATION_PENDING");

      const submitted = events.filter(
        (event) => event.action === AuditableAction.MEMBER_REGISTRATION_SUBMITTED,
      );
      expect(submitted).toHaveLength(2);
      expect(submitted[0].before).toBeNull();
      expect(submitted[1].before).toEqual({ registrationStatus: "rejected" });
      expect(submitted[1].after).toMatchObject({
        registrationStatus: "pending",
        resubmitted: true,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /member-registrations
  // ---------------------------------------------------------------------------

  describe("GET /member-registrations (listMemberRegistrations)", () => {
    it("lists pending registrations by default, oldest first, without cpf", async () => {
      const first = await submitViaInvite(applicant(1, { name: "Ana Torres" }));
      const second = await submitViaInvite(applicant(2, { name: "Bruno Lima" }));
      const third = await submitViaInvite(applicant(3, { name: "Carla Dias" }));
      // Approved registrations leave the queue.
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      await approve(second, approvalBody(departmentId)).expect(200);

      const res = await request(app.getHttpServer())
        .get("/member-registrations")
        .set("Cookie", coordinator.cookie)
        .expect(200);

      expect(res.body).toMatchObject({ total: 2, page: 1, limit: 20 });
      const data = res.body.data as Array<Record<string, unknown>>;
      expect(data.map((item) => item.id)).toEqual([first, third]);
      expect(data.map((item) => item.registrationStatus)).toEqual(["pending", "pending"]);
      expect(Object.keys(data[0]).sort()).toEqual([
        "className",
        "course",
        "department",
        "id",
        "name",
        "ra",
        "registrationStatus",
        "requestedRole",
        "reviewedAt",
        "semester",
        "submittedAt",
      ]);
      expect(data[0]).toMatchObject({
        name: "Ana Torres",
        ra: "m221001",
        requestedRole: "member",
        course: "Sistemas de Informação",
        className: "SI-2024-N",
        semester: 7,
        department: null,
        reviewedAt: null,
      });
      // The queue never carries CPF, address, phone nor e-mails (RNF-13/14).
      expectNoPersonalData(res.body);
    });

    it("filters by status and searches by name or RA", async () => {
      const ana = await submitViaInvite(applicant(1, { name: "Ana Torres", ra: "a2210001" }));
      const bruno = await submitViaInvite(applicant(2, { name: "Bruno Lima", ra: "b2210002" }));
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      await approve(bruno, approvalBody(departmentId)).expect(200);

      const list = async (query: string): Promise<string[]> => {
        const res = await request(app.getHttpServer())
          .get(`/member-registrations${query}`)
          .set("Cookie", coordinator.cookie)
          .expect(200);
        return (res.body.data as Array<{ id: string }>).map((item) => item.id);
      };

      expect(await list("?status=approved")).toEqual([bruno]);
      expect(await list("?status=rejected")).toEqual([]);
      expect(await list("?status=pending")).toEqual([ana]);
      // Name, ignoring case, and RA, ignoring case.
      expect(await list("?search=ANA")).toEqual([ana]);
      expect(await list("?search=a2210001")).toEqual([ana]);
      expect(await list("?status=approved&search=B2210002")).toEqual([bruno]);
      expect(await list("?search=bruno")).toEqual([]);

      const invalid = await request(app.getHttpServer())
        .get("/member-registrations?status=bogus")
        .set("Cookie", coordinator.cookie)
        .expect(400);
      expect(invalid.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(invalid.body)).toEqual(["status"]);
    });

    it("paginates with page and limit", async () => {
      await submitViaInvite(applicant(1));
      const second = await submitViaInvite(applicant(2));

      const res = await request(app.getHttpServer())
        .get("/member-registrations?page=2&limit=1")
        .set("Cookie", coordinator.cookie)
        .expect(200);

      expect(res.body).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect((res.body.data as Array<{ id: string }>).map((item) => item.id)).toEqual([second]);
    });

    it("returns 403 FORBIDDEN for a director and for a member", async () => {
      for (const actor of [director, member]) {
        const res = await request(app.getHttpServer())
          .get("/member-registrations")
          .set("Cookie", actor.cookie)
          .expect(403);
        expect(res.body.error).toBe("FORBIDDEN");
      }
    });

    it("returns 401 UNAUTHORIZED without a session", async () => {
      await request(app.getHttpServer()).get("/member-registrations").expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /member-registrations/:id
  // ---------------------------------------------------------------------------

  describe("GET /member-registrations/:id (getMemberRegistration)", () => {
    it("returns the full registration with cpf, address and department for a coordinator", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      const id = await submitViaInvite(
        applicant(1, { name: "Ana Torres", ra: "a2210001", departmentId }),
      );

      const res = await request(app.getHttpServer())
        .get(`/member-registrations/${id}`)
        .set("Cookie", coordinator.cookie)
        .expect(200);

      expect(res.body).toStrictEqual({
        id,
        name: "Ana Torres",
        ra: "a2210001",
        personalEmail: "aluno1@example.com",
        phone: "11981813030",
        birthDate: "1999-07-22",
        cpf: "52998224725",
        address: "Rua das Acácias, 120, apto 42",
        city: "São Paulo",
        state: "SP",
        institutionalEmail: "ana.torres@example.edu",
        course: "Sistemas de Informação",
        semester: 7,
        className: "SI-2024-N",
        volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
        department: { id: departmentId, name: "Tecnologia" },
        requestedRole: "member",
        role: null,
        accessEnabled: false,
        registrationStatus: "pending",
        mainFunction: null,
        joinedAt: null,
        submittedAt: expect.any(String),
        reviewedAt: null,
        reviewedById: null,
        reviewNote: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it("returns 404 MEMBER_REGISTRATION_NOT_FOUND for an unknown id, a malformed id and a person without member profile", async () => {
      // `member` is a Person but has no member profile.
      for (const id of [UNKNOWN_ID, "not-a-uuid", member.id]) {
        const res = await request(app.getHttpServer())
          .get(`/member-registrations/${id}`)
          .set("Cookie", coordinator.cookie)
          .expect(404);

        expect(res.body.error).toBe("MEMBER_REGISTRATION_NOT_FOUND");
        expect(res.body.message).toBe("Member registration not found.");
      }
    });

    it("returns 403 FORBIDDEN for a director and for a member", async () => {
      const id = await submitViaInvite(applicant(1));

      for (const actor of [director, member]) {
        const res = await request(app.getHttpServer())
          .get(`/member-registrations/${id}`)
          .set("Cookie", actor.cookie)
          .expect(403);
        expect(res.body.error).toBe("FORBIDDEN");
        // The CPF stays with coordination.
        expectNoPersonalData(res.body);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /member-registrations/:id/approve
  // ---------------------------------------------------------------------------

  describe("PATCH /member-registrations/:id/approve (approveMemberRegistration)", () => {
    it("approves with role, department, main function and joinedAt and grants access", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      const id = await submitViaInvite(applicant(1), "member");

      const res = await approve(
        id,
        approvalBody(departmentId, { role: "director", note: "Documentos conferidos." }),
      ).expect(200);

      expect(res.body).toMatchObject({
        id,
        role: "director",
        accessEnabled: true,
        registrationStatus: "approved",
        department: { id: departmentId, name: "Tecnologia" },
        mainFunction: MAIN_FUNCTION,
        joinedAt: JOINED_AT,
        reviewedById: coordinator.id,
        reviewNote: "Documentos conferidos.",
        reviewedAt: expect.any(String),
      });

      expect(await personRow(id)).toEqual({ role: "director", access_enabled: true });
      expect(await profileOf(id)).toMatchObject({
        registration_status: "approved",
        department_id: departmentId,
        main_function: MAIN_FUNCTION,
        joined_at: JOINED_AT,
        reviewed_by_id: coordinator.id,
        review_note: "Documentos conferidos.",
      });

      // The approved person is now an access like any other.
      const access = await request(app.getHttpServer())
        .get("/access?limit=100")
        .set("Cookie", coordinator.cookie)
        .expect(200);
      expect((access.body.data as Array<{ id: string }>).map((item) => item.id)).toContain(id);
    });

    it("approves a coordinator without department", async () => {
      const id = await submitViaInvite(applicant(1), "coordinator");

      const res = await approve(id, approvalBody(null, { role: "coordinator" })).expect(200);

      expect(res.body).toMatchObject({
        role: "coordinator",
        accessEnabled: true,
        department: null,
        registrationStatus: "approved",
      });
    });

    it("returns 400 VALIDATION_FAILED with field departmentId for a member without department", async () => {
      const id = await submitViaInvite(applicant(1));

      const res = await approve(id, approvalBody(null, { role: "member" })).expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(res.body)).toEqual(["departmentId"]);
      expect(await personRow(id)).toEqual({ role: null, access_enabled: false });
      expect(await profileOf(id)).toMatchObject({ registration_status: "pending" });
    });

    it("returns 400 INVALID_ROLE for superadmin", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      const id = await submitViaInvite(applicant(1));

      const res = await approve(id, approvalBody(departmentId, { role: "superadmin" })).expect(400);

      expect(res.body.error).toBe("INVALID_ROLE");
      expect(await personRow(id)).toEqual({ role: null, access_enabled: false });
    });

    it("returns 400 DEPARTMENT_NOT_FOUND for an unknown department", async () => {
      const id = await submitViaInvite(applicant(1));

      const res = await approve(id, approvalBody(UNKNOWN_ID)).expect(400);

      expect(res.body.error).toBe("DEPARTMENT_NOT_FOUND");
      expect(await personRow(id)).toEqual({ role: null, access_enabled: false });
      expect(await profileOf(id)).toMatchObject({ registration_status: "pending" });
    });

    it("returns 400 VALIDATION_FAILED for a future joinedAt and for joinedAt in dd/mm/yyyy", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      const id = await submitViaInvite(applicant(1));

      for (const joinedAt of ["2999-01-01", "01/03/2025"]) {
        const res = await approve(id, approvalBody(departmentId, { joinedAt })).expect(400);
        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["joinedAt"]);
      }
    });

    it("returns 404 MEMBER_REGISTRATION_NOT_FOUND for an unknown id and a person without member profile", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");

      for (const id of [UNKNOWN_ID, "not-a-uuid", member.id]) {
        const res = await approve(id, approvalBody(departmentId)).expect(404);
        expect(res.body.error).toBe("MEMBER_REGISTRATION_NOT_FOUND");
      }
    });

    it("returns 409 REGISTRATION_NOT_PENDING when approving twice", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      const id = await submitViaInvite(applicant(1));
      await approve(id, approvalBody(departmentId)).expect(200);

      const res = await approve(id, approvalBody(departmentId, { role: "director" })).expect(409);

      expect(res.body.error).toBe("REGISTRATION_NOT_PENDING");
      // The second request changed nothing.
      expect(await personRow(id)).toEqual({ role: "member", access_enabled: true });
    });

    it("returns 403 FORBIDDEN for a director", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      const id = await submitViaInvite(applicant(1));

      const res = await approve(id, approvalBody(departmentId), director).expect(403);
      expect(res.body.error).toBe("FORBIDDEN");
      // The guard runs before the ValidationPipe: 403 even with an invalid body.
      await approve(id, {}, director).expect(403);
      await approve(id, approvalBody(departmentId), member).expect(403);

      expect(await personRow(id)).toEqual({ role: null, access_enabled: false });
    });

    it("emits MEMBER_REGISTRATION_APPROVED without cpf, address, phone, e-mails or birth date", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      const id = await submitViaInvite(applicant(1));
      const events = collectEvents();

      await approve(id, approvalBody(departmentId, { note: "Documentos conferidos." })).expect(200);

      const approved = events.filter(
        (event) => event.action === AuditableAction.MEMBER_REGISTRATION_APPROVED,
      );
      expect(approved).toHaveLength(1);
      expect(approved[0]).toMatchObject({
        actorId: coordinator.id,
        targetType: "member",
        targetId: id,
        before: {
          registrationStatus: "pending",
          role: null,
          accessEnabled: false,
          departmentId: null,
        },
        after: {
          registrationStatus: "approved",
          role: "member",
          accessEnabled: true,
          departmentId,
          mainFunction: MAIN_FUNCTION,
          joinedAt: JOINED_AT,
          reviewNote: "Documentos conferidos.",
        },
      });
      expectNoSensitiveValue(approved[0]);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /member-registrations/:id/reject
  // ---------------------------------------------------------------------------

  describe("PATCH /member-registrations/:id/reject (rejectMemberRegistration)", () => {
    it("rejects with a note and keeps the access closed", async () => {
      const id = await submitViaInvite(applicant(1));

      const res = await reject(id, { note: "O RA informado não confere." }).expect(200);

      expect(res.body).toMatchObject({
        id,
        registrationStatus: "rejected",
        role: null,
        accessEnabled: false,
        reviewNote: "O RA informado não confere.",
        reviewedById: coordinator.id,
        reviewedAt: expect.any(String),
      });
      expect(await personRow(id)).toEqual({ role: null, access_enabled: false });
      expect(await profileOf(id)).toMatchObject({
        registration_status: "rejected",
        review_note: "O RA informado não confere.",
        reviewed_by_id: coordinator.id,
      });
    });

    it("returns 400 VALIDATION_FAILED with field note when the note is missing or blank", async () => {
      const id = await submitViaInvite(applicant(1));

      for (const body of [{}, { note: "" }, { note: "   " }]) {
        const res = await reject(id, body).expect(400);
        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["note"]);
      }
      expect(await profileOf(id)).toMatchObject({ registration_status: "pending" });
    });

    it("returns 409 REGISTRATION_NOT_PENDING for an approved registration", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      const id = await submitViaInvite(applicant(1));
      await approve(id, approvalBody(departmentId)).expect(200);

      const res = await reject(id, { note: "Tarde demais." }).expect(409);

      expect(res.body.error).toBe("REGISTRATION_NOT_PENDING");
      expect(await personRow(id)).toEqual({ role: "member", access_enabled: true });
    });

    it("returns 404 MEMBER_REGISTRATION_NOT_FOUND for an unknown id and a person without member profile", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid", member.id]) {
        const res = await reject(id, { note: "Não existe." }).expect(404);
        expect(res.body.error).toBe("MEMBER_REGISTRATION_NOT_FOUND");
      }
    });

    it("returns 403 FORBIDDEN for a member", async () => {
      const id = await submitViaInvite(applicant(1));

      const res = await reject(id, { note: "Sem permissão." }, member).expect(403);
      expect(res.body.error).toBe("FORBIDDEN");
      await reject(id, { note: "Sem permissão." }, director).expect(403);

      expect(await profileOf(id)).toMatchObject({ registration_status: "pending" });
    });

    it("emits MEMBER_REGISTRATION_REJECTED with the note and without personal data", async () => {
      const id = await submitViaInvite(applicant(1));
      const events = collectEvents();

      await reject(id, { note: "O RA informado não confere." }).expect(200);

      const rejected = events.filter(
        (event) => event.action === AuditableAction.MEMBER_REGISTRATION_REJECTED,
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        actorId: coordinator.id,
        targetType: "member",
        targetId: id,
        before: { registrationStatus: "pending" },
        after: { registrationStatus: "rejected", reviewNote: "O RA informado não confere." },
      });
      expectNoSensitiveValue(rejected[0]);
    });
  });

  // ---------------------------------------------------------------------------
  // The access stays closed while the registration is not approved
  // ---------------------------------------------------------------------------

  describe("access stays closed while pending", () => {
    it("PATCH /access/:id/enabled and /role answer 404 for a pending registration", async () => {
      const id = await submitViaInvite(applicant(1));

      // The shortcut that would grant access without the approval is closed.
      const enabled = await request(app.getHttpServer())
        .patch(`/access/${id}/enabled`)
        .set("Cookie", coordinator.cookie)
        .send({ enabled: true })
        .expect(404);
      expect(enabled.body.error).toBe("NOT_FOUND");

      const role = await request(app.getHttpServer())
        .patch(`/access/${id}/role`)
        .set("Cookie", coordinator.cookie)
        .send({ role: "member" })
        .expect(404);
      expect(role.body.error).toBe("NOT_FOUND");

      expect(await personRow(id)).toEqual({ role: null, access_enabled: false });
    });

    it("GET /access does not list pending or rejected registrations", async () => {
      const pending = await submitViaInvite(applicant(1));
      const rejected = await submitViaInvite(applicant(2));
      await reject(rejected, { note: "Recusado." }).expect(200);

      const res = await request(app.getHttpServer())
        .get("/access?limit=100")
        .set("Cookie", coordinator.cookie)
        .expect(200);

      const ids = (res.body.data as Array<{ id: string }>).map((item) => item.id);
      expect(ids).toEqual(expect.arrayContaining([coordinator.id, director.id, member.id]));
      expect(ids).not.toContain(pending);
      expect(ids).not.toContain(rejected);
    });
  });
});
