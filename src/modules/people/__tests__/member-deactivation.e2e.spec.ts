/**
 * E2e spec for PATCH /members/:id/deactivate (deactivateMember) and PATCH /members/:id/reactivate
 * (reactivateMember), and the participation in GET /members and GET /members/:id — GUS-147.
 *
 * CA1: deactivating stores exit date, reason and note and disables the access in the same
 *      operation (the next request of the member answers 401)
 * CA2: only coordination (and superadmin) deactivates; director and member get 403
 * CA3: reactivating makes the member active again without enabling the login
 *
 * The members come from the real flow (POST /invites → POST /auth/invites/accept →
 * PATCH /member-registrations/:id/approve). Sessions are cookies signed with the JwtService (no
 * login), so the login throttler is not involved. No seedAdmin: it writes the ADMIN_* variables,
 * which would leak into the other files of the serial e2e run.
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
import { AuthModule } from "@modules/auth/auth.module";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
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

process.env.JWT_SECRET = "e2e-member-deactivation-secret";
process.env.APP_URL = "http://localhost:5173";

const SESSION_COOKIE_NAME = "tedi_session";

const PASSWORD = "Senha@123";
const MAIN_FUNCTION = "Monitora de informática";
const JOINED_AT = "2025-03-01";
const EXIT_DATE = "2025-12-15";
const EXIT = {
  exitDate: EXIT_DATE,
  reason: "Formou-se.",
  note: "Vai fazer mestrado em outra cidade.",
};

const MEMBER_NOT_FOUND_BODY = {
  statusCode: 404,
  error: "MEMBER_NOT_FOUND",
  message: "Member not found.",
};
const OWN_ACCOUNT_BODY = {
  statusCode: 403,
  error: "OWN_ACCOUNT",
  message: "Cannot act on your own account.",
};

interface Actor {
  id: string;
  cookie: string;
}

interface ExitRow {
  status: string;
  exit_date: string | null;
  exit_reason: string | null;
  exit_note: string | null;
  deactivated_at: Date | null;
  deactivated_by_id: string | null;
}

/** Overrides of buildRegistration with a name, an RA and an e-mail that are unique per applicant. */
function applicant(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Aluno ${n}`,
    ra: `d22101${n}`,
    personalEmail: `aluno${n}@example.com`,
    ...overrides,
  };
}

/** Next calendar day of a "YYYY-MM-DD" date, computed on the string (no local time zone). */
function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe("PATCH /members/:id/deactivate and /reactivate (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;

  let coordinator: Actor;
  let superadmin: Actor;
  let director: Actor;
  let member: Actor;
  let tech: string;

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

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    jwtService = module.get(JwtService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query("TRUNCATE TABLE invites, departments, people RESTART IDENTITY CASCADE");

    tech = await insertDepartment(dataSource, "Tecnologia");

    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    superadmin = await createActor("Superadmin", Role.SUPERADMIN);
    director = await createActor("Director Tech", Role.DIRECTOR);
    await insertMemberProfile(dataSource, {
      personId: director.id,
      status: "approved",
      departmentId: tech,
    });
    member = await createActor("Member", Role.MEMBER);
  });

  /** A session cookie for a person, signed without a login. */
  async function cookieOf(personId: string): Promise<string> {
    const token = await jwtService.signAsync({ sub: personId });
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  /** A Person with a role and no member profile, with a session cookie. */
  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    return { id: person.id, cookie: await cookieOf(person.id) };
  }

  async function personIdOf(ra: string): Promise<string> {
    const rows = (await dataSource.query("SELECT id FROM people WHERE ra = $1", [ra])) as Array<{
      id: string;
    }>;
    return rows[0].id;
  }

  /**
   * Registers a member through the real flow: coordination creates an invite, the applicant
   * accepts it with the registration form and coordination approves it with JOINED_AT. Returns
   * the Person id. Without `approve` the registration stays pending.
   */
  async function registerMember(
    registration: Record<string, unknown>,
    options: { approve?: boolean } = {},
  ): Promise<string> {
    const { approve = true } = options;

    const created = await request(app.getHttpServer())
      .post("/invites")
      .set("Cookie", coordinator.cookie)
      .send({ role: "member" })
      .expect(201);
    const token = new URL(created.body.url as string).searchParams.get("token") ?? "";

    const form = buildRegistration({ departmentId: tech, ...registration });
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
          role: "member",
          departmentId: tech,
          mainFunction: MAIN_FUNCTION,
          joinedAt: JOINED_AT,
        })
        .expect(200);
    }
    return personId;
  }

  function deactivate(id: string, actor: Actor, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/members/${id}/deactivate`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  function reactivate(id: string, actor: Actor) {
    return request(app.getHttpServer())
      .patch(`/members/${id}/reactivate`)
      .set("Cookie", actor.cookie);
  }

  function me(cookie: string) {
    return request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie);
  }

  async function exitOf(personId: string): Promise<ExitRow> {
    const rows = (await dataSource.query(
      `SELECT status, exit_date::text AS exit_date, exit_reason, exit_note, deactivated_at,
              deactivated_by_id
         FROM member_profiles WHERE person_id = $1`,
      [personId],
    )) as ExitRow[];
    return rows[0];
  }

  async function accessEnabledOf(personId: string): Promise<boolean> {
    const rows = (await dataSource.query("SELECT access_enabled FROM people WHERE id = $1", [
      personId,
    ])) as Array<{ access_enabled: boolean }>;
    return rows[0].access_enabled;
  }

  describe("PATCH /members/:id/deactivate (deactivateMember)", () => {
    it("coordinator deactivates an approved member: stores exit date, reason and note, disables the access and answers the record (200)", async () => {
      const personId = await registerMember(applicant(1));

      const res = await deactivate(personId, coordinator, EXIT).expect(200);

      expect(res.body).toMatchObject({
        id: personId,
        role: "member",
        registrationStatus: "approved",
        status: "inactive",
        exitDate: EXIT_DATE,
        exitReason: "Formou-se.",
        accessEnabled: false,
      });
      expect(res.body).not.toHaveProperty("exitNote");
      expect(JSON.stringify(res.body)).not.toContain(EXIT.note);

      const exit = await exitOf(personId);
      expect(exit).toMatchObject({
        status: "inactive",
        exit_date: EXIT_DATE,
        exit_reason: "Formou-se.",
        exit_note: EXIT.note,
        deactivated_by_id: coordinator.id,
      });
      expect(exit.deactivated_at).toBeInstanceOf(Date);
      expect(await accessEnabledOf(personId)).toBe(false);
    });

    it("the deactivated member gets 401 on the next request", async () => {
      const personId = await registerMember(applicant(1));
      const session = await cookieOf(personId);
      await me(session).expect(200);

      await deactivate(personId, coordinator, EXIT).expect(200);

      await me(session).expect(401);
    });

    it("superadmin deactivates a member (200)", async () => {
      const personId = await registerMember(applicant(1));

      const res = await deactivate(personId, superadmin, EXIT).expect(200);

      expect(res.body).toMatchObject({ status: "inactive", accessEnabled: false });
      expect((await exitOf(personId)).deactivated_by_id).toBe(superadmin.id);
    });

    it("director and member get 403 FORBIDDEN on deactivate and reactivate, also with an invalid body", async () => {
      const personId = await registerMember(applicant(1));

      for (const actor of [director, member]) {
        for (const body of [EXIT, {}]) {
          const res = await deactivate(personId, actor, body).expect(403);
          expect(res.body.error).toBe("FORBIDDEN");
        }
        const res = await reactivate(personId, actor).expect(403);
        expect(res.body.error).toBe("FORBIDDEN");
      }

      expect((await exitOf(personId)).status).toBe("active");
      expect(await accessEnabledOf(personId)).toBe(true);
    });

    it("403 OWN_ACCOUNT on the own account", async () => {
      const res = await deactivate(coordinator.id, coordinator, EXIT).expect(403);

      expect(res.body).toStrictEqual(OWN_ACCOUNT_BODY);
      expect(await accessEnabledOf(coordinator.id)).toBe(true);
    });

    it("409 MEMBER_INACTIVE when deactivating again, keeping the first exit", async () => {
      const personId = await registerMember(applicant(1));
      await deactivate(personId, coordinator, EXIT).expect(200);

      const again = await deactivate(personId, coordinator, {
        exitDate: "2026-01-10",
        reason: "Outro motivo.",
      }).expect(409);

      expect(again.body).toStrictEqual({
        statusCode: 409,
        error: "MEMBER_INACTIVE",
        message: "The member is inactive.",
      });
      expect(await exitOf(personId)).toMatchObject({
        exit_date: EXIT_DATE,
        exit_reason: "Formou-se.",
        exit_note: EXIT.note,
      });
    });

    it("409 REGISTRATION_NOT_APPROVED for a pending registration; 409 NO_MEMBER_PROFILE for a superadmin and a coordinator without profile", async () => {
      const pendingId = await registerMember(applicant(1), { approve: false });

      const pending = await deactivate(pendingId, coordinator, EXIT).expect(409);

      expect(pending.body).toStrictEqual({
        statusCode: 409,
        error: "REGISTRATION_NOT_APPROVED",
        message: "Only members with an approved registration can be deactivated.",
      });
      expect((await exitOf(pendingId)).status).toBe("active");

      const otherCoordinator = await createActor("Other Coordinator", Role.COORDINATOR);
      for (const target of [superadmin, otherCoordinator]) {
        const res = await deactivate(target.id, coordinator, EXIT).expect(409);

        expect(res.body).toStrictEqual({
          statusCode: 409,
          error: "NO_MEMBER_PROFILE",
          message: "This person has no member profile.",
        });
        expect(await accessEnabledOf(target.id)).toBe(true);
      }
    });

    it("400 EXIT_DATE_BEFORE_JOINED_AT when the exit is before the join date", async () => {
      const personId = await registerMember(applicant(1));

      const res = await deactivate(personId, coordinator, {
        ...EXIT,
        exitDate: "2025-02-28",
      }).expect(400);

      expect(res.body.error).toBe("EXIT_DATE_BEFORE_JOINED_AT");
      expect(res.body.details[0].field).toBe("exitDate");
      expect((await exitOf(personId)).status).toBe("active");

      await deactivate(personId, coordinator, { ...EXIT, exitDate: JOINED_AT }).expect(200);
    });

    it("400 VALIDATION_FAILED without exitDate or reason, with a future exitDate, a blank reason or a reason over 200 characters", async () => {
      const personId = await registerMember(applicant(1));
      const { exitDate: _withoutExitDate, ...noExitDate } = EXIT;
      const { reason: _withoutReason, ...noReason } = EXIT;

      for (const body of [
        noExitDate,
        noReason,
        { ...EXIT, exitDate: nextDay(todayInAppTimeZone()) },
        { ...EXIT, reason: "   " },
        { ...EXIT, reason: "a".repeat(201) },
      ]) {
        const res = await deactivate(personId, coordinator, body).expect(400);
        expect(res.body.error).toBe("VALIDATION_FAILED");
      }
      expect((await exitOf(personId)).status).toBe("active");
    });

    it("404 MEMBER_NOT_FOUND for an unknown id, a malformed id and a person without role nor profile", async () => {
      const student = await peopleService.save({ name: "Aluno", role: null, accessEnabled: false });

      for (const id of [randomUUID(), "not-a-uuid", student.id]) {
        const res = await deactivate(id, coordinator, EXIT).expect(404);
        expect(res.body).toStrictEqual(MEMBER_NOT_FOUND_BODY);
      }
    });

    it("coordinator deactivates another active coordinator while one more stays active (200)", async () => {
      const coord3 = await createActor("Coordinator Three", Role.COORDINATOR);
      await insertMemberProfile(dataSource, { personId: coord3.id, status: "approved" });

      const res = await deactivate(coord3.id, coordinator, EXIT).expect(200);

      expect(res.body).toMatchObject({
        role: "coordinator",
        status: "inactive",
        accessEnabled: false,
      });
    });

    // Same scenario as CA81-5 of /access: with an active coordinator as the actor (she passed the
    // guard) and OWN_ACCOUNT forbidding herself, the count is always 2 or more while the target is
    // active. The 409 only shows up when the target coordinator already has the access disabled.
    it("409 LAST_COORDINATOR when the target coordinator is the last active one; superadmin bypasses", async () => {
      const coord2 = await createActor("Coordinator Two", Role.COORDINATOR);
      await insertMemberProfile(dataSource, { personId: coord2.id, status: "approved" });
      await request(app.getHttpServer())
        .patch(`/access/${coord2.id}/enabled`)
        .set("Cookie", superadmin.cookie)
        .send({ enabled: false })
        .expect(200);

      const blocked = await deactivate(coord2.id, coordinator, EXIT).expect(409);

      expect(blocked.body).toStrictEqual({
        statusCode: 409,
        error: "LAST_COORDINATOR",
        message: "Cannot demote or disable the last active coordinator.",
      });
      expect((await exitOf(coord2.id)).status).toBe("active");

      const bypass = await deactivate(coord2.id, superadmin, EXIT).expect(200);
      expect(bypass.body).toMatchObject({ status: "inactive", accessEnabled: false });
    });
  });

  describe("PATCH /members/:id/reactivate (reactivateMember)", () => {
    it("reactivates an inactive member and clears the exit (200)", async () => {
      const personId = await registerMember(applicant(1));
      await deactivate(personId, coordinator, EXIT).expect(200);

      const res = await reactivate(personId, coordinator).expect(200);

      expect(res.body).toMatchObject({
        id: personId,
        status: "active",
        exitDate: null,
        exitReason: null,
        accessEnabled: false,
      });
      expect(await exitOf(personId)).toEqual({
        status: "active",
        exit_date: null,
        exit_reason: null,
        exit_note: null,
        deactivated_at: null,
        deactivated_by_id: null,
      });
      expect(await accessEnabledOf(personId)).toBe(false);
    });

    it("keeps the login closed after reactivating until PATCH /access/:id/enabled turns it on", async () => {
      const personId = await registerMember(applicant(1));
      const session = await cookieOf(personId);
      await deactivate(personId, coordinator, EXIT).expect(200);

      await reactivate(personId, coordinator).expect(200);
      await me(session).expect(401);

      await request(app.getHttpServer())
        .patch(`/access/${personId}/enabled`)
        .set("Cookie", coordinator.cookie)
        .send({ enabled: true })
        .expect(200);
      await me(session).expect(200);
    });

    it("answers 200 unchanged for a member that is already active", async () => {
      const personId = await registerMember(applicant(1));
      const updatedAt = async (): Promise<string> => {
        const rows = (await dataSource.query(
          "SELECT updated_at::text AS updated_at FROM member_profiles WHERE person_id = $1",
          [personId],
        )) as Array<{ updated_at: string }>;
        return rows[0].updated_at;
      };
      const before = await updatedAt();

      const res = await reactivate(personId, coordinator).expect(200);

      expect(res.body).toMatchObject({ status: "active", accessEnabled: true });
      expect(await updatedAt()).toBe(before);
    });

    it("403 OWN_ACCOUNT on the own account; 404 MEMBER_NOT_FOUND for an unknown id", async () => {
      const own = await reactivate(coordinator.id, coordinator).expect(403);
      expect(own.body).toStrictEqual(OWN_ACCOUNT_BODY);

      const unknown = await reactivate(randomUUID(), coordinator).expect(404);
      expect(unknown.body).toStrictEqual(MEMBER_NOT_FOUND_BODY);
    });
  });

  describe("GET /members and GET /members/:id with the participation", () => {
    it("list and record carry status, exitDate and exitReason", async () => {
      const inactiveId = await registerMember(applicant(1));
      const activeId = await registerMember(applicant(2));
      await deactivate(inactiveId, coordinator, EXIT).expect(200);

      const list = await request(app.getHttpServer())
        .get("/members")
        .set("Cookie", coordinator.cookie)
        .expect(200);

      const rows = list.body.data as Array<Record<string, unknown>>;
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(inactiveId)).toMatchObject({
        status: "inactive",
        exitDate: EXIT_DATE,
        exitReason: "Formou-se.",
        accessEnabled: false,
      });
      expect(byId.get(activeId)).toMatchObject({
        status: "active",
        exitDate: null,
        exitReason: null,
      });
      for (const row of rows) {
        expect(row).not.toHaveProperty("exitNote");
      }
      expect(JSON.stringify(list.body)).not.toContain(EXIT.note);

      const record = await request(app.getHttpServer())
        .get(`/members/${inactiveId}`)
        .set("Cookie", coordinator.cookie)
        .expect(200);

      expect(record.body).toMatchObject({
        status: "inactive",
        exitDate: EXIT_DATE,
        exitReason: "Formou-se.",
        accessEnabled: false,
      });
      expect(record.body).not.toHaveProperty("exitNote");
      expect(JSON.stringify(record.body)).not.toContain(EXIT.note);
    });

    it("filters by status; omitted lists every status; a person without member profile counts as active", async () => {
      const inactiveId = await registerMember(applicant(1));
      const activeId = await registerMember(applicant(2));
      const pendingId = await registerMember(applicant(3), { approve: false });
      await deactivate(inactiveId, coordinator, EXIT).expect(200);

      const list = async (query: string): Promise<{ ids: string[]; total: number }> => {
        const res = await request(app.getHttpServer())
          .get(`/members${query}`)
          .set("Cookie", coordinator.cookie)
          .expect(200);
        return {
          ids: (res.body.data as Array<{ id: string }>).map((row) => row.id),
          total: res.body.total as number,
        };
      };

      const inactive = await list("?status=inactive");
      expect(inactive.ids).toEqual([inactiveId]);

      const active = await list("?status=active");
      expect(active.ids).toEqual(
        expect.arrayContaining([
          activeId,
          pendingId,
          coordinator.id,
          superadmin.id,
          director.id,
          member.id,
        ]),
      );
      expect(active.ids).not.toContain(inactiveId);

      const all = await list("");
      expect(all.total).toBe(active.total + inactive.total);
      expect(all.ids).toEqual(expect.arrayContaining([inactiveId, activeId, pendingId]));
    });
  });
});
