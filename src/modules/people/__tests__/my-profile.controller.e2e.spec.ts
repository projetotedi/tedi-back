/**
 * E2e spec for MyProfileController — GUS-122 ("Meu perfil": GET /members/me).
 *
 * Card cases:
 *  1. the seeded admin (no member profile) → 200 with the member fields null
 *  2. two logins in a row → the second one gets the date/time of the first as lastLoginAt
 *  3. CPF: the response carries only cpfMasked
 *
 * The admin comes from the real seed (seedInitialCoordinator) and the members from the real
 * flow (POST /invites → POST /auth/invites/accept → PATCH /member-registrations/:id/approve),
 * and every session comes from POST /auth/login, so these tests also prove what the front gets
 * and that the login records the last access.
 *
 * One RA per test: POST /auth/login is limited to 10 attempts per RA and IP, and the counter
 * lives as long as the app of this file (the tables are truncated, the counter is not).
 */
import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import cookieParser from "cookie-parser";
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
import { buildRegistration, insertDepartment } from "./fixtures/member-registration.fixture";

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

process.env.JWT_SECRET = "e2e-my-profile-secret";
process.env.APP_URL = "http://localhost:5173";

// Name of the session cookie set by the auth module (kept local: tests do not import module internals).
const SESSION_COOKIE_NAME = "tedi_session";

const PASSWORD = "Senha@123";
const ADMIN_NAME = "Admin Seed";
const ADMIN_PASSWORD = "SeedPass@123";
// A fixed past date: the join date cannot be in the future.
const JOINED_AT = "2025-03-01";
const MAIN_FUNCTION = "Monitora de informática";

interface Actor {
  id: string;
  cookie: string;
}

interface LoginTimestamps {
  last_login_at: Date | null;
  previous_login_at: Date | null;
}

