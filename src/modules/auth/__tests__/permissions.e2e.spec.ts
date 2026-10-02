/**
 * E2e spec for @RequirePermission + PermissionPolicy — GUS-114.
 *
 * The domain modules that own these rules (members, hours, attendance) do not exist yet.
 * PermissionDemoController stands in for them under /test/permissions/..., fed by fake fixtures.
 * Since GUS-91 the department of a person is real: the AuthGuard fills AuthUser.departmentIds
 * from the approved member profile (see "department scope with real departments").
 */
import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { INestApplication } from "@nestjs/common";
import { DataSource } from "typeorm";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import request from "supertest";
import {
  insertDepartment,
  insertMemberProfile,
} from "@modules/people/__tests__/fixtures/member-registration.fixture";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { SESSION_COOKIE_NAME } from "../auth.constants";
import { PermissionsTestModule } from "./test-support/permissions-test.module";
import { FAKE_DEPARTMENTS, FAKE_LESSON_STAFF } from "./test-support/permission-fixtures";

// ---------------------------------------------------------------------------
// DB configuration — same defaults as auth.guard.e2e.spec.ts
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

const BASE = "/test/permissions";
const LESSON_X = "lesson-x";
const LESSON_Y = "lesson-y";

interface Actor {
  id: string;
  cookie: string;
}

