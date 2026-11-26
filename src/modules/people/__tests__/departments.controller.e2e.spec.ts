/**
 * E2e spec for DepartmentsController — GUS-91.
 *
 * The departments are data managed by coordination (invites.manage): the list is not code.
 * Directors and members cannot read or create them (the sign-up form gets the list from
 * GET /auth/invites/:token, covered in the invites e2e).
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

process.env.JWT_SECRET = "e2e-departments-secret";

// Name of the session cookie set by the auth module (kept local: tests do not import module internals).
const SESSION_COOKIE_NAME = "tedi_session";

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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("DepartmentsController (e2e)", () => {
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
        // A second forRoot() creates a second EventEmitter2, and the service would emit on a
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

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  function createDepartment(name: unknown, actor: Actor = coordinator) {
    return request(app.getHttpServer())
      .post("/departments")
      .set("Cookie", actor.cookie)
      .send({ name });
  }

  // ---------------------------------------------------------------------------
  // POST /departments
  // ---------------------------------------------------------------------------

  describe("POST /departments (createDepartment)", () => {
    it("creates a department and returns 201 for a coordinator", async () => {
      const res = await createDepartment("  Tecnologia ").expect(201);

      // Explicit projection: id and name only, with the name trimmed.
      expect(res.body).toStrictEqual({ id: expect.any(String), name: "Tecnologia" });

      const rows = (await dataSource.query("SELECT id, name FROM departments")) as Array<{
        id: string;
        name: string;
      }>;
      expect(rows).toEqual([{ id: res.body.id, name: "Tecnologia" }]);
    });

    it("returns 409 DEPARTMENT_ALREADY_EXISTS for the same name in another case", async () => {
      await createDepartment("Tecnologia").expect(201);

      for (const name of ["TECNOLOGIA", "tecnologia", "Tecnologia"]) {
        const res = await createDepartment(name).expect(409);
        expect(res.body.error).toBe("DEPARTMENT_ALREADY_EXISTS");
        expect(res.body.message).toBe("Department already exists.");
      }

      const rows = (await dataSource.query("SELECT count(*) FROM departments")) as Array<{
        count: string;
      }>;
      expect(Number(rows[0].count)).toBe(1);
    });

    it("answers 409 DEPARTMENT_ALREADY_EXISTS for the loser of two simultaneous requests that differ only in case", async () => {
      // The pre-check can pass for both; the unique index on lower(name) decides, and its 23505
      // is mapped to the same 409 (no 500).
      const results = await Promise.all([
        createDepartment("Tecnologia"),
        createDepartment("tecnologia"),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      const loser = results.find((res) => res.status === 409);
      expect(loser?.body.error).toBe("DEPARTMENT_ALREADY_EXISTS");

      const rows = (await dataSource.query("SELECT count(*) FROM departments")) as Array<{
        count: string;
      }>;
      expect(Number(rows[0].count)).toBe(1);
    });

    it("returns 400 VALIDATION_FAILED with field name for a blank name", async () => {
      for (const name of ["", "   ", undefined, "a".repeat(101)]) {
        const res = await createDepartment(name).expect(400);
        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["name"]);
      }
    });

    it("emits DEPARTMENT_CREATED", async () => {
      const events: AuditableActionEvent[] = [];
      eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));

      const res = await createDepartment("Tecnologia").expect(201);

      const created = events.filter((event) => event.action === AuditableAction.DEPARTMENT_CREATED);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        actorId: coordinator.id,
        targetType: "department",
        targetId: res.body.id,
        before: null,
        after: { name: "Tecnologia" },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /departments
  // ---------------------------------------------------------------------------

  describe("GET /departments (listDepartments)", () => {
    it("lists departments ordered by name", async () => {
      await createDepartment("Tecnologia").expect(201);
      await createDepartment("Eventos").expect(201);
      await createDepartment("Comunicação").expect(201);

      const res = await request(app.getHttpServer())
        .get("/departments")
        .set("Cookie", coordinator.cookie)
        .expect(200);

      expect((res.body as Array<{ name: string }>).map((department) => department.name)).toEqual([
        "Comunicação",
        "Eventos",
        "Tecnologia",
      ]);
      expect(Object.keys((res.body as Array<object>)[0]).sort()).toEqual(["id", "name"]);
    });

    it("returns an empty list when there is no department", async () => {
      const res = await request(app.getHttpServer())
        .get("/departments")
        .set("Cookie", coordinator.cookie)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Permissions (invites.manage: coordination only)
  // ---------------------------------------------------------------------------

  describe("permissions", () => {
    it("returns 403 FORBIDDEN for a director and for a member on both routes", async () => {
      for (const actor of [director, member]) {
        const created = await createDepartment("Tecnologia", actor).expect(403);
        expect(created.body.error).toBe("FORBIDDEN");

        const listed = await request(app.getHttpServer())
          .get("/departments")
          .set("Cookie", actor.cookie)
          .expect(403);
        expect(listed.body.error).toBe("FORBIDDEN");
      }

      const rows = (await dataSource.query("SELECT count(*) FROM departments")) as Array<{
        count: string;
      }>;
      expect(Number(rows[0].count)).toBe(0);
    });

    it("returns 401 UNAUTHORIZED without a session", async () => {
      await request(app.getHttpServer()).get("/departments").expect(401);
      await request(app.getHttpServer()).post("/departments").send({ name: "X" }).expect(401);
    });
  });
});
