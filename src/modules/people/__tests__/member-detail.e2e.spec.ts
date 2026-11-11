/**
 * E2e spec for GET /members/:id (getMember) — GUS-144 (member record).
 *
 * CA1: coordination reads any member; a director only one of the own department (403 elsewhere);
 *      a member gets 403
 * CA2: the answer carries the department and who approved the registration
 * CA3: 404 MEMBER_NOT_FOUND for an id that does not exist or a person that is no member (the
 *      seeded admin is the exception: it answers with the member fields null)
 *
 * The admin comes from the real seed (seedInitialCoordinator) and the members from the real flow
 * (POST /invites → POST /auth/invites/accept → PATCH /member-registrations/:id/approve), so
 * `reviewedBy` is the coordinator who approved and the profile is what the sign-up form wrote.
 * Sessions are cookies signed with the JwtService (no login), so the login throttler is not
 * involved.
 */
import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import request from "supertest";
import { DataSource } from "typeorm";
import { seedInitialCoordinator } from "@database/seeds/initial-coordinator.seed";
import { AuthModule } from "@modules/auth/auth.module";
import { Role } from "@shared/enums/role.enum";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { PeopleModule } from "../people.module";
import { PeopleService } from "../services/people.service";
import {
  buildRegistration,
  insertDepartment,
  insertMemberProfile,
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

process.env.JWT_SECRET = "e2e-member-detail-secret";
process.env.APP_URL = "http://localhost:5173";

// seedAdmin writes the ADMIN_* variables that the seed reads. Their values as this file found
// them (undefined = not defined) are given back after every test, so nothing outlives the test.
const ADMIN_ENV_KEYS = ["ADMIN_RA", "ADMIN_NAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"] as const;
const originalAdminEnv = ADMIN_ENV_KEYS.map((key) => [key, process.env[key]] as const);

// Name of the session cookie set by the auth module (kept local: tests do not import module internals).
const SESSION_COOKIE_NAME = "tedi_session";

const PASSWORD = "Senha@123";
const ADMIN_NAME = "Admin Seed";
const ADMIN_PASSWORD = "SeedPass@123";
// A fixed past date: the join date cannot be in the future.
const JOINED_AT = "2025-03-01";
const MAIN_FUNCTION = "Monitora de informática";

const FORBIDDEN_SCOPE_BODY = {
  statusCode: 403,
  error: "FORBIDDEN_SCOPE",
  message: "You do not have access to this resource.",
};
const MEMBER_NOT_FOUND_BODY = {
  statusCode: 404,
  error: "MEMBER_NOT_FOUND",
  message: "Member not found.",
};

// Both CPFs registered below, in every way they could show up in an answer.
const FULL_CPFS = [
  "52998224725",
  "529.982.247-25",
  "529.982.247",
  "11144477735",
  "111.444.777-35",
  "111.444.777",
];

interface Actor {
  id: string;
  cookie: string;
}

/** Overrides of buildRegistration with a name, an RA and an e-mail that are unique per applicant. */
function applicant(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Aluno ${n}`,
    ra: `p22101${n}`,
    personalEmail: `aluno${n}@example.com`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GET /members/:id (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;

  let coordinator: Actor;
  let directorTech: Actor;
  let member: Actor;
  let tech: string;
  let comms: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // No EventEmitterModule.forRoot() here: AuthModule already registers the global one.
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
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    // CASCADE from people also truncates member_profiles and student_profiles.
    await dataSource.query("TRUNCATE TABLE invites, departments, people RESTART IDENTITY CASCADE");

    tech = await insertDepartment(dataSource, "Tecnologia");
    comms = await insertDepartment(dataSource, "Comunicação");

    // Coordination has no member profile (like the coordinators of the backfill) and approves
    // the members registered below, so it is their `reviewedBy`.
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    // A director has the scope of the department of her APPROVED member profile.
    directorTech = await createActor("Director Tech", Role.DIRECTOR);
    await insertMemberProfile(dataSource, {
      personId: directorTech.id,
      status: "approved",
      departmentId: tech,
    });
    member = await createActor("Member", Role.MEMBER);
  });

  afterEach(() => {
    // A variable that was not defined goes back to not defined: assigning undefined to
    // process.env would store the string "undefined".
    for (const [key, value] of originalAdminEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** A Person with a role and no member profile, with a session cookie signed without a login. */
  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /**
   * The real seed of the first coordinator (superadmin), with its own RA. It overwrites the
   * ADMIN_* variables for the test; the afterEach hook above gives them back. Returns the id.
   */
  async function seedAdmin(ra: string): Promise<string> {
    process.env.ADMIN_RA = ra;
    process.env.ADMIN_NAME = ADMIN_NAME;
    process.env.ADMIN_EMAIL = `${ra}@example.com`;
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;

    // The seed logs a line per run; keep the output of the suite clean.
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await seedInitialCoordinator(dataSource);
    } finally {
      log.mockRestore();
    }
    return personIdOf(ra);
  }

  async function personIdOf(ra: string): Promise<string> {
    const rows = (await dataSource.query("SELECT id FROM people WHERE ra = $1", [ra])) as Array<{
      id: string;
    }>;
    return rows[0].id;
  }

  /**
   * Registers a member through the real flow: coordination creates an invite, the applicant
   * accepts it with the registration form and coordination approves it. Returns the Person id.
   * Without `approve` the registration stays pending. The department suggested in the form is
   * `registration.departmentId`; the one decided on approval is `options.departmentId`.
   */
  async function registerMember(
    registration: Record<string, unknown>,
    options: { departmentId?: string | null; role?: string; approve?: boolean } = {},
  ): Promise<string> {
    const { departmentId = null, role = "member", approve = true } = options;

    const created = await request(app.getHttpServer())
      .post("/invites")
      .set("Cookie", coordinator.cookie)
      .send({ role })
      .expect(201);
    const token = new URL(created.body.url as string).searchParams.get("token") ?? "";

    const form = buildRegistration(registration);
    await request(app.getHttpServer())
      .post("/auth/invites/accept")
      .send({ token, password: PASSWORD, registration: form })
      .expect(204);

    const personId = await personIdOf(String(form.ra).toLowerCase());

    if (approve) {
      await request(app.getHttpServer())
        .patch(`/member-registrations/${personId}/approve`)
        .set("Cookie", coordinator.cookie)
        .send({
          role,
          ...(departmentId === null ? {} : { departmentId }),
          mainFunction: MAIN_FUNCTION,
          joinedAt: JOINED_AT,
        })
        .expect(200);
    }
    return personId;
  }

  function getMember(id: string, actor?: Actor) {
    const req = request(app.getHttpServer()).get(`/members/${id}`);
    return actor === undefined ? req : req.set("Cookie", actor.cookie);
  }

  /** No CPF key and no digit of any registered CPF, formatted or not: only cpfMasked (RNF-14). */
  function expectNoFullCpf(body: unknown): void {
    expect(body).not.toHaveProperty("cpf");
    const raw = JSON.stringify(body);
    for (const cpf of FULL_CPFS) {
      expect(raw).not.toContain(cpf);
    }
  }

  // ---------------------------------------------------------------------------
  // GET /members/:id
  // ---------------------------------------------------------------------------

  describe("GET /members/:id (getMember)", () => {
    it("coordinator reads a member of any department (200)", async () => {
      const personId = await registerMember(
        applicant(1, { name: "Ana Torres", ra: "p2210101", departmentId: comms }),
        { departmentId: comms },
      );
      const rows = (await dataSource.query(
        "SELECT reviewed_at FROM member_profiles WHERE person_id = $1",
        [personId],
      )) as Array<{ reviewed_at: Date }>;
      const reviewedAt = rows[0].reviewed_at;

      const res = await getMember(personId, coordinator).expect(200);

      // toStrictEqual: every key is there, and nothing else (no cpf, no allocations or hours).
      expect(res.body).toStrictEqual({
        id: personId,
        name: "Ana Torres",
        ra: "p2210101",
        email: "aluno1@example.com",
        phone: "11981813030",
        birthDate: "1999-07-22",
        role: "member",
        accessEnabled: true,
        cpfMasked: "***.***.247-25",
        address: "Rua das Acácias, 120, apto 42",
        city: "São Paulo",
        state: "SP",
        institutionalEmail: "ana.torres@example.edu",
        course: "Sistemas de Informação",
        semester: 7,
        className: "SI-2024-N",
        department: { id: comms, name: "Comunicação" },
        mainFunction: MAIN_FUNCTION,
        joinedAt: JOINED_AT,
        volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
        registrationStatus: "approved",
        // The instant of the approval, as an ISO string, and who approved.
        reviewedAt: reviewedAt.toISOString(),
        reviewedBy: { id: coordinator.id, name: "Coordinator" },
      });
      expectNoFullCpf(res.body);
    });

    it("director reads a member of the own department (200)", async () => {
      const personId = await registerMember(
        applicant(2, {
          name: "Bruno Lima",
          ra: "p2210102",
          cpf: "111.444.777-35",
          departmentId: tech,
        }),
        { departmentId: tech },
      );

      const res = await getMember(personId, directorTech).expect(200);

      expect(res.body).toMatchObject({
        id: personId,
        name: "Bruno Lima",
        role: "member",
        cpfMasked: "***.***.777-35",
        department: { id: tech, name: "Tecnologia" },
        registrationStatus: "approved",
        reviewedBy: { id: coordinator.id, name: "Coordinator" },
      });
      expectNoFullCpf(res.body);
    });

    it("director gets 403 FORBIDDEN_SCOPE for a member of another department", async () => {
      const personId = await registerMember(
        applicant(1, { name: "Ana Torres", ra: "p2210101", departmentId: comms }),
        { departmentId: comms },
      );

      const res = await getMember(personId, directorTech).expect(403);

      expect(res.body).toStrictEqual(FORBIDDEN_SCOPE_BODY);
      // Nothing of the member leaks through the error.
      expect(JSON.stringify(res.body)).not.toContain("Ana Torres");
      expect(JSON.stringify(res.body)).not.toContain("p2210101");
    });

    it("member gets 403 FORBIDDEN, also with a malformed id", async () => {
      const personId = await registerMember(applicant(1, { ra: "p2210101", departmentId: tech }), {
        departmentId: tech,
      });

      // Even the own record: members.view is "none" for a member (the own data is GET /members/me).
      for (const id of [personId, member.id, "not-a-uuid", randomUUID()]) {
        const res = await getMember(id, member).expect(403);

        expect(res.body.statusCode).toBe(403);
        expect(res.body.error).toBe("FORBIDDEN");
      }
    });

    it("404 MEMBER_NOT_FOUND for unknown uuid, malformed id, person without role nor profile, soft-deleted person", async () => {
      // An id that does not exist.
      const unknown = await getMember(randomUUID(), coordinator).expect(404);
      expect(unknown.body).toStrictEqual(MEMBER_NOT_FOUND_BODY);

      // A malformed id: the same 404 (without the pipe, Postgres would answer 500).
      const malformed = await getMember("not-a-uuid", coordinator).expect(404);
      expect(malformed.body).toStrictEqual(MEMBER_NOT_FOUND_BODY);

      // A person that is not a member: no access role and no member profile (a student).
      const student = await peopleService.save({
        name: "Aluno",
        role: null,
        accessEnabled: false,
      });
      const notAMember = await getMember(student.id, coordinator).expect(404);
      expect(notAMember.body).toStrictEqual(MEMBER_NOT_FOUND_BODY);

      // A person that was deleted.
      const deletedId = await registerMember(applicant(3, { ra: "p2210103", departmentId: tech }), {
        departmentId: tech,
      });
      await getMember(deletedId, coordinator).expect(200);
      await dataSource.query("UPDATE people SET deleted_at = now() WHERE id = $1", [deletedId]);
      const deleted = await getMember(deletedId, coordinator).expect(404);
      expect(deleted.body).toStrictEqual(MEMBER_NOT_FOUND_BODY);
    });

    it("answers 404 before 403: a director asking for an unknown id gets 404", async () => {
      const res = await getMember(randomUUID(), directorTech).expect(404);

      expect(res.body).toStrictEqual(MEMBER_NOT_FOUND_BODY);
    });

    it("coordinator reads the seeded admin: member fields null, registrationStatus null, role superadmin", async () => {
      const adminId = await seedAdmin("seed-md-001");

      const res = await getMember(adminId, coordinator).expect(200);

      expect(res.body).toStrictEqual({
        id: adminId,
        name: ADMIN_NAME,
        ra: "seed-md-001",
        email: "seed-md-001@example.com",
        phone: null,
        birthDate: null,
        role: "superadmin",
        accessEnabled: true,
        cpfMasked: null,
        address: null,
        city: null,
        state: null,
        institutionalEmail: null,
        course: null,
        semester: null,
        className: null,
        department: null,
        mainFunction: null,
        joinedAt: null,
        volunteerTermUrl: null,
        registrationStatus: null,
        reviewedAt: null,
        reviewedBy: null,
      });

      // Without a member profile there is no department either: a director is out of scope.
      const denied = await getMember(adminId, directorTech).expect(403);
      expect(denied.body).toStrictEqual(FORBIDDEN_SCOPE_BODY);
    });

    it("coordinator reads another coordinator that has no member profile (200, member fields null)", async () => {
      const other = await createActor("Other Coordinator", Role.COORDINATOR);

      const res = await getMember(other.id, coordinator).expect(200);

      expect(res.body).toMatchObject({
        id: other.id,
        name: "Other Coordinator",
        role: "coordinator",
        accessEnabled: true,
        registrationStatus: null,
        department: null,
        cpfMasked: null,
        reviewedAt: null,
        reviewedBy: null,
      });
    });

    it("coordinator reads a pending registration; director of the suggested department gets 403", async () => {
      const personId = await registerMember(
        applicant(4, { name: "Carla Pending", ra: "p2210104", departmentId: tech }),
        { approve: false },
      );

      const res = await getMember(personId, coordinator).expect(200);

      // Not approved yet: no role, no access, no function, no reviewer. The department shown is
      // the one suggested at sign-up.
      expect(res.body).toMatchObject({
        id: personId,
        name: "Carla Pending",
        role: null,
        accessEnabled: false,
        registrationStatus: "pending",
        department: { id: tech, name: "Tecnologia" },
        mainFunction: null,
        joinedAt: null,
        cpfMasked: "***.***.247-25",
        reviewedAt: null,
        reviewedBy: null,
      });
      expectNoFullCpf(res.body);

      // The suggested department never gives scope: the director of that department is denied.
      const denied = await getMember(personId, directorTech).expect(403);
      expect(denied.body).toStrictEqual(FORBIDDEN_SCOPE_BODY);
    });

    it("coordinator reads a rejected registration with who rejected it, and no review note", async () => {
      const personId = await registerMember(
        applicant(5, { name: "Davi Rejected", ra: "p2210105", departmentId: tech }),
        { approve: false },
      );
      const note = "Termo de voluntariado ilegível.";
      await request(app.getHttpServer())
        .patch(`/member-registrations/${personId}/reject`)
        .set("Cookie", coordinator.cookie)
        .send({ note })
        .expect(200);

      const res = await getMember(personId, coordinator).expect(200);

      expect(res.body).toMatchObject({
        id: personId,
        role: null,
        accessEnabled: false,
        registrationStatus: "rejected",
        reviewedBy: { id: coordinator.id, name: "Coordinator" },
      });
      expect(typeof res.body.reviewedAt).toBe("string");
      // The note of the validation is not part of the record.
      expect(res.body).not.toHaveProperty("reviewNote");
      expect(JSON.stringify(res.body)).not.toContain(note);

      const denied = await getMember(personId, directorTech).expect(403);
      expect(denied.body).toStrictEqual(FORBIDDEN_SCOPE_BODY);
    });

    it("returns reviewedBy null when the person who approved was deleted", async () => {
      const personId = await registerMember(applicant(6, { ra: "p2210106", departmentId: tech }), {
        departmentId: tech,
      });
      const reviewer = await createActor("Reviewer", Role.COORDINATOR);
      await dataSource.query(
        "UPDATE member_profiles SET reviewed_by_id = $1 WHERE person_id = $2",
        [reviewer.id, personId],
      );
      await dataSource.query("UPDATE people SET deleted_at = now() WHERE id = $1", [reviewer.id]);

      const res = await getMember(personId, coordinator).expect(200);

      expect(res.body.reviewedBy).toBeNull();
      expect(typeof res.body.reviewedAt).toBe("string");
    });

    it("requires authentication (401)", async () => {
      const personId = await registerMember(applicant(1, { ra: "p2210101", departmentId: tech }), {
        departmentId: tech,
      });

      const res = await getMember(personId).expect(401);

      expect(res.body.statusCode).toBe(401);
      expect(res.body.error).toBe("UNAUTHORIZED");
      expect(JSON.stringify(res.body)).not.toContain("Aluno 1");
    });

    it("GET /members/me still answers the own profile (route order)", async () => {
      // If `:id` were registered before `me`, the pipe would take "me" for an id: a member would
      // get 403 and a coordinator 404.
      const asMember = await request(app.getHttpServer())
        .get("/members/me")
        .set("Cookie", member.cookie)
        .expect(200);
      expect(asMember.body).toMatchObject({ name: "Member", role: "member" });

      const asCoordinator = await request(app.getHttpServer())
        .get("/members/me")
        .set("Cookie", coordinator.cookie)
        .expect(200);
      expect(asCoordinator.body).toMatchObject({ name: "Coordinator", role: "coordinator" });
    });
  });
});