describe("Permissions (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let jwtService: JwtService;
  let peopleService: PeopleService;
  let dataSource: DataSource;

  // Actors, recreated before each test.
  let directorTech: Actor;
  let directorNoDept: Actor;
  let memberTech: Actor;
  let memberComms: Actor;
  let beatriz: Actor; // member, teacher of lesson X
  let diego: Actor; // member, monitor of lesson X
  let juliana: Actor; // member, monitor of lesson X
  let coordinator: Actor;

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id }, { secret: TEST_SECRET });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

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
        PermissionsTestModule,
      ],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    jwtService = module.get(JwtService);
    peopleService = module.get(PeopleService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    // CASCADE from people also truncates member_profiles.
    await dataSource.query("TRUNCATE TABLE departments, people RESTART IDENTITY CASCADE");
    FAKE_DEPARTMENTS.clear();
    FAKE_LESSON_STAFF.clear();

    directorTech = await createActor("Director Tecnologia", Role.DIRECTOR);
    directorNoDept = await createActor("Director Sem Departamento", Role.DIRECTOR);
    memberTech = await createActor("Member Tecnologia", Role.MEMBER);
    memberComms = await createActor("Member Comunicacao", Role.MEMBER);
    beatriz = await createActor("Beatriz", Role.MEMBER);
    diego = await createActor("Diego", Role.MEMBER);
    juliana = await createActor("Juliana", Role.MEMBER);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);

    FAKE_DEPARTMENTS.set(directorTech.id, ["tecnologia"]);
    FAKE_DEPARTMENTS.set(memberTech.id, ["tecnologia"]);
    FAKE_DEPARTMENTS.set(memberComms.id, ["comunicacao"]);
    FAKE_LESSON_STAFF.set(LESSON_X, {
      teacherIds: [beatriz.id],
      monitorIds: [diego.id, juliana.id],
    });
    FAKE_LESSON_STAFF.set(LESSON_Y, { teacherIds: [], monitorIds: [] });
  });

  // -------------------------------------------------------------------------
  // Department scope with the real departments (GUS-91)
  // -------------------------------------------------------------------------
  describe("department scope with real departments (GUS-91)", () => {
    let tecnologiaId: string;
    let comunicacaoId: string;
    let realDirector: Actor;
    let realMemberTech: Actor;
    let realMemberComms: Actor;

    async function approvedActor(name: string, role: Role, departmentId: string): Promise<Actor> {
      const actor = await createActor(name, role);
      await insertMemberProfile(dataSource, {
        personId: actor.id,
        status: "approved",
        departmentId,
      });
      return actor;
    }

    beforeEach(async () => {
      tecnologiaId = await insertDepartment(dataSource, "Tecnologia");
      comunicacaoId = await insertDepartment(dataSource, "Comunicação");
      realDirector = await approvedActor("Director Real Tecnologia", Role.DIRECTOR, tecnologiaId);
      realMemberTech = await approvedActor("Member Real Tecnologia", Role.MEMBER, tecnologiaId);
      realMemberComms = await approvedActor("Member Real Comunicação", Role.MEMBER, comunicacaoId);
    });

    it("director of Tecnologia gets 200 on GET /test/permissions/real-members/<Tecnologia member> with departments filled by the AuthGuard (GUS-91)", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/real-members/${realMemberTech.id}`)
        .set("Cookie", realDirector.cookie)
        .expect(200)
        .expect({ personId: realMemberTech.id });
    });

    it("director of Tecnologia gets 403 FORBIDDEN_SCOPE on GET /test/permissions/real-members/<Comunicação member> with departments filled by the AuthGuard (GUS-91)", async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/real-members/${realMemberComms.id}`)
        .set("Cookie", realDirector.cookie)
        .expect(403);

      expect(res.body.error).toBe("FORBIDDEN_SCOPE");
    });

    it("director without a member profile gets 403 FORBIDDEN_SCOPE on any third party", async () => {
      // directorNoDept has no profile: the guard attaches [] and the department scope denies.
      const res = await request(app.getHttpServer())
        .get(`${BASE}/real-members/${realMemberTech.id}`)
        .set("Cookie", directorNoDept.cookie)
        .expect(403);

      expect(res.body.error).toBe("FORBIDDEN_SCOPE");
    });
  });

  // -------------------------------------------------------------------------
  // Department scope (card cases 2 and CA3)
  // -------------------------------------------------------------------------
  describe("department scope", () => {
    it("director of Tecnologia gets 200 on GET /test/permissions/members/<Tecnologia member>", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/members/${memberTech.id}`)
        .set("Cookie", directorTech.cookie)
        .expect(200)
        .expect({ personId: memberTech.id });
    });

    it("director of Tecnologia gets 403 FORBIDDEN_SCOPE on GET /test/permissions/members/<Comunicação member>", async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/members/${memberComms.id}`)
        .set("Cookie", directorTech.cookie)
        .expect(403);
      expect(res.body.error).toBe("FORBIDDEN_SCOPE");
    });

    it("director without department gets 403 FORBIDDEN_SCOPE on any third party", async () => {
      for (const target of [memberTech, memberComms]) {
        const res = await request(app.getHttpServer())
          .get(`${BASE}/members/${target.id}`)
          .set("Cookie", directorNoDept.cookie)
          .expect(403);
        expect(res.body.error).toBe("FORBIDDEN_SCOPE");
      }
    });

    it("member gets 403 FORBIDDEN on GET /test/permissions/members/:id", async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/members/${memberTech.id}`)
        .set("Cookie", memberComms.cookie)
        .expect(403);
      expect(res.body.error).toBe("FORBIDDEN");
    });

    it("director gets 200 on PATCH /test/permissions/members/:id of the same department", async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/members/${memberTech.id}`)
        .set("Cookie", directorTech.cookie)
        .expect(200);
    });

    it("director gets 403 FORBIDDEN on PATCH /test/permissions/members/:id/deactivate", async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/members/${memberTech.id}/deactivate`)
        .set("Cookie", directorTech.cookie)
        .expect(403);
      expect(res.body.error).toBe("FORBIDDEN");
    });
  });

  // -------------------------------------------------------------------------
  // Hours (guard level and own scope)
  // -------------------------------------------------------------------------
  describe("hours", () => {
    it("member gets 403 FORBIDDEN on GET /test/permissions/hours/overview", async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/hours/overview`)
        .set("Cookie", memberTech.cookie)
        .expect(403);
      expect(res.body.error).toBe("FORBIDDEN");
    });

    it("director and coordinator get 200 on GET /test/permissions/hours/overview", async () => {
      for (const actor of [directorTech, coordinator]) {
        await request(app.getHttpServer())
          .get(`${BASE}/hours/overview`)
          .set("Cookie", actor.cookie)
          .expect(200);
      }
    });

    it("director of Tecnologia gets 200 on GET /test/permissions/hours/entries?personId=<Tecnologia member>", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/hours/entries`)
        .query({ personId: memberTech.id })
        .set("Cookie", directorTech.cookie)
        .expect(200)
        .expect({ personId: memberTech.id });
    });

    it("director of Tecnologia gets 403 FORBIDDEN_SCOPE on GET /test/permissions/hours/entries?personId=<Comunicação member>", async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/hours/entries`)
        .query({ personId: memberComms.id })
        .set("Cookie", directorTech.cookie)
        .expect(403);
      expect(res.body.error).toBe("FORBIDDEN_SCOPE");
    });

    it("member gets 200 on GET /test/permissions/hours/entries?personId=<self>", async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/hours/entries`)
        .query({ personId: memberTech.id })
        .set("Cookie", memberTech.cookie)
        .expect(200)
        .expect({ personId: memberTech.id });
    });

    it("member gets 403 FORBIDDEN_SCOPE on GET /test/permissions/hours/entries?personId=<other>", async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/hours/entries`)
        .query({ personId: memberComms.id })
        .set("Cookie", memberTech.cookie)
        .expect(403);
      expect(res.body.error).toBe("FORBIDDEN_SCOPE");
    });
  });

  // -------------------------------------------------------------------------
  // Allocated scope (card case 4)
  // -------------------------------------------------------------------------
  describe("allocated scope", () => {
    it("monitor of lesson X gets 201 on POST /test/permissions/lessons/X/attendance", async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/lessons/${LESSON_X}/attendance`)
        .set("Cookie", diego.cookie)
        .expect(201);
    });

    it("same member gets 403 FORBIDDEN_SCOPE on lesson Y", async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/lessons/${LESSON_Y}/attendance`)
        .set("Cookie", diego.cookie)
        .expect(403);
      expect(res.body.error).toBe("FORBIDDEN_SCOPE");
    });
  });

  // -------------------------------------------------------------------------
  // Lesson teacher scope and self attendance (card case 5)
  // -------------------------------------------------------------------------
  describe("member attendance", () => {
    const confirm = (lessonId: string, personId: string) =>
      request(app.getHttpServer()).post(
        `${BASE}/lessons/${lessonId}/member-attendance/${personId}`,
      );

    it("teacher Beatriz confirms monitor Diego → 201", async () => {
      await confirm(LESSON_X, diego.id).set("Cookie", beatriz.cookie).expect(201);
    });

    it("Beatriz confirming herself gets 403 SELF_ATTENDANCE_NOT_ALLOWED", async () => {
      const res = await confirm(LESSON_X, beatriz.id).set("Cookie", beatriz.cookie).expect(403);
      expect(res.body.error).toBe("SELF_ATTENDANCE_NOT_ALLOWED");
    });

    it("director confirms Beatriz → 201", async () => {
      await confirm(LESSON_X, beatriz.id).set("Cookie", directorTech.cookie).expect(201);
    });

    it("monitor Diego confirming Juliana gets 403 FORBIDDEN_SCOPE", async () => {
      const res = await confirm(LESSON_X, juliana.id).set("Cookie", diego.cookie).expect(403);
      expect(res.body.error).toBe("FORBIDDEN_SCOPE");
    });

    it("coordinator confirming herself gets 403 SELF_ATTENDANCE_NOT_ALLOWED", async () => {
      const res = await confirm(LESSON_X, coordinator.id)
        .set("Cookie", coordinator.cookie)
        .expect(403);
      expect(res.body.error).toBe("SELF_ATTENDANCE_NOT_ALLOWED");
    });
  });
});
