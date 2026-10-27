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
import { CatalogModule } from "@modules/catalog/catalog.module";
import { CoursesService } from "@modules/catalog/services/courses.service";
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
import { ClassesModule } from "../classes.module";
import { EnrollmentCountsService } from "../services/enrollment-counts.service";

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

process.env.JWT_SECRET = "e2e-classes-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

type CreateCourseInput = Parameters<CoursesService["create"]>[0];

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface ClassBody extends Record<string, unknown> {
  id: string;
  code: string;
  courseId: string;
  edition: { id: string; name: string };
  status: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

describe("ClassesController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;
  let coursesService: CoursesService;

  let director: Actor;
  let coordinator: Actor;
  let member: Actor;
  let courseId: string;

  // The enrollments do not exist yet: the count is replaced here, so the two rules that depend on
  // it (archive and seats) are proven. GUS-108 removes the override and uses real enrollments.
  const enrollmentCounts = { countActive: jest.fn() };

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
        ClassesModule,
      ],
    })
      .overrideProvider(EnrollmentCountsService)
      .useValue(enrollmentCounts)
      .compile();

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
    coursesService = module.get(CoursesService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      "TRUNCATE TABLE classes, editions, course_prerequisites, courses, people RESTART IDENTITY CASCADE",
    );
    enrollmentCounts.countActive.mockReset();
    enrollmentCounts.countActive.mockResolvedValue(0);

    director = await createActor("Director", Role.DIRECTOR);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    member = await createActor("Member", Role.MEMBER);
    courseId = await createCourse("Informática Básica");
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
  });

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /** The course comes from the service that CatalogModule exports, not from the table. */
  async function createCourse(name: string): Promise<string> {
    const course = await coursesService.create(
      {
        name,
        description: "Fundamentos do uso do computador.",
        category: "basic",
      } as unknown as CreateCourseInput,
      director.id,
    );
    return course.id;
  }

  /** INFO-A in 2026.1, from 2026-03-03 to 2026-06-27, with 15 seats: the class of the card. */
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      courseId,
      code: "INFO-A",
      editionName: "2026.1",
      startDate: "2026-03-03",
      endDate: "2026-06-27",
      capacity: 15,
      ...overrides,
    };
  }

  function postClass(actor: Actor, payload: Record<string, unknown>) {
    return request(app.getHttpServer()).post("/classes").set("Cookie", actor.cookie).send(payload);
  }

  async function createClass(
    payload: Record<string, unknown> = body(),
    actor = director,
  ): Promise<ClassBody> {
    const res = await postClass(actor, payload).expect(201);
    return res.body as ClassBody;
  }

  function patchClass(id: string, actor: Actor, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/classes/${id}`)
      .set("Cookie", actor.cookie)
      .send(payload);
  }

  function archiveClass(id: string, actor: Actor, payload?: Record<string, unknown>) {
    const req = request(app.getHttpServer())
      .patch(`/classes/${id}/archive`)
      .set("Cookie", actor.cookie);
    return payload === undefined ? req : req.send(payload);
  }

  function unarchiveClass(id: string, actor: Actor) {
    return request(app.getHttpServer())
      .patch(`/classes/${id}/unarchive`)
      .set("Cookie", actor.cookie);
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  async function countRows(table: "classes" | "editions"): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM ${table}`,
    );
    return Number(rows[0].total);
  }

  async function storedEditionNames(): Promise<string[]> {
    const rows: Array<{ name: string }> = await dataSource.query(
      `SELECT name FROM editions ORDER BY name`,
    );
    return rows.map((row) => row.name);
  }

  /** The row as the table has it, with the dates as text so no time zone gets in the way. */
  async function storedClass(id: string): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT code, name, course_id, edition_id, start_date::text AS start_date,
              end_date::text AS end_date, location, capacity, status, created_by_id,
              archived_at, archived_by_id, archive_reason, deleted_at, updated_at
         FROM classes WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  /**
   * The text of a statement that is waiting for a lock, or undefined after 3 seconds. Postgres cuts
   * the text at 1024 bytes (track_activity_query_size) and the select that reads a class is longer,
   * so its FOR UPDATE, at the end, is not visible. It does not need to be: a plain SELECT is never
   * blocked by a row lock (MVCC), so a select of the class that waits proves it takes the lock.
   */
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

  /** Holds the row of a class FOR UPDATE, as the edit and the archive do. */
  async function holdClassRow(id: string) {
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(`SELECT id FROM classes WHERE id = $1 FOR UPDATE`, [id]);

    return async () => {
      await holder.commitTransaction();
      await holder.release();
    };
  }

  describe("POST /classes (createClass)", () => {
    it("creates INFO-A in 2026.1 for Informática Básica, 2026-03-03 to 2026-06-27, 15 seats, and returns 201 with status planned", async () => {
      const res = await postClass(director, body()).expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        code: "INFO-A",
        name: null,
        courseId,
        edition: { id: expect.any(String), name: "2026.1" },
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        location: null,
        capacity: 15,
        status: "planned",
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: director.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      expect(await countRows("classes")).toBe(1);
      expect(await countRows("editions")).toBe(1);
      expect(await storedClass(res.body.id)).toMatchObject({
        code: "INFO-A",
        name: null,
        course_id: courseId,
        edition_id: res.body.edition.id,
        start_date: "2026-03-03",
        end_date: "2026-06-27",
        location: null,
        capacity: 15,
        status: "planned",
        created_by_id: director.id,
        archived_at: null,
        deleted_at: null,
      });
    });

    it("stores the optional fields it receives and the status it is given", async () => {
      const res = await postClass(
        director,
        body({
          name: "Informática Básica, turma A",
          location: "Laboratório 3, bloco B",
          status: "in_progress",
        }),
      ).expect(201);

      expect(res.body).toMatchObject({
        name: "Informática Básica, turma A",
        location: "Laboratório 3, bloco B",
        status: "in_progress",
      });
      expect(await storedClass(res.body.id)).toMatchObject({
        name: "Informática Básica, turma A",
        location: "Laboratório 3, bloco B",
        status: "in_progress",
      });
    });

    it("creates the edition 2026.2 on demand, and reuses it for a second class (one row in editions)", async () => {
      expect(await storedEditionNames()).toEqual([]);

      const first = await postClass(director, body({ editionName: "2026.2" })).expect(201);
      const second = await postClass(
        director,
        body({ editionName: "2026.2", code: "INFO-B" }),
      ).expect(201);

      expect(first.body.edition.name).toBe("2026.2");
      expect(second.body.edition).toEqual(first.body.edition);
      expect(await storedEditionNames()).toEqual(["2026.2"]);
      expect(await countRows("classes")).toBe(2);
    });

    it("answers 201 to two concurrent creations with the new edition 2026.2, and both share one edition", async () => {
      for (let round = 0; round < 4; round++) {
        const editionName = `2027.${round + 1}`;

        const [first, second] = await Promise.all([
          postClass(director, body({ editionName, code: "INFO-A" })),
          postClass(coordinator, body({ editionName, code: "INFO-B" })),
        ]);

        expect([first.status, second.status]).toEqual([201, 201]);
        expect(first.body.edition).toEqual(second.body.edition);
        expect(first.body.edition.name).toBe(editionName);
      }

      expect(await countRows("editions")).toBe(4);
      expect(await countRows("classes")).toBe(8);
    });

    /** Another connection that inserts the edition 2027.9 and keeps the transaction open. */
    async function holdNewEdition() {
      const holder = dataSource.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      const rows: Array<{ id: string }> = await holder.query(
        `INSERT INTO editions (id, name) VALUES (gen_random_uuid(), '2027.9') RETURNING id`,
      );
      return { holder, editionId: rows[0].id };
    }

    it("waits for a concurrent insert of the same new edition and reuses it when that one commits", async () => {
      const { holder, editionId } = await holdNewEdition();

      const pending = postClass(director, body({ editionName: "2027.9" })).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/INSERT INTO "editions"/);
      } finally {
        await holder.commitTransaction();
        await holder.release();
      }

      const res = await pending;
      expect(res.status).toBe(201);
      expect(res.body.edition).toEqual({ id: editionId, name: "2027.9" });
      expect(await countRows("editions")).toBe(1);
    });

    it("goes on and creates the edition itself when the concurrent insert of the same name rolls back", async () => {
      const { holder, editionId } = await holdNewEdition();

      const pending = postClass(director, body({ editionName: "2027.9" })).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/INSERT INTO "editions"/);
      } finally {
        await holder.rollbackTransaction();
        await holder.release();
      }

      const res = await pending;
      expect(res.status).toBe(201);
      expect(res.body.edition.name).toBe("2027.9");
      expect(res.body.edition.id).not.toBe(editionId);
      expect(await storedEditionNames()).toEqual(["2027.9"]);
    });

    it("returns 409 CLASS_CODE_TAKEN for INFO-A in 2026.1 again (and for info-a), and 201 for INFO-A in 2026.2", async () => {
      await createClass();

      for (const code of ["INFO-A", "info-a", "Info-A", "  INFO-A  "]) {
        const res = await postClass(director, body({ code })).expect(409);

        expect(res.body.error).toBe("CLASS_CODE_TAKEN");
        expect(res.body.message).toBe("A class with this code already exists in this edition.");
      }
      expect(await countRows("classes")).toBe(1);

      const otherEdition = await postClass(director, body({ editionName: "2026.2" })).expect(201);

      expect(otherEdition.body.code).toBe("INFO-A");
      expect(otherEdition.body.edition.name).toBe("2026.2");
      expect(await countRows("classes")).toBe(2);
      expect(await storedEditionNames()).toEqual(["2026.1", "2026.2"]);
    });

    it("counts an archived class when it refuses a repeated code", async () => {
      const created = await createClass();
      await archiveClass(created.id, coordinator).expect(200);

      const res = await postClass(director, body({ code: "info-a" })).expect(409);

      expect(res.body.error).toBe("CLASS_CODE_TAKEN");
      expect(await countRows("classes")).toBe(1);
    });

    it("answers one 201 and one 409 CLASS_CODE_TAKEN to two concurrent creations with the same code, in an edition that exists and in a new one", async () => {
      // 2026.1 exists: both pass the pre-check and the unique index decides.
      await createClass(body({ code: "SEED" }));

      for (const editionName of ["2026.1", "2026.2"]) {
        const [first, second] = await Promise.all([
          postClass(director, body({ editionName, code: "INFO-A" })),
          postClass(coordinator, body({ editionName, code: "info-a" })),
        ]);

        expect([first.status, second.status].sort()).toEqual([201, 409]);
        const conflict = first.status === 409 ? first : second;
        expect(conflict.body.error).toBe("CLASS_CODE_TAKEN");
      }

      // SEED and INFO-A in 2026.1, and INFO-A in 2026.2.
      expect(await countRows("classes")).toBe(3);
      expect(await countRows("editions")).toBe(2);
    });

    it("returns 400 INVALID_PERIOD for 2026-06-27 to 2026-03-03 and creates neither the class nor the edition", async () => {
      const res = await postClass(
        director,
        body({ startDate: "2026-06-27", endDate: "2026-03-03", editionName: "2026.9" }),
      ).expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        error: "INVALID_PERIOD",
        message: "endDate must be on or after startDate.",
        details: [{ field: "endDate", message: "endDate must be on or after startDate" }],
      });
      expect(await countRows("classes")).toBe(0);
      expect(await countRows("editions")).toBe(0);
    });

    it("accepts a class that starts and ends on the same day", async () => {
      const res = await postClass(
        director,
        body({ startDate: "2026-03-03", endDate: "2026-03-03" }),
      ).expect(201);

      expect(res.body).toMatchObject({ startDate: "2026-03-03", endDate: "2026-03-03" });
    });

    it("accepts a period that crosses the turn of the year", async () => {
      const res = await postClass(
        director,
        body({ startDate: "2026-12-01", endDate: "2027-02-15" }),
      ).expect(201);

      expect(res.body).toMatchObject({ startDate: "2026-12-01", endDate: "2027-02-15" });
      expect(await storedClass(res.body.id)).toMatchObject({
        start_date: "2026-12-01",
        end_date: "2027-02-15",
      });
    });

    it("returns 400 COURSE_NOT_FOUND for a course that does not exist, and creates neither the class nor the edition", async () => {
      const res = await postClass(
        director,
        body({ courseId: UNKNOWN_ID, editionName: "2026.9" }),
      ).expect(400);

      expect(res.body.error).toBe("COURSE_NOT_FOUND");
      expect(res.body.message).toBe("Course not found.");
      expect(await countRows("classes")).toBe(0);
      expect(await countRows("editions")).toBe(0);
    });

    it("reads a course id in upper case as the id of the course and answers it in lower case", async () => {
      const res = await postClass(director, body({ courseId: courseId.toUpperCase() })).expect(201);

      expect(res.body.courseId).toBe(courseId);
      expect(await storedClass(res.body.id)).toMatchObject({ course_id: courseId });
    });

    it("trims the code, the edition name, the name and the location, and treats blanks as not informed", async () => {
      const res = await postClass(
        director,
        body({
          code: "  INFO-A  ",
          editionName: " 2026.1 ",
          name: "  Turma A  ",
          location: "  Sala 2  ",
        }),
      ).expect(201);

      expect(res.body).toMatchObject({
        code: "INFO-A",
        edition: { name: "2026.1" },
        name: "Turma A",
        location: "Sala 2",
      });

      const blank = await postClass(
        director,
        body({ code: "INFO-B", name: "   ", location: null }),
      ).expect(201);
      expect(blank.body.name).toBeNull();
      expect(blank.body.location).toBeNull();
    });

    it("accepts the largest values the DTO allows and stores them whole", async () => {
      const res = await postClass(
        director,
        body({
          code: "c".repeat(30),
          name: "n".repeat(200),
          location: "l".repeat(200),
          capacity: 1000,
        }),
      ).expect(201);

      expect(await storedClass(res.body.id)).toMatchObject({
        code: "c".repeat(30),
        name: "n".repeat(200),
        location: "l".repeat(200),
        capacity: 1000,
      });

      const smallest = await postClass(director, body({ code: "ONE", capacity: 1 })).expect(201);
      expect(smallest.body.capacity).toBe(1);
    });

    it("ignores the fields the client has no say in", async () => {
      const res = await postClass(
        director,
        body({
          id: UNKNOWN_ID,
          editionId: UNKNOWN_ID,
          createdById: member.id,
          archivedAt: "2026-01-01T00:00:00.000Z",
          archivedById: member.id,
          archiveReason: "injected",
        }),
      ).expect(201);

      expect(res.body).toMatchObject({
        createdById: director.id,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });
      expect(res.body.id).not.toBe(UNKNOWN_ID);
      expect(res.body.edition.id).not.toBe(UNKNOWN_ID);
    });

    it("returns 400 VALIDATION_FAILED with field editionName when it is not a year and a term", async () => {
      const { editionName: _editionName, ...withoutEdition } = body();

      for (const payload of [
        withoutEdition,
        ...["2026", "2026.10", "2026.0", "26.1", "2026-1", " ", "", null, 2026.1].map(
          (editionName) => body({ editionName }),
        ),
      ]) {
        const res = await postClass(director, payload).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["editionName"]);
      }
      expect(await countRows("classes")).toBe(0);
      expect(await countRows("editions")).toBe(0);
    });

    it("returns 400 VALIDATION_FAILED with field startDate or endDate for a date that is not a date of the calendar", async () => {
      for (const value of [
        "2026-02-30",
        "2026-3-3",
        "03/03/2026",
        "2026-03-03T00:00:00Z",
        "0000-01-01",
        "",
        null,
        20260303,
      ]) {
        const start = await postClass(director, body({ startDate: value })).expect(400);
        expect(start.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(start.body)).toEqual(["startDate"]);

        const end = await postClass(director, body({ endDate: value })).expect(400);
        expect(end.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(end.body)).toEqual(["endDate"]);
      }

      const { startDate: _startDate, ...withoutStart } = body();
      const { endDate: _endDate, ...withoutEnd } = body();
      expect(fieldsOf((await postClass(director, withoutStart).expect(400)).body)).toEqual([
        "startDate",
      ]);
      expect(fieldsOf((await postClass(director, withoutEnd).expect(400)).body)).toEqual([
        "endDate",
      ]);
      expect(await countRows("classes")).toBe(0);
    });

    it("returns 400 VALIDATION_FAILED with field capacity for 0, a negative number, 1.5, a text, more than 1000, null or a missing value", async () => {
      const { capacity: _capacity, ...withoutCapacity } = body();

      for (const payload of [
        withoutCapacity,
        ...[0, -1, 1.5, "15", 1001, null, true].map((capacity) => body({ capacity })),
      ]) {
        const res = await postClass(director, payload).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["capacity"]);
      }
      expect(await countRows("classes")).toBe(0);
    });

    it("returns 400 VALIDATION_FAILED with field code, courseId, status, name or location when they are invalid", async () => {
      for (const [field, overrides] of [
        ["code", { code: "" }],
        ["code", { code: "   " }],
        ["code", { code: "c".repeat(31) }],
        ["code", { code: null }],
        ["code", { code: 12 }],
        ["courseId", { courseId: "not-a-uuid" }],
        ["courseId", { courseId: "" }],
        ["courseId", { courseId: null }],
        ["status", { status: "open" }],
        ["status", { status: "PLANNED" }],
        ["name", { name: "n".repeat(201) }],
        ["location", { location: "l".repeat(201) }],
      ] as const) {
        const res = await postClass(director, body(overrides)).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual([field]);
      }
      expect(await countRows("classes")).toBe(0);
    });

    it("reports every invalid field at once", async () => {
      const res = await postClass(director, {
        courseId: "nope",
        code: "",
        editionName: "2026",
        startDate: "x",
        endDate: "y",
        capacity: 0,
        status: "open",
      }).expect(400);

      expect(fieldsOf(res.body)).toEqual([
        "capacity",
        "code",
        "courseId",
        "editionName",
        "endDate",
        "startDate",
        "status",
      ]);
    });

    it("answers a body with an invalid field before it looks at the period", async () => {
      const res = await postClass(
        director,
        body({ startDate: "2026-06-27", endDate: "2026-03-03", capacity: 0 }),
      ).expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(res.body)).toEqual(["capacity"]);
    });

    it("returns 201 for a coordinator", async () => {
      const res = await postClass(coordinator, body()).expect(201);

      expect(res.body.createdById).toBe(coordinator.id);
    });

    it("returns 403 FORBIDDEN for a member and creates nothing", async () => {
      const res = await postClass(member, body()).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect(await countRows("classes")).toBe(0);
      expect(await countRows("editions")).toBe(0);

      // The permission is checked before the body: an invalid body is still a 403.
      await postClass(member, { code: "" }).expect(403);
    });

    it("returns 401 without a session cookie", async () => {
      await request(app.getHttpServer()).post("/classes").send(body()).expect(401);
    });

    it("emits CLASS_CREATED with the class and its edition, and editionCreated tells if the edition was new", async () => {
      const events = collectEvents();

      const first = await createClass(body({ name: "Turma A", location: "Sala 2" }));
      const second = await createClass(body({ code: "INFO-B" }));

      expect(events).toHaveLength(2);
      expect(events[0].action).toBe(AuditableAction.CLASS_CREATED);
      expect(events[0].actorId).toBe(director.id);
      expect(events[0].targetType).toBe("class");
      expect(events[0].targetId).toBe(first.id);
      expect(events[0].before).toBeNull();
      expect(events[0].after).toEqual({
        code: "INFO-A",
        name: "Turma A",
        courseId,
        editionId: first.edition.id,
        editionName: "2026.1",
        editionCreated: true,
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        location: "Sala 2",
        capacity: 15,
        status: "planned",
      });
      expect(events[1].targetId).toBe(second.id);
      expect(events[1].after).toMatchObject({ editionCreated: false });
    });

    it("does not emit when the creation is refused", async () => {
      await createClass();
      const events = collectEvents();

      await postClass(director, body({ capacity: 0 })).expect(400);
      await postClass(director, body({ startDate: "2026-06-27", endDate: "2026-03-03" })).expect(
        400,
      );
      await postClass(director, body({ courseId: UNKNOWN_ID, code: "INFO-Z" })).expect(400);
      await postClass(director, body()).expect(409);
      await postClass(member, body({ code: "INFO-B" })).expect(403);

      expect(events).toHaveLength(0);
    });
  });

  describe("PATCH /classes/:id (updateClass)", () => {
    it("changes the fields sent, clears a location sent as null and returns 200", async () => {
      const created = await createClass(
        body({ name: "Turma A", location: "Laboratório 3, bloco B" }),
      );

      const res = await patchClass(created.id, coordinator, {
        name: "  Informática Básica, turma A  ",
        location: null,
        capacity: 20,
        status: "in_progress",
      }).expect(200);

      expect(res.body).toEqual({
        ...created,
        name: "Informática Básica, turma A",
        location: null,
        capacity: 20,
        status: "in_progress",
        updatedAt: expect.any(String),
      });
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
      expect(res.body.createdAt).toBe(created.createdAt);
      expect(await storedClass(created.id)).toMatchObject({
        name: "Informática Básica, turma A",
        location: null,
        capacity: 20,
        status: "in_progress",
        created_by_id: director.id,
      });
    });

    it("changes the code, the period and the status, and takes any status after any other", async () => {
      const created = await createClass();

      const moved = await patchClass(created.id, director, {
        code: "INFO-Z",
        startDate: "2026-03-10",
        endDate: "2026-07-04",
        status: "completed",
      }).expect(200);
      expect(moved.body).toMatchObject({
        code: "INFO-Z",
        startDate: "2026-03-10",
        endDate: "2026-07-04",
        status: "completed",
      });

      for (const status of ["planned", "cancelled", "in_progress", "planned"]) {
        const res = await patchClass(created.id, director, { status }).expect(200);
        expect(res.body.status).toBe(status);
      }
    });

    it("returns 400 INVALID_PERIOD when only endDate is sent and falls before the startDate stored, and changes nothing", async () => {
      const created = await createClass();

      const res = await patchClass(created.id, director, {
        endDate: "2026-03-02",
        capacity: 20,
      }).expect(400);

      expect(res.body).toEqual({
        statusCode: 400,
        error: "INVALID_PERIOD",
        message: "endDate must be on or after startDate.",
        details: [{ field: "endDate", message: "endDate must be on or after startDate" }],
      });
      // The whole edit is refused, the seats included.
      expect(await storedClass(created.id)).toMatchObject({
        end_date: "2026-06-27",
        capacity: 15,
      });
    });

    it("returns 400 INVALID_PERIOD when only startDate is sent and falls after the endDate stored", async () => {
      const created = await createClass();

      const res = await patchClass(created.id, director, { startDate: "2026-06-28" }).expect(400);

      expect(res.body.error).toBe("INVALID_PERIOD");
      expect(await storedClass(created.id)).toMatchObject({ start_date: "2026-03-03" });
    });

    it("accepts a new endDate that is the startDate stored, and a period that moves both dates", async () => {
      const created = await createClass();

      const sameDay = await patchClass(created.id, director, { endDate: "2026-03-03" }).expect(200);
      expect(sameDay.body).toMatchObject({ startDate: "2026-03-03", endDate: "2026-03-03" });

      const moved = await patchClass(created.id, director, {
        startDate: "2026-08-03",
        endDate: "2026-12-12",
      }).expect(200);
      expect(moved.body).toMatchObject({ startDate: "2026-08-03", endDate: "2026-12-12" });
    });

    it("returns 409 CLASS_CODE_TAKEN for the code of another class of the edition, ignoring case, and 200 for the code in another edition", async () => {
      await createClass();
      const other = await createClass(body({ code: "INFO-B" }));

      for (const code of ["INFO-A", "info-a", "  Info-A  "]) {
        const res = await patchClass(other.id, director, { code }).expect(409);

        expect(res.body.error).toBe("CLASS_CODE_TAKEN");
        expect(res.body.message).toBe("A class with this code already exists in this edition.");
      }
      expect(await storedClass(other.id)).toMatchObject({ code: "INFO-B" });

      // INFO-A is taken in 2026.1 only: in 2026.2 the class can have it.
      const elsewhere = await createClass(body({ code: "INFO-C", editionName: "2026.2" }));
      const res = await patchClass(elsewhere.id, director, { code: "INFO-A" }).expect(200);
      expect(res.body.code).toBe("INFO-A");
    });

    it("lets a class change only the case of its own code", async () => {
      const created = await createClass(body({ code: "INFO-B" }));

      const res = await patchClass(created.id, director, { code: "info-b" }).expect(200);

      expect(res.body.code).toBe("info-b");
      expect(await storedClass(created.id)).toMatchObject({ code: "info-b" });
    });

    it("moves the class to the edition 2026.3, created on demand", async () => {
      const created = await createClass();
      expect(await storedEditionNames()).toEqual(["2026.1"]);

      const res = await patchClass(created.id, director, { editionName: "2026.3" }).expect(200);

      expect(res.body.edition.name).toBe("2026.3");
      expect(res.body.edition.id).not.toBe(created.edition.id);
      expect(await storedEditionNames()).toEqual(["2026.1", "2026.3"]);
      expect(await storedClass(created.id)).toMatchObject({ edition_id: res.body.edition.id });
    });

    it("moves the class to an edition that exists, and returns 409 CLASS_CODE_TAKEN when its code is already there", async () => {
      const first = await createClass();
      const second = await createClass(body({ code: "INFO-A", editionName: "2026.2" }));

      const clash = await patchClass(second.id, director, { editionName: "2026.1" }).expect(409);
      expect(clash.body.error).toBe("CLASS_CODE_TAKEN");
      expect(await storedClass(second.id)).toMatchObject({ edition_id: second.edition.id });

      const renamed = await patchClass(second.id, director, {
        editionName: "2026.1",
        code: "INFO-B",
      }).expect(200);
      expect(renamed.body.edition).toEqual(first.edition);
      expect(await storedEditionNames()).toEqual(["2026.1", "2026.2"]);
    });

    it("rolls the new edition back when the rest of the edit is refused", async () => {
      const created = await createClass();
      enrollmentCounts.countActive.mockResolvedValue(10);

      const res = await patchClass(created.id, director, {
        editionName: "2026.7",
        capacity: 5,
      }).expect(409);

      expect(res.body.error).toBe("CAPACITY_BELOW_ENROLLED");
      expect(await storedEditionNames()).toEqual(["2026.1"]);
      expect(await storedClass(created.id)).toMatchObject({
        edition_id: created.edition.id,
        capacity: 15,
      });
    });

    it("ignores courseId: the course of a class never changes", async () => {
      const created = await createClass();
      const otherCourse = await createCourse("Informática Intermediária");

      const res = await patchClass(created.id, director, {
        courseId: otherCourse,
        capacity: 20,
      }).expect(200);

      expect(res.body.courseId).toBe(courseId);
      expect(res.body.capacity).toBe(20);
      expect(await storedClass(created.id)).toMatchObject({ course_id: courseId });

      // Not even a malformed one is reported: the field does not exist for this body.
      await patchClass(created.id, director, { courseId: "not-a-uuid" }).expect(200);
      expect(await storedClass(created.id)).toMatchObject({ course_id: courseId });
    });

    it("returns 409 CAPACITY_BELOW_ENROLLED when the seats fall below the active enrollments, and 200 for as many seats as enrolled", async () => {
      const created = await createClass();
      enrollmentCounts.countActive.mockResolvedValue(10);

      const refused = await patchClass(created.id, director, { capacity: 5 }).expect(409);

      expect(refused.body.error).toBe("CAPACITY_BELOW_ENROLLED");
      expect(refused.body.message).toBe(
        "The capacity cannot be lower than the number of active enrollments.",
      );
      expect(enrollmentCounts.countActive).toHaveBeenCalledWith(expect.anything(), created.id);
      expect(await storedClass(created.id)).toMatchObject({ capacity: 15 });

      const accepted = await patchClass(created.id, director, { capacity: 10 }).expect(200);
      expect(accepted.body.capacity).toBe(10);
    });

    it("answers the errors of an edit in the order archived, period, code, seats", async () => {
      await createClass();
      const created = await createClass(body({ code: "INFO-B" }));
      enrollmentCounts.countActive.mockResolvedValue(10);

      const period = await patchClass(created.id, director, {
        endDate: "2026-03-02",
        code: "INFO-A",
        capacity: 5,
      }).expect(400);
      expect(period.body.error).toBe("INVALID_PERIOD");

      const code = await patchClass(created.id, director, { code: "INFO-A", capacity: 5 }).expect(
        409,
      );
      expect(code.body.error).toBe("CLASS_CODE_TAKEN");

      const seats = await patchClass(created.id, director, { capacity: 5 }).expect(409);
      expect(seats.body.error).toBe("CAPACITY_BELOW_ENROLLED");

      enrollmentCounts.countActive.mockResolvedValue(0);
      await archiveClass(created.id, director).expect(200);
      const archived = await patchClass(created.id, director, {
        endDate: "2026-03-02",
        code: "INFO-A",
        capacity: 5,
      }).expect(409);
      expect(archived.body.error).toBe("CLASS_ARCHIVED");
    });

    it("returns 409 CLASS_ARCHIVED for an archived class and changes nothing", async () => {
      const created = await createClass();
      await archiveClass(created.id, coordinator).expect(200);

      for (const payload of [{}, { capacity: 20 }, { code: "INFO-B", editionName: "2026.2" }]) {
        const res = await patchClass(created.id, director, payload).expect(409);

        expect(res.body.error).toBe("CLASS_ARCHIVED");
        expect(res.body.message).toBe("Archived classes are read-only.");
      }
      expect(await storedClass(created.id)).toMatchObject({ code: "INFO-A", capacity: 15 });
      expect(await storedEditionNames()).toEqual(["2026.1"]);
    });

    it("returns 400 VALIDATION_FAILED when code, editionName, startDate, endDate, capacity or status are null or invalid", async () => {
      const created = await createClass();

      const nulls = await patchClass(created.id, director, {
        code: null,
        editionName: null,
        startDate: null,
        endDate: null,
        capacity: null,
        status: null,
      }).expect(400);
      expect(nulls.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(nulls.body)).toEqual([
        "capacity",
        "code",
        "editionName",
        "endDate",
        "startDate",
        "status",
      ]);

      for (const [field, payload] of [
        ["code", { code: "   " }],
        ["code", { code: "c".repeat(31) }],
        ["editionName", { editionName: "2026" }],
        ["editionName", { editionName: "2026.10" }],
        ["startDate", { startDate: "2026-02-30" }],
        ["endDate", { endDate: "03/03/2026" }],
        ["capacity", { capacity: 0 }],
        ["capacity", { capacity: 1.5 }],
        ["capacity", { capacity: 1001 }],
        ["status", { status: "open" }],
        ["name", { name: "n".repeat(201) }],
        ["location", { location: "l".repeat(201) }],
      ] as const) {
        const res = await patchClass(created.id, director, payload).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual([field]);
      }
      expect(await storedClass(created.id)).toMatchObject({ code: "INFO-A", capacity: 15 });
    });

    it("returns 404 CLASS_NOT_FOUND for an unknown id and for a malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await patchClass(id, director, { capacity: 20 }).expect(404);

        expect(res.body.error).toBe("CLASS_NOT_FOUND");
        expect(res.body.message).toBe("Class not found.");
      }
    });

    it("returns 403 FORBIDDEN for a member and changes nothing", async () => {
      const created = await createClass();

      const res = await patchClass(created.id, member, { capacity: 20 }).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      await patchClass(created.id, member, { capacity: null }).expect(403);
      await patchClass(UNKNOWN_ID, member, { capacity: 20 }).expect(403);
      expect(await storedClass(created.id)).toMatchObject({ capacity: 15 });
    });

    it("returns 401 without a session cookie", async () => {
      const created = await createClass();

      await request(app.getHttpServer())
        .patch(`/classes/${created.id}`)
        .send({ capacity: 20 })
        .expect(401);
    });

    it("answers 200 without changing anything or emitting an event when nothing changed", async () => {
      const created = await createClass(body({ name: "Turma A", location: "Sala 2" }));
      const events = collectEvents();

      const same = await patchClass(created.id, director, {
        code: "INFO-A",
        name: "Turma A",
        editionName: "2026.1",
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        location: "Sala 2",
        capacity: 15,
        status: "planned",
      }).expect(200);
      const empty = await patchClass(created.id, director, {}).expect(200);

      expect(same.body).toEqual(created);
      expect(empty.body).toEqual(created);
      expect(events).toHaveLength(0);
      expect(await storedEditionNames()).toEqual(["2026.1"]);
    });

    it("edits the class found by an id in upper case and emits the id stored in the database", async () => {
      const created = await createClass();
      const events = collectEvents();

      const res = await patchClass(created.id.toUpperCase(), director, {
        code: "INFO-Z",
      }).expect(200);

      expect(res.body.id).toBe(created.id);
      expect(res.body.code).toBe("INFO-Z");
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe(AuditableAction.CLASS_UPDATED);
      expect(events[0].targetId).toBe(created.id);
    });

    it("locks the row of the class with FOR UPDATE before it edits and waits for whoever holds it", async () => {
      const created = await createClass();
      const release = await holdClassRow(created.id);

      const pending = patchClass(created.id, director, { capacity: 20 }).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FROM "classes"/);
      } finally {
        await release();
      }

      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body.capacity).toBe(20);
    });

    it("serializes concurrent edits of the same class: both answer 200 and the last one wins, whole", async () => {
      const created = await createClass();

      const [first, second] = await Promise.all([
        patchClass(created.id, director, { capacity: 20, location: "Sala 2" }),
        patchClass(created.id, coordinator, { capacity: 30, location: "Sala 3" }),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);
      const stored = await storedClass(created.id);
      // The two edits never mix: seats and location come from the same one.
      expect([
        { capacity: 20, location: "Sala 2" },
        { capacity: 30, location: "Sala 3" },
      ]).toContainEqual({ capacity: stored.capacity, location: stored.location });
    });

    it("emits CLASS_UPDATED after the commit with only the fields that changed", async () => {
      const created = await createClass();
      const events = collectEvents();

      await patchClass(created.id, coordinator, {
        code: "INFO-B",
        capacity: 15,
        location: "Sala 2",
        status: "in_progress",
      }).expect(200);

      expect(events).toHaveLength(1);
      expect(events[0].action).toBe(AuditableAction.CLASS_UPDATED);
      expect(events[0].actorId).toBe(coordinator.id);
      expect(events[0].targetType).toBe("class");
      expect(events[0].targetId).toBe(created.id);
      // The capacity was sent but did not change: it is in neither snapshot.
      expect(events[0].before).toEqual({ code: "INFO-A", location: null, status: "planned" });
      expect(events[0].after).toEqual({
        code: "INFO-B",
        location: "Sala 2",
        status: "in_progress",
        changedFields: ["code", "location", "status"],
      });
    });

    it("records the edition in CLASS_UPDATED, by id and by name", async () => {
      const created = await createClass();
      const events = collectEvents();

      const res = await patchClass(created.id, director, { editionName: "2026.2" }).expect(200);

      expect(events[0].before).toEqual({
        editionId: created.edition.id,
        editionName: "2026.1",
      });
      expect(events[0].after).toEqual({
        editionId: res.body.edition.id,
        editionName: "2026.2",
        changedFields: ["editionId", "editionName"],
      });
    });

    it("does not emit when an edit is refused", async () => {
      const created = await createClass();
      await createClass(body({ code: "INFO-B" }));
      const events = collectEvents();

      await patchClass(created.id, director, { capacity: 0 }).expect(400);
      await patchClass(created.id, director, { endDate: "2026-03-02" }).expect(400);
      await patchClass(created.id, director, { code: "INFO-B" }).expect(409);
      await patchClass(created.id, member, { capacity: 20 }).expect(403);
      await patchClass(UNKNOWN_ID, director, { capacity: 20 }).expect(404);

      expect(events).toHaveLength(0);
    });
  });

  describe("PATCH /classes/:id/archive (archiveClass) and /unarchive (unarchiveClass)", () => {
    it("returns 409 CLASS_HAS_ACTIVE_ENROLLMENTS when the class has active enrollments, and leaves it active", async () => {
      const created = await createClass();
      enrollmentCounts.countActive.mockResolvedValue(1);
      const events = collectEvents();

      const res = await archiveClass(created.id, director, { reason: "Turma encerrada." }).expect(
        409,
      );

      expect(res.body.error).toBe("CLASS_HAS_ACTIVE_ENROLLMENTS");
      expect(res.body.message).toBe("A class with active enrollments cannot be archived.");
      expect(enrollmentCounts.countActive).toHaveBeenCalledWith(expect.anything(), created.id);
      expect(await storedClass(created.id)).toMatchObject({
        archived_at: null,
        archived_by_id: null,
        archive_reason: null,
      });
      expect(events).toHaveLength(0);
    });

    it("archives a class without active enrollments: it leaves the default filter, stays in the table and by id, and the edit answers 409", async () => {
      const created = await createClass();
      const other = await createClass(body({ code: "INFO-B" }));

      const res = await archiveClass(created.id, coordinator).expect(200);

      expect(res.body).toEqual({
        ...created,
        archivedAt: expect.any(String),
        archivedById: coordinator.id,
        archiveReason: null,
        updatedAt: expect.any(String),
      });
      // The default listing filters on archived_at IS NULL (docs/ARCHITECTURE.md, section 10.3).
      const visible: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM classes WHERE archived_at IS NULL`,
      );
      expect(visible.map((row) => row.id)).toEqual([other.id]);
      // It is archived, not deleted: the row is still there, found by id, with deleted_at null.
      const stored = await storedClass(created.id);
      expect(stored).toMatchObject({
        code: "INFO-A",
        archived_by_id: coordinator.id,
        deleted_at: null,
      });
      expect(stored.archived_at).not.toBeNull();

      const edit = await patchClass(created.id, director, { capacity: 20 }).expect(409);
      expect(edit.body.error).toBe("CLASS_ARCHIVED");
    });

    it("keeps the status, the period and the course of the class it archives", async () => {
      const created = await createClass(body({ status: "completed" }));

      const res = await archiveClass(created.id, director).expect(200);

      expect(res.body).toMatchObject({
        status: "completed",
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        courseId,
        edition: created.edition,
      });
    });

    it("stores the reason of the archive, and takes a request with no body", async () => {
      const withReason = await createClass();
      const withoutBody = await createClass(body({ code: "INFO-B" }));

      const reason = await archiveClass(withReason.id, director, {
        reason: "  Turma encerrada.  ",
      }).expect(200);
      expect(reason.body.archiveReason).toBe("Turma encerrada.");
      expect(await storedClass(withReason.id)).toMatchObject({
        archive_reason: "Turma encerrada.",
      });

      const bare = await archiveClass(withoutBody.id, director).expect(200);
      expect(bare.body.archiveReason).toBeNull();
      expect(bare.body.archivedById).toBe(director.id);
    });

    it("returns 400 VALIDATION_FAILED when the reason is too long", async () => {
      const created = await createClass();

      const res = await archiveClass(created.id, director, { reason: "r".repeat(501) }).expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(res.body)).toEqual(["reason"]);
      expect(await storedClass(created.id)).toMatchObject({ archived_at: null });
    });

    it("archives with one instant for archivedAt and updatedAt, moves updatedAt forward when it unarchives, and answers with the value of the table", async () => {
      const created = await createClass();

      const archived = await archiveClass(created.id, director).expect(200);
      // One clock for the operation: the instant of the archive is the one of the update, as in the
      // edit, which takes updatedAt from the clock too and not from the table.
      expect(archived.body.updatedAt).toBe(archived.body.archivedAt);
      expect(new Date(archived.body.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
      expect((await storedClass(created.id)).updated_at).toEqual(new Date(archived.body.updatedAt));
      // Compared by the database, in microseconds: a JS Date keeps only milliseconds, and the
      // CURRENT_TIMESTAMP that the table fills by itself would hide in the rounding.
      const same: Array<{ same: boolean }> = await dataSource.query(
        `SELECT updated_at = archived_at AS same FROM classes WHERE id = $1`,
        [created.id],
      );
      expect(same[0].same).toBe(true);

      const unarchived = await unarchiveClass(created.id, director).expect(200);
      expect(new Date(unarchived.body.updatedAt).getTime()).toBeGreaterThan(
        new Date(archived.body.updatedAt).getTime(),
      );
      expect((await storedClass(created.id)).updated_at).toEqual(
        new Date(unarchived.body.updatedAt),
      );
    });

    it("keeps the first archive when archiving twice, and emits one event", async () => {
      const created = await createClass();
      const events = collectEvents();

      const first = await archiveClass(created.id, coordinator, { reason: "Primeira." }).expect(
        200,
      );
      enrollmentCounts.countActive.mockClear();
      const second = await archiveClass(created.id, director, { reason: "Segunda." }).expect(200);

      expect(second.body.archivedAt).toBe(first.body.archivedAt);
      expect(second.body.archivedById).toBe(coordinator.id);
      expect(second.body.archiveReason).toBe("Primeira.");
      // An archived class is not counted again: the second call is a no-op.
      expect(enrollmentCounts.countActive).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe(AuditableAction.CLASS_ARCHIVED);
    });

    it("archives an archived class even while it has enrollments: a no-op, not a refusal", async () => {
      const created = await createClass();
      await archiveClass(created.id, director).expect(200);
      enrollmentCounts.countActive.mockResolvedValue(3);

      await archiveClass(created.id, director).expect(200);
    });

    it("unarchives: the three archive columns go back to null and the class can be edited again", async () => {
      const created = await createClass();
      await archiveClass(created.id, coordinator, { reason: "Turma encerrada." }).expect(200);

      const res = await unarchiveClass(created.id, director).expect(200);

      expect(res.body).toEqual({ ...created, updatedAt: expect.any(String) });
      expect(await storedClass(created.id)).toMatchObject({
        archived_at: null,
        archived_by_id: null,
        archive_reason: null,
      });

      const edit = await patchClass(created.id, director, { capacity: 20 }).expect(200);
      expect(edit.body.capacity).toBe(20);
    });

    it("answers 200 without an event when the class is not archived", async () => {
      const created = await createClass();
      const events = collectEvents();

      const res = await unarchiveClass(created.id, director).expect(200);

      expect(res.body).toEqual(created);
      expect(events).toHaveLength(0);
    });

    it("can archive again after it was unarchived", async () => {
      const created = await createClass();

      await archiveClass(created.id, director, { reason: "Um." }).expect(200);
      await unarchiveClass(created.id, director).expect(200);
      const again = await archiveClass(created.id, director, { reason: "Dois." }).expect(200);

      expect(again.body.archiveReason).toBe("Dois.");
    });

    it("waits for whoever holds the row of the class before it archives", async () => {
      const created = await createClass();
      const release = await holdClassRow(created.id);

      const pending = archiveClass(created.id, director).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FROM "classes"/);
      } finally {
        await release();
      }

      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body.archivedAt).not.toBeNull();
    });

    it("returns 404 CLASS_NOT_FOUND for an unknown id and for a malformed id, in both routes", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const archived = await archiveClass(id, director).expect(404);
        expect(archived.body.error).toBe("CLASS_NOT_FOUND");

        const unarchived = await unarchiveClass(id, director).expect(404);
        expect(unarchived.body.error).toBe("CLASS_NOT_FOUND");
      }
    });

    it("returns 403 FORBIDDEN for a member, and leaves the class as it was", async () => {
      const created = await createClass();

      const archived = await archiveClass(created.id, member).expect(403);
      expect(archived.body.error).toBe("FORBIDDEN");
      expect(await storedClass(created.id)).toMatchObject({ archived_at: null });

      await archiveClass(created.id, director).expect(200);
      const unarchived = await unarchiveClass(created.id, member).expect(403);
      expect(unarchived.body.error).toBe("FORBIDDEN");
      expect((await storedClass(created.id)).archived_at).not.toBeNull();
    });

    it("returns 401 without a session cookie", async () => {
      const created = await createClass();

      await request(app.getHttpServer()).patch(`/classes/${created.id}/archive`).expect(401);
      await request(app.getHttpServer()).patch(`/classes/${created.id}/unarchive`).expect(401);
    });

    it("emits CLASS_ARCHIVED and CLASS_UNARCHIVED after the commit, with what changed", async () => {
      const created = await createClass();
      const events = collectEvents();

      await archiveClass(created.id, coordinator, { reason: "Turma encerrada." }).expect(200);
      await unarchiveClass(created.id, director).expect(200);

      expect(events.map((event) => event.action)).toEqual([
        AuditableAction.CLASS_ARCHIVED,
        AuditableAction.CLASS_UNARCHIVED,
      ]);
      expect(events.map((event) => event.actorId)).toEqual([coordinator.id, director.id]);
      expect(events.every((event) => event.targetType === "class")).toBe(true);
      expect(events.every((event) => event.targetId === created.id)).toBe(true);
      expect(events[0].before).toEqual({ archivedAt: null });
      expect(events[0].after).toEqual({
        archivedAt: expect.any(Date),
        archiveReason: "Turma encerrada.",
      });
      expect(events[1].before).toEqual({
        archivedAt: expect.any(Date),
        archivedById: coordinator.id,
        archiveReason: "Turma encerrada.",
      });
      expect(events[1].after).toEqual({ archivedAt: null });
    });

    it("does not emit when the archive is refused", async () => {
      const created = await createClass();
      const events = collectEvents();
      enrollmentCounts.countActive.mockResolvedValue(2);

      await archiveClass(created.id, director).expect(409);
      await archiveClass(created.id, member).expect(403);
      await archiveClass(UNKNOWN_ID, director).expect(404);
      await archiveClass(created.id, director, { reason: "r".repeat(501) }).expect(400);

      expect(events).toHaveLength(0);
    });
  });

  describe("routes and events", () => {
    it("has no DELETE /classes/:id route", async () => {
      const created = await createClass();

      const res = await request(app.getHttpServer())
        .delete(`/classes/${created.id}`)
        .set("Cookie", coordinator.cookie)
        .expect(404);

      expect(res.body.error).toBe("NOT_FOUND");
      expect(await countRows("classes")).toBe(1);
    });

    it("emits one event per mutation: CREATED, UPDATED, ARCHIVED, UNARCHIVED", async () => {
      const events = collectEvents();

      const created = await createClass();
      await patchClass(created.id, coordinator, { capacity: 20 }).expect(200);
      await archiveClass(created.id, director).expect(200);
      await unarchiveClass(created.id, coordinator).expect(200);

      expect(events.map((event) => event.action)).toEqual([
        AuditableAction.CLASS_CREATED,
        AuditableAction.CLASS_UPDATED,
        AuditableAction.CLASS_ARCHIVED,
        AuditableAction.CLASS_UNARCHIVED,
      ]);
      expect(events.map((event) => event.actorId)).toEqual([
        director.id,
        coordinator.id,
        director.id,
        coordinator.id,
      ]);
    });
  });
});
