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
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { CatalogModule } from "../catalog.module";

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

process.env.JWT_SECRET = "e2e-courses-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

const BASIC = {
  name: "Informática Básica",
  description: "Fundamentos do uso do computador: teclado, mouse, arquivos e internet.",
  objective: "Deixar o aluno à vontade para usar o computador no dia a dia.",
  category: "basic",
};

const INTERMEDIATE = {
  name: "Informática Intermediária",
  description: "Planilhas, textos e apresentações para o dia a dia.",
  category: "intermediate",
};

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface CourseBody extends Record<string, unknown> {
  id: string;
  name: string;
  updatedAt: string;
  prerequisites: Array<{ id: string; name: string }>;
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

function uuids(total: number): string[] {
  return Array.from(
    { length: total },
    (_, index) => `01999a3e-7c1b-7000-8000-${String(index).padStart(12, "0")}`,
  );
}

describe("CoursesController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;

  let director: Actor;
  let coordinator: Actor;
  let member: Actor;

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
        CatalogModule,
      ],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    // One server up for the whole suite: supertest would otherwise open and close it around each
    // request, and the close of one request resets a concurrent one (the concurrency tests below).
    await app.listen(0);

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    jwtService = module.get(JwtService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      "TRUNCATE TABLE course_prerequisites, courses, people RESTART IDENTITY CASCADE",
    );

    director = await createActor("Director", Role.DIRECTOR);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
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

  function postCourse(actor: Actor, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post("/courses").set("Cookie", actor.cookie).send(body);
  }

  async function createCourse(
    body: Record<string, unknown>,
    actor = director,
  ): Promise<CourseBody> {
    const res = await postCourse(actor, body).expect(201);
    return res.body as CourseBody;
  }

  function patchCourse(id: string, actor: Actor, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/courses/${id}`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  /** The archive route is GUS-116: until it exists, a course is archived straight in the table. */
  async function archiveCourse(id: string): Promise<void> {
    await dataSource.query(
      `UPDATE courses SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
      [id, coordinator.id],
    );
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  async function countRows(table: "courses" | "course_prerequisites"): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM ${table}`,
    );
    return Number(rows[0].total);
  }

  async function storedPrerequisiteIds(courseId: string): Promise<string[]> {
    const rows: Array<{ prerequisite_id: string }> = await dataSource.query(
      `SELECT prerequisite_id FROM course_prerequisites WHERE course_id = $1 ORDER BY prerequisite_id`,
      [courseId],
    );
    return rows.map((row) => row.prerequisite_id);
  }

  async function storedCourse(id: string): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT name, description, objective, category, archived_at FROM courses WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  async function blockedStatement(): Promise<string | undefined> {
    for (let attempt = 0; attempt < 60; attempt++) {
      const rows: Array<{ query: string }> = await dataSource.query(
        `SELECT query FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (rows.length > 0) return rows[0].query;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return undefined;
  }

  /** Holds the advisory lock of the graph of prerequisites, as an edit of the prerequisites does. */
  async function holdGraphLock() {
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(`SELECT pg_advisory_xact_lock(hashtext('course_prerequisites'))`);

    return async () => {
      await holder.commitTransaction();
      await holder.release();
    };
  }

  describe("POST /courses (createCourse)", () => {
    it("creates 'Informática Básica' (basic) and 'Informática Intermediária' (intermediate) requiring it and returns 201 with prerequisites [{ id, name }]", async () => {
      const basic = await postCourse(director, BASIC).expect(201);

      expect(basic.body).toEqual({
        id: expect.any(String),
        name: "Informática Básica",
        description: BASIC.description,
        objective: BASIC.objective,
        category: "basic",
        status: "active",
        prerequisites: [],
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: director.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const intermediate = await postCourse(director, {
        ...INTERMEDIATE,
        prerequisiteIds: [basic.body.id],
      }).expect(201);

      expect(intermediate.body).toEqual({
        id: expect.any(String),
        name: "Informática Intermediária",
        description: INTERMEDIATE.description,
        objective: null,
        category: "intermediate",
        status: "active",
        prerequisites: [{ id: basic.body.id, name: "Informática Básica" }],
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: director.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      expect(await countRows("courses")).toBe(2);
      expect(await storedPrerequisiteIds(intermediate.body.id)).toEqual([basic.body.id]);
      expect(await storedPrerequisiteIds(basic.body.id)).toEqual([]);
      expect(await storedCourse(intermediate.body.id)).toMatchObject({
        name: "Informática Intermediária",
        category: "intermediate",
        archived_at: null,
      });
    });

    it("answers the prerequisites ordered by name", async () => {
      const basic = await createCourse(BASIC);
      const algorithms = await createCourse({ ...BASIC, name: "Algoritmos" });
      const zeta = await createCourse({ ...BASIC, name: "Zeta" });

      const created = await createCourse({
        ...INTERMEDIATE,
        prerequisiteIds: [zeta.id, basic.id, algorithms.id],
      });

      expect(created.prerequisites.map((prerequisite) => prerequisite.name)).toEqual([
        "Algoritmos",
        "Informática Básica",
        "Zeta",
      ]);
    });

    it("creates with only the required fields: objective null, no prerequisites, status active", async () => {
      const res = await postCourse(director, {
        name: "Informática Básica",
        description: "Fundamentos.",
        category: "basic",
      }).expect(201);

      expect(res.body).toMatchObject({
        name: "Informática Básica",
        description: "Fundamentos.",
        category: "basic",
        objective: null,
        prerequisites: [],
        status: "active",
      });
      expect(await countRows("course_prerequisites")).toBe(0);
    });

    it("accepts an empty list of prerequisites", async () => {
      const res = await postCourse(director, { ...BASIC, prerequisiteIds: [] }).expect(201);

      expect(res.body.prerequisites).toEqual([]);
    });

    it("trims name, description and objective and treats a blank objective as not informed", async () => {
      const created = await createCourse({
        name: "  Informática Básica  ",
        description: "  Fundamentos.  ",
        objective: "  Aprender  ",
        category: "basic",
      });

      expect(created).toMatchObject({
        name: "Informática Básica",
        description: "Fundamentos.",
        objective: "Aprender",
      });

      const blank = await createCourse({ ...BASIC, name: "Outro", objective: "   " });
      expect(blank.objective).toBeNull();
    });

    it("accepts the largest values the DTO allows and stores them whole", async () => {
      const prerequisites: CourseBody[] = [];
      for (let index = 0; index < 20; index++) {
        prerequisites.push(await createCourse({ ...BASIC, name: `Base ${index}` }));
      }

      const created = await createCourse({
        name: "n".repeat(200),
        description: "d".repeat(2000),
        objective: "o".repeat(2000),
        category: "advanced",
        prerequisiteIds: prerequisites.map((prerequisite) => prerequisite.id),
      });

      expect(created.prerequisites).toHaveLength(20);
      expect(await storedCourse(created.id)).toMatchObject({
        name: "n".repeat(200),
        description: "d".repeat(2000),
        objective: "o".repeat(2000),
      });
    });

    it("ignores the fields the client has no say in", async () => {
      const created = await createCourse({
        ...BASIC,
        id: UNKNOWN_ID,
        status: "archived",
        createdById: member.id,
        archivedAt: "2026-01-01T00:00:00.000Z",
        archivedById: member.id,
        archiveReason: "injected",
      });

      expect(created).toMatchObject({
        status: "active",
        createdById: director.id,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });
      expect(created.id).not.toBe(UNKNOWN_ID);
    });

    it("returns 400 VALIDATION_FAILED with field category for 'expert' and for a missing category", async () => {
      const { category: _category, ...withoutCategory } = BASIC;

      for (const body of [
        { ...BASIC, category: "expert" },
        { ...BASIC, category: "BASIC" },
        { ...BASIC, category: "" },
        { ...BASIC, category: null },
        { ...BASIC, category: 1 },
        withoutCategory,
      ]) {
        const res = await postCourse(director, body).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["category"]);
      }
      expect(await countRows("courses")).toBe(0);
    });

    it("returns 400 VALIDATION_FAILED with field name or description when it is missing, blank or too long", async () => {
      const { name: _name, ...withoutName } = BASIC;
      const { description: _description, ...withoutDescription } = BASIC;

      for (const [field, body] of [
        ["name", withoutName],
        ["name", { ...BASIC, name: "   " }],
        ["name", { ...BASIC, name: null }],
        ["name", { ...BASIC, name: "n".repeat(201) }],
        ["description", withoutDescription],
        ["description", { ...BASIC, description: "   " }],
        ["description", { ...BASIC, description: "d".repeat(2001) }],
      ] as const) {
        const res = await postCourse(director, body).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual([field]);
      }
      expect(await countRows("courses")).toBe(0);
    });

    it("returns 400 VALIDATION_FAILED with field prerequisiteIds for a non-uuid, a duplicated id, more than 20 ids, null or not a list", async () => {
      const basic = await createCourse(BASIC);

      for (const prerequisiteIds of [
        ["not-a-uuid"],
        [basic.id, basic.id],
        [basic.id, basic.id.toUpperCase()],
        uuids(21),
        null,
        basic.id,
        [basic.id, null],
      ]) {
        const res = await postCourse(director, { ...INTERMEDIATE, prerequisiteIds }).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["prerequisiteIds"]);
      }
      expect(await countRows("courses")).toBe(1);
    });

    it("reports every invalid field at once", async () => {
      const res = await postCourse(director, {
        name: "",
        description: "",
        category: "expert",
        prerequisiteIds: ["nope"],
      }).expect(400);

      expect(fieldsOf(res.body)).toEqual(["category", "description", "name", "prerequisiteIds"]);
    });

    it("returns 400 PREREQUISITE_NOT_FOUND for an unknown course id and creates nothing", async () => {
      const basic = await createCourse(BASIC);

      const res = await postCourse(director, {
        ...INTERMEDIATE,
        prerequisiteIds: [basic.id, UNKNOWN_ID],
      }).expect(400);

      expect(res.body.error).toBe("PREREQUISITE_NOT_FOUND");
      expect(res.body.message).toBe("One or more prerequisites do not exist.");
      expect(await countRows("courses")).toBe(1);
      expect(await countRows("course_prerequisites")).toBe(0);
    });

    it("returns 400 PREREQUISITE_ARCHIVED for an archived prerequisite and creates nothing", async () => {
      const basic = await createCourse(BASIC);
      await archiveCourse(basic.id);

      const res = await postCourse(director, {
        ...INTERMEDIATE,
        prerequisiteIds: [basic.id],
      }).expect(400);

      expect(res.body.error).toBe("PREREQUISITE_ARCHIVED");
      expect(await countRows("courses")).toBe(1);
      expect(await countRows("course_prerequisites")).toBe(0);
    });

    it("returns 409 COURSE_NAME_TAKEN for a name taken by another course, ignoring case and including archived ones", async () => {
      const basic = await createCourse(BASIC);

      for (const name of [
        "Informática Básica",
        "INFORMÁTICA BÁSICA",
        "informática básica",
        "  Informática Básica  ",
      ]) {
        const res = await postCourse(director, { ...INTERMEDIATE, name }).expect(409);

        expect(res.body.error).toBe("COURSE_NAME_TAKEN");
        expect(res.body.message).toBe("A course with this name already exists.");
      }
      expect(await countRows("courses")).toBe(1);

      await archiveCourse(basic.id);
      const archived = await postCourse(director, {
        ...INTERMEDIATE,
        name: "informática básica",
      }).expect(409);
      expect(archived.body.error).toBe("COURSE_NAME_TAKEN");
      expect(await countRows("courses")).toBe(1);
    });

    it("answers COURSE_NAME_TAKEN before the problems with the prerequisites", async () => {
      await createCourse(BASIC);

      const res = await postCourse(director, {
        ...BASIC,
        prerequisiteIds: [UNKNOWN_ID],
      }).expect(409);

      expect(res.body.error).toBe("COURSE_NAME_TAKEN");
    });

    it("answers one 201 and one 409 COURSE_NAME_TAKEN to two concurrent creations with the same name", async () => {
      const [first, second] = await Promise.all([
        postCourse(director, BASIC),
        postCourse(coordinator, { ...BASIC, name: "INFORMÁTICA BÁSICA" }),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const conflict = first.status === 409 ? first : second;
      expect(conflict.body.error).toBe("COURSE_NAME_TAKEN");
      expect(await countRows("courses")).toBe(1);
    });

    it("returns 201 for a coordinator", async () => {
      const res = await postCourse(coordinator, BASIC).expect(201);

      expect(res.body.createdById).toBe(coordinator.id);
    });

    it("returns 403 FORBIDDEN for a member and creates nothing", async () => {
      const res = await postCourse(member, BASIC).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect(await countRows("courses")).toBe(0);
      expect(await countRows("course_prerequisites")).toBe(0);

      // The permission is checked before the body: an invalid body is still a 403.
      await postCourse(member, { name: "" }).expect(403);
    });

    it("returns 401 without a session cookie", async () => {
      await request(app.getHttpServer()).post("/courses").send(BASIC).expect(401);
    });

    it("emits COURSE_CREATED with the course and its prerequisite ids", async () => {
      const basic = await createCourse(BASIC);
      const events = collectEvents();

      const created = await createCourse({ ...INTERMEDIATE, prerequisiteIds: [basic.id] });

      expect(events).toHaveLength(1);
      expect(events[0].action).toBe(AuditableAction.COURSE_CREATED);
      expect(events[0].actorId).toBe(director.id);
      expect(events[0].targetType).toBe("course");
      expect(events[0].targetId).toBe(created.id);
      expect(events[0].before).toBeNull();
      expect(events[0].after).toEqual({
        name: "Informática Intermediária",
        description: INTERMEDIATE.description,
        objective: null,
        category: "intermediate",
        prerequisiteIds: [basic.id],
      });
    });

    it("does not emit when the creation is refused", async () => {
      const events = collectEvents();

      await postCourse(director, { ...BASIC, category: "expert" }).expect(400);
      await postCourse(director, { ...BASIC, prerequisiteIds: [UNKNOWN_ID] }).expect(400);
      await postCourse(member, BASIC).expect(403);

      expect(events).toHaveLength(0);
    });
  });

  describe("PATCH /courses/:id (updateCourse)", () => {
    it("changes the category from basic to advanced and returns 200", async () => {
      const basic = await createCourse(BASIC);
      expect(basic.category).toBe("basic");

      const res = await patchCourse(basic.id, director, { category: "advanced" }).expect(200);

      expect(res.body).toEqual({
        ...basic,
        category: "advanced",
        updatedAt: expect.any(String),
      });
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(
        new Date(basic.updatedAt).getTime(),
      );
      expect(await storedCourse(basic.id)).toMatchObject({ category: "advanced" });
    });

    it("updates the fields sent and clears objective sent as null", async () => {
      const basic = await createCourse(BASIC);

      const res = await patchCourse(basic.id, coordinator, {
        name: "  Informática para Iniciantes  ",
        description: "Novo texto.",
        objective: null,
      }).expect(200);

      expect(res.body).toMatchObject({
        id: basic.id,
        name: "Informática para Iniciantes",
        description: "Novo texto.",
        objective: null,
        category: "basic",
        createdById: director.id,
      });
      expect(await storedCourse(basic.id)).toMatchObject({
        name: "Informática para Iniciantes",
        objective: null,
      });
    });

    it("keeps the prerequisites when prerequisiteIds is omitted and clears them with []", async () => {
      const basic = await createCourse(BASIC);
      const intermediate = await createCourse({ ...INTERMEDIATE, prerequisiteIds: [basic.id] });

      const kept = await patchCourse(intermediate.id, director, {
        description: "Outro texto.",
      }).expect(200);

      expect(kept.body.prerequisites).toEqual([{ id: basic.id, name: "Informática Básica" }]);
      expect(await storedPrerequisiteIds(intermediate.id)).toEqual([basic.id]);

      const cleared = await patchCourse(intermediate.id, director, {
        prerequisiteIds: [],
      }).expect(200);

      expect(cleared.body.prerequisites).toEqual([]);
      expect(await storedPrerequisiteIds(intermediate.id)).toEqual([]);
      expect(await countRows("course_prerequisites")).toBe(0);
    });

    it("replaces the whole set of prerequisites and removes the old rows", async () => {
      const a = await createCourse({ ...BASIC, name: "A" });
      const b = await createCourse({ ...BASIC, name: "B" });
      const c = await createCourse({ ...BASIC, name: "C" });
      const d = await createCourse({ ...INTERMEDIATE, prerequisiteIds: [a.id] });

      const replaced = await patchCourse(d.id, director, { prerequisiteIds: [c.id, b.id] }).expect(
        200,
      );

      expect(replaced.body.prerequisites).toEqual([
        { id: b.id, name: "B" },
        { id: c.id, name: "C" },
      ]);
      expect(await storedPrerequisiteIds(d.id)).toEqual([b.id, c.id].sort());
      expect(await countRows("course_prerequisites")).toBe(2);

      const shorter = await patchCourse(d.id, director, { prerequisiteIds: [c.id] }).expect(200);
      expect(shorter.body.prerequisites).toEqual([{ id: c.id, name: "C" }]);
      expect(await countRows("course_prerequisites")).toBe(1);

      const longer = await patchCourse(d.id, director, {
        prerequisiteIds: [a.id, b.id, c.id],
      }).expect(200);
      expect(
        longer.body.prerequisites.map((prerequisite: { name: string }) => prerequisite.name),
      ).toEqual(["A", "B", "C"]);
      expect(await countRows("course_prerequisites")).toBe(3);
    });

    it("returns 400 PREREQUISITE_CYCLE when Básica would require Intermediária and changes nothing", async () => {
      const basic = await createCourse(BASIC);
      const intermediate = await createCourse({ ...INTERMEDIATE, prerequisiteIds: [basic.id] });

      const res = await patchCourse(basic.id, director, {
        name: "Outro nome",
        prerequisiteIds: [intermediate.id],
      }).expect(400);

      expect(res.body.error).toBe("PREREQUISITE_CYCLE");
      expect(res.body.message).toBe("The prerequisites would form a cycle.");
      // The whole edit is refused, the name included.
      expect(await storedCourse(basic.id)).toMatchObject({ name: "Informática Básica" });
      expect(await storedPrerequisiteIds(basic.id)).toEqual([]);
      expect(await storedPrerequisiteIds(intermediate.id)).toEqual([basic.id]);
      expect(await countRows("course_prerequisites")).toBe(1);
    });

    it("returns 400 PREREQUISITE_CYCLE when C would require A in A→B→C", async () => {
      const c = await createCourse({ ...BASIC, name: "C" });
      const b = await createCourse({ ...BASIC, name: "B", prerequisiteIds: [c.id] });
      const a = await createCourse({ ...BASIC, name: "A", prerequisiteIds: [b.id] });

      const res = await patchCourse(c.id, director, { prerequisiteIds: [a.id] }).expect(400);

      expect(res.body.error).toBe("PREREQUISITE_CYCLE");
      expect(await storedPrerequisiteIds(c.id)).toEqual([]);
      expect(await countRows("course_prerequisites")).toBe(2);

      // A longer chain is still fine: D can require A.
      const d = await createCourse({ ...BASIC, name: "D" });
      await patchCourse(d.id, director, { prerequisiteIds: [a.id] }).expect(200);
    });

    it("returns 400 PREREQUISITE_CYCLE when a course requires itself", async () => {
      const basic = await createCourse(BASIC);

      const res = await patchCourse(basic.id, director, {
        prerequisiteIds: [basic.id],
      }).expect(400);

      expect(res.body.error).toBe("PREREQUISITE_CYCLE");
      expect(await countRows("course_prerequisites")).toBe(0);
    });

    it("returns 400 PREREQUISITE_CYCLE when the path id is in upper case", async () => {
      // B requires A and C requires B: A cannot require C (A→C→B→A).
      const a = await createCourse({ ...BASIC, name: "A" });
      const b = await createCourse({ ...BASIC, name: "B", prerequisiteIds: [a.id] });
      const c = await createCourse({ ...BASIC, name: "C", prerequisiteIds: [b.id] });

      // The UUID pipe accepts upper case and Postgres finds the row, but the graph is in lower case.
      const transitive = await patchCourse(a.id.toUpperCase(), director, {
        prerequisiteIds: [c.id],
      });
      // A course that requires itself is a 400 as well, not a 500 of the check constraint.
      const itself = await patchCourse(a.id.toUpperCase(), director, {
        prerequisiteIds: [a.id],
      });

      expect([transitive.status, itself.status]).toEqual([400, 400]);
      expect([transitive.body.error, itself.body.error]).toEqual([
        "PREREQUISITE_CYCLE",
        "PREREQUISITE_CYCLE",
      ]);
      expect(await storedPrerequisiteIds(a.id)).toEqual([]);
      expect(await storedPrerequisiteIds(b.id)).toEqual([a.id]);
      expect(await storedPrerequisiteIds(c.id)).toEqual([b.id]);
      expect(await countRows("course_prerequisites")).toBe(2);
    });

    it("edits the course found by an id in upper case and emits the id stored in the database", async () => {
      const a = await createCourse({ ...BASIC, name: "A" });
      const b = await createCourse({ ...BASIC, name: "B" });
      const events = collectEvents();

      const res = await patchCourse(a.id.toUpperCase(), director, {
        category: "advanced",
        prerequisiteIds: [b.id],
      }).expect(200);

      expect(res.body.id).toBe(a.id);
      expect(res.body.category).toBe("advanced");
      expect(res.body.prerequisites).toEqual([{ id: b.id, name: "B" }]);
      expect(await storedPrerequisiteIds(a.id)).toEqual([b.id]);
      expect(await countRows("course_prerequisites")).toBe(1);
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe(AuditableAction.COURSE_UPDATED);
      expect(events[0].targetId).toBe(a.id);
    });

    it("accepts a diamond of prerequisites", async () => {
      const base = await createCourse({ ...BASIC, name: "Base" });
      const left = await createCourse({ ...BASIC, name: "Left", prerequisiteIds: [base.id] });
      const right = await createCourse({ ...BASIC, name: "Right", prerequisiteIds: [base.id] });
      const top = await createCourse({ ...BASIC, name: "Top" });

      const res = await patchCourse(top.id, director, {
        prerequisiteIds: [left.id, right.id, base.id],
      }).expect(200);

      expect(res.body.prerequisites).toHaveLength(3);
    });

    it("returns 400 PREREQUISITE_NOT_FOUND for an unknown course id and changes nothing", async () => {
      const basic = await createCourse(BASIC);
      const intermediate = await createCourse({ ...INTERMEDIATE, prerequisiteIds: [basic.id] });

      const res = await patchCourse(intermediate.id, director, {
        description: "Outro texto.",
        prerequisiteIds: [basic.id, UNKNOWN_ID],
      }).expect(400);

      expect(res.body.error).toBe("PREREQUISITE_NOT_FOUND");
      expect(await storedPrerequisiteIds(intermediate.id)).toEqual([basic.id]);
      expect(await storedCourse(intermediate.id)).toMatchObject({
        description: INTERMEDIATE.description,
      });
    });

    it("returns 400 PREREQUISITE_ARCHIVED for an archived course being added, and keeps one that is already linked", async () => {
      const basic = await createCourse(BASIC);
      const algorithms = await createCourse({ ...BASIC, name: "Algoritmos" });
      const intermediate = await createCourse({ ...INTERMEDIATE, prerequisiteIds: [basic.id] });
      await archiveCourse(basic.id);

      // Básica is archived but already linked: it stays, next to a new active course.
      const kept = await patchCourse(intermediate.id, director, {
        prerequisiteIds: [basic.id, algorithms.id],
      }).expect(200);
      expect(
        kept.body.prerequisites.map((prerequisite: { id: string }) => prerequisite.id),
      ).toEqual([algorithms.id, basic.id]);

      // Algoritmos is archived now and not linked to the other course: refused.
      await archiveCourse(algorithms.id);
      const other = await createCourse({ ...INTERMEDIATE, name: "Outro curso" });
      const refused = await patchCourse(other.id, director, {
        prerequisiteIds: [algorithms.id],
      }).expect(400);
      expect(refused.body.error).toBe("PREREQUISITE_ARCHIVED");
      expect(await storedPrerequisiteIds(other.id)).toEqual([]);

      // Clearing the list is always allowed, archived links included.
      await patchCourse(intermediate.id, director, { prerequisiteIds: [] }).expect(200);
    });

    it("returns 409 COURSE_NAME_TAKEN for another course's name, and 200 for its own name in another case", async () => {
      await createCourse(BASIC);
      const intermediate = await createCourse(INTERMEDIATE);

      for (const name of ["Informática Básica", "informática básica", "INFORMÁTICA BÁSICA"]) {
        const res = await patchCourse(intermediate.id, director, { name }).expect(409);

        expect(res.body.error).toBe("COURSE_NAME_TAKEN");
      }
      expect(await storedCourse(intermediate.id)).toMatchObject({
        name: "Informática Intermediária",
      });

      const own = await patchCourse(intermediate.id, director, {
        name: "INFORMÁTICA INTERMEDIÁRIA",
      }).expect(200);

      expect(own.body.name).toBe("INFORMÁTICA INTERMEDIÁRIA");
      expect(await storedCourse(intermediate.id)).toMatchObject({
        name: "INFORMÁTICA INTERMEDIÁRIA",
      });
    });

    it("returns 409 COURSE_NAME_TAKEN for the name of an archived course", async () => {
      const basic = await createCourse(BASIC);
      const intermediate = await createCourse(INTERMEDIATE);
      await archiveCourse(basic.id);

      const res = await patchCourse(intermediate.id, director, {
        name: "Informática Básica",
      }).expect(409);

      expect(res.body.error).toBe("COURSE_NAME_TAKEN");
    });

    it("returns 409 COURSE_ARCHIVED for an archived course and changes nothing", async () => {
      const basic = await createCourse(BASIC);
      const other = await createCourse({ ...BASIC, name: "Outro" });
      await archiveCourse(basic.id);

      for (const body of [
        {},
        { name: "Novo nome" },
        { category: "advanced", prerequisiteIds: [other.id] },
        { prerequisiteIds: [] },
      ]) {
        const res = await patchCourse(basic.id, director, body).expect(409);

        expect(res.body.error).toBe("COURSE_ARCHIVED");
        expect(res.body.message).toBe("Archived courses are read-only.");
      }
      expect(await storedCourse(basic.id)).toMatchObject({
        name: "Informática Básica",
        category: "basic",
      });
      expect(await countRows("course_prerequisites")).toBe(0);
    });

    it("returns 400 VALIDATION_FAILED when name, description, category or prerequisiteIds are null or invalid", async () => {
      const basic = await createCourse(BASIC);

      const nulls = await patchCourse(basic.id, director, {
        name: null,
        description: null,
        category: null,
        prerequisiteIds: null,
      }).expect(400);
      expect(nulls.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(nulls.body)).toEqual(["category", "description", "name", "prerequisiteIds"]);

      for (const [field, body] of [
        ["category", { category: "expert" }],
        ["category", { category: "BASIC" }],
        ["name", { name: "   " }],
        ["name", { name: "n".repeat(201) }],
        ["description", { description: "" }],
        ["prerequisiteIds", { prerequisiteIds: ["not-a-uuid"] }],
        ["prerequisiteIds", { prerequisiteIds: [basic.id, basic.id] }],
        ["prerequisiteIds", { prerequisiteIds: uuids(21) }],
      ] as const) {
        const res = await patchCourse(basic.id, director, body).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual([field]);
      }

      expect(await storedCourse(basic.id)).toMatchObject({ name: "Informática Básica" });
    });

    it("returns 404 COURSE_NOT_FOUND for an unknown id and for a malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await patchCourse(id, director, { name: "Outro" }).expect(404);

        expect(res.body.error).toBe("COURSE_NOT_FOUND");
        expect(res.body.message).toBe("Course not found.");
      }
    });

    it("returns 403 FORBIDDEN for a member and changes nothing", async () => {
      const basic = await createCourse(BASIC);

      const res = await patchCourse(basic.id, member, { category: "advanced" }).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      await patchCourse(basic.id, member, { name: null }).expect(403);
      await patchCourse(UNKNOWN_ID, member, { name: "Outro" }).expect(403);
      expect(await storedCourse(basic.id)).toMatchObject({ category: "basic" });
    });

    it("returns 401 without a session cookie", async () => {
      const basic = await createCourse(BASIC);

      await request(app.getHttpServer())
        .patch(`/courses/${basic.id}`)
        .send({ category: "advanced" })
        .expect(401);
    });

    it("answers 200 without changing anything or emitting an event when nothing changed", async () => {
      const basic = await createCourse(BASIC);
      const intermediate = await createCourse({ ...INTERMEDIATE, prerequisiteIds: [basic.id] });
      const events = collectEvents();

      const same = await patchCourse(intermediate.id, director, {
        name: "Informática Intermediária",
        description: INTERMEDIATE.description,
        category: "intermediate",
        prerequisiteIds: [basic.id],
      }).expect(200);
      const empty = await patchCourse(intermediate.id, director, {}).expect(200);

      expect(same.body).toEqual(intermediate);
      expect(empty.body).toEqual(intermediate);
      expect(events).toHaveLength(0);
    });

    it("treats the same prerequisites in another order, or in upper case, as no change", async () => {
      const a = await createCourse({ ...BASIC, name: "A" });
      const b = await createCourse({ ...BASIC, name: "B" });
      const d = await createCourse({ ...INTERMEDIATE, prerequisiteIds: [a.id, b.id] });
      const events = collectEvents();

      const reordered = await patchCourse(d.id, director, { prerequisiteIds: [b.id, a.id] }).expect(
        200,
      );
      const upper = await patchCourse(d.id, director, {
        prerequisiteIds: [a.id.toUpperCase(), b.id.toUpperCase()],
      }).expect(200);

      expect(reordered.body).toEqual(d);
      expect(upper.body).toEqual(d);
      expect(events).toHaveLength(0);
    });

    it("moves updatedAt forward when only the prerequisites change", async () => {
      const basic = await createCourse(BASIC);
      const intermediate = await createCourse(INTERMEDIATE);

      const res = await patchCourse(intermediate.id, director, {
        prerequisiteIds: [basic.id],
      }).expect(200);

      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(
        new Date(intermediate.updatedAt).getTime(),
      );
      expect(res.body.createdAt).toBe(intermediate.createdAt);
      const rows: Array<{ updated_at: Date }> = await dataSource.query(
        `SELECT updated_at FROM courses WHERE id = $1`,
        [intermediate.id],
      );
      expect(rows[0].updated_at.toISOString()).toBe(res.body.updatedAt);
    });

    it("locks the course row with FOR UPDATE before it edits and waits for whoever holds it", async () => {
      const basic = await createCourse(BASIC);
      const holder = dataSource.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query(`SELECT id FROM courses WHERE id = $1 FOR UPDATE`, [basic.id]);

      const pending = patchCourse(basic.id, director, { category: "advanced" }).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FOR UPDATE/);
      } finally {
        await holder.commitTransaction();
        await holder.release();
      }

      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body.category).toBe("advanced");
    });

    it("waits on pg_advisory_xact_lock when another transaction holds the graph, and goes on when it ends", async () => {
      const basic = await createCourse(BASIC);
      const intermediate = await createCourse(INTERMEDIATE);
      const release = await holdGraphLock();

      const pending = patchCourse(intermediate.id, director, { prerequisiteIds: [basic.id] }).then(
        (res) => res,
      );

      try {
        expect(await blockedStatement()).toMatch(/pg_advisory_xact_lock/);
      } finally {
        await release();
      }

      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body.prerequisites).toEqual([{ id: basic.id, name: "Informática Básica" }]);
    });

    it("does not wait for the graph when the edit does not send prerequisiteIds", async () => {
      const basic = await createCourse(BASIC);
      const release = await holdGraphLock();

      let giveUp: NodeJS.Timeout | undefined;
      try {
        const outcome = await Promise.race([
          patchCourse(basic.id, director, { category: "advanced" }).then((res) => res.status),
          new Promise<string>((resolve) => {
            giveUp = setTimeout(() => resolve("blocked"), 3000);
          }),
        ]);

        expect(outcome).toBe(200);
      } finally {
        clearTimeout(giveUp);
        await release();
      }
    });

    it("serializes concurrent edits: A requires B and B requires A, so one wins and the other is a cycle", async () => {
      for (let round = 0; round < 4; round++) {
        const a = await createCourse({ ...BASIC, name: `A${round}` });
        const b = await createCourse({ ...BASIC, name: `B${round}` });

        const [first, second] = await Promise.all([
          patchCourse(a.id, director, { prerequisiteIds: [b.id] }),
          patchCourse(b.id, coordinator, { prerequisiteIds: [a.id] }),
        ]);

        expect([first.status, second.status].sort()).toEqual([200, 400]);
        const loser = first.status === 400 ? first : second;
        expect(loser.body.error).toBe("PREREQUISITE_CYCLE");
        expect(await countRows("course_prerequisites")).toBe(round + 1);
      }
    });

    it("serializes concurrent edits of the same course: one of the two lists wins, whole", async () => {
      const [x, y, z] = await Promise.all(
        ["X", "Y", "Z"].map((name) => createCourse({ ...BASIC, name })),
      );
      const d = await createCourse({ ...INTERMEDIATE, prerequisiteIds: [x.id] });

      const [first, second] = await Promise.all([
        patchCourse(d.id, director, { prerequisiteIds: [y.id, z.id] }),
        patchCourse(d.id, coordinator, { prerequisiteIds: [z.id] }),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);
      const stored = await storedPrerequisiteIds(d.id);
      expect([[y.id, z.id].sort(), [z.id]]).toContainEqual(stored);
      expect(await countRows("course_prerequisites")).toBe(stored.length);
    });
  });

  describe("routes and events", () => {
    it("has no DELETE /courses/:id route", async () => {
      const basic = await createCourse(BASIC);

      const res = await request(app.getHttpServer())
        .delete(`/courses/${basic.id}`)
        .set("Cookie", coordinator.cookie)
        .expect(404);

      expect(res.body.error).toBe("NOT_FOUND");
      expect(await countRows("courses")).toBe(1);
    });

    it("emits one event per mutation: COURSE_CREATED, COURSE_UPDATED", async () => {
      const events = collectEvents();

      const basic = await createCourse(BASIC);
      const intermediate = await createCourse({ ...INTERMEDIATE, prerequisiteIds: [basic.id] });
      await patchCourse(basic.id, coordinator, {
        category: "advanced",
        objective: null,
        description: BASIC.description,
      }).expect(200);
      await patchCourse(intermediate.id, director, { prerequisiteIds: [] }).expect(200);

      expect(events.map((event) => event.action)).toEqual([
        AuditableAction.COURSE_CREATED,
        AuditableAction.COURSE_CREATED,
        AuditableAction.COURSE_UPDATED,
        AuditableAction.COURSE_UPDATED,
      ]);
      expect(events.map((event) => event.actorId)).toEqual([
        director.id,
        director.id,
        coordinator.id,
        director.id,
      ]);
      expect(events.every((event) => event.targetType === "course")).toBe(true);
      expect(events.map((event) => event.targetId)).toEqual([
        basic.id,
        intermediate.id,
        basic.id,
        intermediate.id,
      ]);
      // The description was sent but did not change: it is not in the event.
      expect(events[2].before).toEqual({ objective: BASIC.objective, category: "basic" });
      expect(events[2].after).toEqual({
        objective: null,
        category: "advanced",
        changedFields: ["objective", "category"],
      });
      expect(events[3].before).toEqual({ prerequisiteIds: [basic.id] });
      expect(events[3].after).toEqual({ prerequisiteIds: [], changedFields: ["prerequisiteIds"] });
    });

    it("does not emit when an edit is refused", async () => {
      const basic = await createCourse(BASIC);
      const intermediate = await createCourse({ ...INTERMEDIATE, prerequisiteIds: [basic.id] });
      const events = collectEvents();

      await patchCourse(basic.id, director, { prerequisiteIds: [intermediate.id] }).expect(400);
      await patchCourse(basic.id, director, { name: "Informática Intermediária" }).expect(409);
      await patchCourse(basic.id, member, { category: "advanced" }).expect(403);
      await patchCourse(UNKNOWN_ID, director, { category: "advanced" }).expect(404);

      expect(events).toHaveLength(0);
    });
  });
});