/** Overrides of buildRegistration with a name, an RA and an e-mail that are unique per applicant. */
function applicant(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Aluno ${n}`,
    ra: `p221000${n}`,
    personalEmail: `aluno${n}@example.com`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("MyProfileController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;

  let coordinator: Actor;

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

    coordinator = await createActor("Coordinator", Role.COORDINATOR);
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

  /** The real seed of the first coordinator (superadmin), with its own RA. */
  async function seedAdmin(ra: string): Promise<void> {
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
  }

  /**
   * Registers a member through the real flow: coordination creates an invite, the applicant
   * accepts it with the registration form and coordination approves it. Returns the Person id.
   * Without `approve` the registration stays pending (the person cannot log in).
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

    const rows = (await dataSource.query("SELECT id FROM people WHERE ra = $1", [
      String(form.ra).toLowerCase(),
    ])) as Array<{ id: string }>;
    const personId = rows[0].id;

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

  function login(ra: string, password = PASSWORD) {
    return request(app.getHttpServer()).post("/auth/login").send({ ra, password });
  }

  /** The `tedi_session=<token>` pair from the Set-Cookie of a login response. */
  function sessionOf(res: request.Response): string {
    const setCookie = res.headers["set-cookie"] as string[] | string;
    return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
  }

  function getMyProfile(cookie?: string) {
    const req = request(app.getHttpServer()).get("/members/me");
    return cookie === undefined ? req : req.set("Cookie", cookie);
  }

  async function loginTimestamps(ra: string): Promise<LoginTimestamps> {
    const rows = (await dataSource.query(
      "SELECT last_login_at, previous_login_at FROM people WHERE ra = $1",
      [ra],
    )) as LoginTimestamps[];
    return rows[0];
  }

  // ---------------------------------------------------------------------------
  // Card e2e cases
  // ---------------------------------------------------------------------------

  describe("card e2e cases", () => {
    it("returns 200 with member fields null for the seeded initial coordinator", async () => {
      await seedAdmin("seed-me-001");
      const session = sessionOf(await login("seed-me-001", ADMIN_PASSWORD).expect(200));

      const res = await getMyProfile(session).expect(200);

      // toStrictEqual: every key is there, with null, and nothing else.
      expect(res.body).toStrictEqual({
        name: ADMIN_NAME,
        ra: "seed-me-001",
        role: "superadmin",
        accessEnabled: true,
        birthDate: null,
        phone: null,
        email: "seed-me-001@example.com",
        personalEmail: null,
        address: null,
        city: null,
        state: null,
        institutionalEmail: null,
        course: null,
        semester: null,
        className: null,
        volunteerTermUrl: null,
        mainFunction: null,
        department: null,
        joinedAt: null,
        cpfMasked: null,
        lastLoginAt: null,
      });
    });

    it("returns as lastLoginAt the previous login after two logins in a row", async () => {
      await registerMember(applicant(1, { ra: "p2210001" }), {
        departmentId: null,
        role: "coordinator",
      });

      await login("p2210001").expect(200);
      const first = await loginTimestamps("p2210001");
      const secondSession = sessionOf(await login("p2210001").expect(200));
      const afterSecond = await loginTimestamps("p2210001");

      const res = await getMyProfile(secondSession).expect(200);

      // The date/time of the FIRST login, not of the one that opened this session.
      expect(first.last_login_at).toBeInstanceOf(Date);
      expect(res.body.lastLoginAt).toBe((first.last_login_at as Date).toISOString());
      expect(afterSecond.previous_login_at).toEqual(first.last_login_at);
      expect(res.body.lastLoginAt).not.toBe((afterSecond.last_login_at as Date).toISOString());

      // And it keeps rolling: after a third login the second one is the "last access".
      const thirdSession = sessionOf(await login("p2210001").expect(200));
      const third = await getMyProfile(thirdSession).expect(200);
      expect(third.body.lastLoginAt).toBe((afterSecond.last_login_at as Date).toISOString());
    });

    it("returns only cpfMasked, never the full CPF", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      await registerMember(applicant(1, { ra: "p2210002", departmentId }), { departmentId });
      const session = sessionOf(await login("p2210002").expect(200));

      const res = await getMyProfile(session).expect(200);

      expect(res.body.cpfMasked).toBe("***.***.247-25");
      expect(res.body).not.toHaveProperty("cpf");
      // The full CPF is nowhere in the body, formatted or not (the registration was 529.982.247-25).
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain("52998224725");
      expect(raw).not.toContain("529.982.247");
      expect(raw).not.toContain("529982");
    });
  });

  // ---------------------------------------------------------------------------
  // GET /members/me
  // ---------------------------------------------------------------------------

  describe("GET /members/me (getMyProfile)", () => {
    it("returns the whole profile of an approved member, with the department", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      await registerMember(applicant(1, { name: "Ana Torres", ra: "p2210003", departmentId }), {
        departmentId,
        role: "director",
      });
      const session = sessionOf(await login("p2210003").expect(200));

      const res = await getMyProfile(session).expect(200);

      expect(res.body).toStrictEqual({
        name: "Ana Torres",
        ra: "p2210003",
        role: "director",
        accessEnabled: true,
        birthDate: "1999-07-22",
        phone: "11981813030",
        email: "aluno1@example.com",
        personalEmail: "aluno1@example.com",
        address: "Rua das Acácias, 120, apto 42",
        city: "São Paulo",
        state: "SP",
        institutionalEmail: "ana.torres@example.edu",
        course: "Sistemas de Informação",
        semester: 7,
        className: "SI-2024-N",
        volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
        mainFunction: MAIN_FUNCTION,
        department: { id: departmentId, name: "Tecnologia" },
        joinedAt: JOINED_AT,
        cpfMasked: "***.***.247-25",
        // First login of this person: there is no login before the current one.
        lastLoginAt: null,
      });
    });

    it("returns lastLoginAt null on the first login, even though the login was recorded", async () => {
      await registerMember(applicant(1, { ra: "p2210004" }), { role: "coordinator" });
      const session = sessionOf(await login("p2210004").expect(200));

      const res = await getMyProfile(session).expect(200);

      expect(res.body.lastLoginAt).toBeNull();
      const timestamps = await loginTimestamps("p2210004");
      expect(timestamps.last_login_at).toBeInstanceOf(Date);
      expect(timestamps.previous_login_at).toBeNull();
    });

    it("returns the profile of the logged-in person and ignores a person id in the query", async () => {
      const departmentId = await insertDepartment(dataSource, "Tecnologia");
      await registerMember(applicant(1, { name: "Ana Torres", ra: "p2210005", departmentId }), {
        departmentId,
      });
      const bruno = await registerMember(
        applicant(2, {
          name: "Bruno Lima",
          ra: "p2210006",
          cpf: "111.444.777-35",
          course: "Engenharia",
        }),
        { departmentId },
      );
      const session = sessionOf(await login("p2210005").expect(200));

      const res = await request(app.getHttpServer())
        .get("/members/me")
        .query({ personId: bruno, id: bruno, ra: "p2210006" })
        .set("Cookie", session)
        .expect(200);

      expect(res.body).toMatchObject({
        name: "Ana Torres",
        ra: "p2210005",
        cpfMasked: "***.***.247-25",
        course: "Sistemas de Informação",
      });
      const raw = JSON.stringify(res.body);
      for (const other of ["Bruno Lima", "p2210006", bruno, "***.***.777-35", "Engenharia"]) {
        expect(raw).not.toContain(other);
      }
    });

    it("answers 200 for a member, a director, a coordinator and the superadmin without member profile", async () => {
      for (const role of [Role.MEMBER, Role.DIRECTOR, Role.COORDINATOR, Role.SUPERADMIN]) {
        const actor = await createActor(`Person ${role}`, role);

        const res = await getMyProfile(actor.cookie).expect(200);

        expect(res.body).toMatchObject({
          name: `Person ${role}`,
          role,
          accessEnabled: true,
          personalEmail: null,
          department: null,
          cpfMasked: null,
          lastLoginAt: null,
        });
      }
    });

    it("returns 401 UNAUTHORIZED without the session cookie", async () => {
      const res = await getMyProfile().expect(401);

      expect(res.body.error).toBe("UNAUTHORIZED");
      expect(res.body.statusCode).toBe(401);
    });

    it("returns 401 UNAUTHORIZED for a cookie that is not a valid session", async () => {
      const res = await getMyProfile(`${SESSION_COOKIE_NAME}=not-a-valid-token`).expect(401);

      expect(res.body.error).toBe("UNAUTHORIZED");
    });

    it("returns 401 UNAUTHORIZED, and no data, once the access of the person was disabled", async () => {
      const actor = await createActor("Revoked Person", Role.MEMBER);
      await getMyProfile(actor.cookie).expect(200);
      await dataSource.query("UPDATE people SET access_enabled = false WHERE id = $1", [actor.id]);

      const res = await getMyProfile(actor.cookie).expect(401);

      expect(res.body.error).toBe("UNAUTHORIZED");
      expect(JSON.stringify(res.body)).not.toContain("Revoked Person");
    });
  });

  // ---------------------------------------------------------------------------
  // POST /auth/login: when the last access is recorded
  // ---------------------------------------------------------------------------

  describe("last access recorded by POST /auth/login", () => {
    it("does not move the login timestamps on a failed login", async () => {
      await registerMember(applicant(1, { ra: "p2210007" }), { role: "coordinator" });
      await login("p2210007").expect(200);
      const afterLogin = await loginTimestamps("p2210007");

      const wrong = await login("p2210007", "Errada@123").expect(401);

      expect(wrong.body.error).toBe("INVALID_CREDENTIALS");
      expect(await loginTimestamps("p2210007")).toEqual(afterLogin);
    });

    it("does not record a login for a registration that is still pending", async () => {
      await registerMember(applicant(1, { ra: "p2210008" }), { approve: false });

      const pending = await login("p2210008").expect(401);

      expect(pending.body.error).toBe("REGISTRATION_PENDING");
      expect(await loginTimestamps("p2210008")).toEqual({
        last_login_at: null,
        previous_login_at: null,
      });
    });

    it("does not record a login for a person whose access was disabled", async () => {
      await registerMember(applicant(1, { ra: "p2210009" }), { role: "coordinator" });
      await dataSource.query("UPDATE people SET access_enabled = false WHERE ra = $1", [
        "p2210009",
      ]);

      const disabled = await login("p2210009").expect(401);

      expect(disabled.body.error).toBe("ACCESS_DISABLED");
      expect(await loginTimestamps("p2210009")).toEqual({
        last_login_at: null,
        previous_login_at: null,
      });
    });

    it("does not record anything when the session is only used (GET /auth/me and GET /members/me)", async () => {
      await registerMember(applicant(1, { ra: "p2210010" }), { role: "coordinator" });
      const session = sessionOf(await login("p2210010").expect(200));
      const afterLogin = await loginTimestamps("p2210010");

      await request(app.getHttpServer()).get("/auth/me").set("Cookie", session).expect(200);
      await getMyProfile(session).expect(200);
      await getMyProfile(session).expect(200);

      // The last access is the last LOGIN, not the last request.
      expect(await loginTimestamps("p2210010")).toEqual(afterLogin);
    });
  });
});
