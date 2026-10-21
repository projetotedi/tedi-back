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

process.env.JWT_SECRET = "e2e-lesson-plans-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

const PLAN = {
  title: "Teclado, mouse e janelas",
  objective: "Familiarizar o aluno com o teclado, o mouse e o uso básico das janelas.",
  expectedDurationMinutes: 90,
  contents: ["Teclado e mouse", "Janelas do sistema"],
  materialUrl: "https://drive.google.com/file/d/exemplo/view",
};

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

describe("LessonPlansController (e2e)", () => {
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

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    jwtService = module.get(JwtService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      "TRUNCATE TABLE lesson_plan_contents, lesson_plans, people RESTART IDENTITY CASCADE",
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

  async function createPlan(overrides: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post("/lesson-plans")
      .set("Cookie", director.cookie)
      .send({ ...PLAN, ...overrides })
      .expect(201);
    return res.body as Record<string, unknown> & { id: string; contents: string[] };
  }

  function updatePlan(id: string, actor: Actor, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/lesson-plans/${id}`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  function archivePlan(id: string, actor: Actor, body?: Record<string, unknown>) {
    const archiving = request(app.getHttpServer())
      .patch(`/lesson-plans/${id}/archive`)
      .set("Cookie", actor.cookie);
    return body === undefined ? archiving : archiving.send(body);
  }

  function unarchivePlan(id: string, actor: Actor) {
    return request(app.getHttpServer())
      .patch(`/lesson-plans/${id}/unarchive`)
      .set("Cookie", actor.cookie);
  }

  function getPlan(id: string, actor: Actor) {
    return request(app.getHttpServer()).get(`/lesson-plans/${id}`).set("Cookie", actor.cookie);
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  async function countRows(table: "lesson_plans" | "lesson_plan_contents"): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM ${table}`,
    );
    return Number(rows[0].total);
  }

  async function storedContents(
    planId: string,
  ): Promise<Array<{ position: number; text: string }>> {
    return dataSource.query(
      `SELECT position, text FROM lesson_plan_contents WHERE lesson_plan_id = $1 ORDER BY position`,
      [planId],
    );
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

  describe("POST /lesson-plans (createLessonPlan)", () => {
    it("creates 'Teclado, mouse e janelas' with 90 minutes and two contents and returns 201 LessonPlanResponseDto", async () => {
      const res = await request(app.getHttpServer())
        .post("/lesson-plans")
        .set("Cookie", director.cookie)
        .send(PLAN)
        .expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        title: "Teclado, mouse e janelas",
        objective: "Familiarizar o aluno com o teclado, o mouse e o uso básico das janelas.",
        expectedDurationMinutes: 90,
        contents: ["Teclado e mouse", "Janelas do sistema"],
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: director.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const plans: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT title, expected_duration_minutes, created_by_id, archived_at
           FROM lesson_plans WHERE id = $1`,
        [res.body.id],
      );
      expect(plans).toEqual([
        {
          title: "Teclado, mouse e janelas",
          expected_duration_minutes: 90,
          created_by_id: director.id,
          archived_at: null,
        },
      ]);
      expect(await storedContents(res.body.id)).toEqual([
        { position: 0, text: "Teclado e mouse" },
        { position: 1, text: "Janelas do sistema" },
      ]);
    });

    it("creates with only the required fields and answers null for the optional ones", async () => {
      const res = await request(app.getHttpServer())
        .post("/lesson-plans")
        .set("Cookie", director.cookie)
        .send({ title: "Janelas", expectedDurationMinutes: 45, contents: ["Janelas do sistema"] })
        .expect(201);

      expect(res.body).toMatchObject({
        title: "Janelas",
        expectedDurationMinutes: 45,
        contents: ["Janelas do sistema"],
        objective: null,
        materialUrl: null,
      });
    });

    it("keeps the contents in the order sent", async () => {
      const created = await createPlan({ contents: ["Pastas", "Janelas", "Teclado", "Mouse"] });

      expect(created.contents).toEqual(["Pastas", "Janelas", "Teclado", "Mouse"]);
      expect(await storedContents(created.id)).toEqual([
        { position: 0, text: "Pastas" },
        { position: 1, text: "Janelas" },
        { position: 2, text: "Teclado" },
        { position: 3, text: "Mouse" },
      ]);
    });

    it("trims title, objective and contents and treats a blank link as not informed", async () => {
      const created = await createPlan({
        title: "  Janelas  ",
        objective: "  Aprender  ",
        contents: ["  Pastas  ", " Janelas "],
        materialUrl: "   ",
      });

      expect(created).toMatchObject({
        title: "Janelas",
        objective: "Aprender",
        contents: ["Pastas", "Janelas"],
        materialUrl: null,
      });
    });

    it("ignores fields the client has no say in", async () => {
      const created = await createPlan({
        id: UNKNOWN_ID,
        createdById: member.id,
        archivedAt: "2026-01-01T00:00:00.000Z",
        archivedById: member.id,
        archiveReason: "injected",
      });

      expect(created).toMatchObject({
        createdById: director.id,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });
      expect(created.id).not.toBe(UNKNOWN_ID);
    });

    it("returns 400 VALIDATION_FAILED with field title when title is missing or blank", async () => {
      const { title: _title, ...withoutTitle } = PLAN;

      for (const body of [withoutTitle, { ...PLAN, title: "   " }, { ...PLAN, title: null }]) {
        const res = await request(app.getHttpServer())
          .post("/lesson-plans")
          .set("Cookie", director.cookie)
          .send(body)
          .expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["title"]);
      }
      expect(await countRows("lesson_plans")).toBe(0);
    });

    it("returns 400 VALIDATION_FAILED with field expectedDurationMinutes when the duration is missing, zero or negative", async () => {
      const { expectedDurationMinutes: _duration, ...withoutDuration } = PLAN;

      for (const body of [
        withoutDuration,
        { ...PLAN, expectedDurationMinutes: 0 },
        { ...PLAN, expectedDurationMinutes: -30 },
        { ...PLAN, expectedDurationMinutes: 90.5 },
        { ...PLAN, expectedDurationMinutes: "90" },
        { ...PLAN, expectedDurationMinutes: 99999999999 },
      ]) {
        const res = await request(app.getHttpServer())
          .post("/lesson-plans")
          .set("Cookie", director.cookie)
          .send(body)
          .expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["expectedDurationMinutes"]);
      }
      expect(await countRows("lesson_plans")).toBe(0);
    });

    it("returns 400 VALIDATION_FAILED with field materialUrl when the link is not a valid http or https URL", async () => {
      for (const materialUrl of [
        "not a url",
        "drive.google.com/file/d/exemplo/view",
        "ftp://example.com/material.pdf",
        "javascript:alert(1)",
      ]) {
        const res = await request(app.getHttpServer())
          .post("/lesson-plans")
          .set("Cookie", director.cookie)
          .send({ ...PLAN, materialUrl })
          .expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["materialUrl"]);
      }
      expect(await countRows("lesson_plans")).toBe(0);
    });

    it("returns 400 VALIDATION_FAILED with field contents when the list is missing, empty or has a blank item", async () => {
      const { contents: _contents, ...withoutContents } = PLAN;

      for (const body of [
        withoutContents,
        { ...PLAN, contents: [] },
        { ...PLAN, contents: ["Teclado e mouse", "   "] },
        { ...PLAN, contents: "Teclado e mouse" },
      ]) {
        const res = await request(app.getHttpServer())
          .post("/lesson-plans")
          .set("Cookie", director.cookie)
          .send(body)
          .expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["contents"]);
      }
      expect(await countRows("lesson_plans")).toBe(0);
      expect(await countRows("lesson_plan_contents")).toBe(0);
    });

    it("reports every invalid field at once", async () => {
      const res = await request(app.getHttpServer())
        .post("/lesson-plans")
        .set("Cookie", director.cookie)
        .send({ title: "", expectedDurationMinutes: 0, contents: [], materialUrl: "nope" })
        .expect(400);

      expect(fieldsOf(res.body)).toEqual([
        "contents",
        "expectedDurationMinutes",
        "materialUrl",
        "title",
      ]);
    });

    it("returns 201 for a coordinator", async () => {
      const res = await request(app.getHttpServer())
        .post("/lesson-plans")
        .set("Cookie", coordinator.cookie)
        .send(PLAN)
        .expect(201);

      expect(res.body.createdById).toBe(coordinator.id);
    });

    it("returns 403 FORBIDDEN for a member and creates nothing", async () => {
      const res = await request(app.getHttpServer())
        .post("/lesson-plans")
        .set("Cookie", member.cookie)
        .send(PLAN)
        .expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect(await countRows("lesson_plans")).toBe(0);
      expect(await countRows("lesson_plan_contents")).toBe(0);

      await request(app.getHttpServer())
        .post("/lesson-plans")
        .set("Cookie", member.cookie)
        .send({ title: "" })
        .expect(403);
    });

    it("returns 401 without a session cookie", async () => {
      await request(app.getHttpServer()).post("/lesson-plans").send(PLAN).expect(401);
    });

    it("emits LESSON_PLAN_CREATED with the plan and its contents", async () => {
      const events = collectEvents();

      const created = await createPlan();

      expect(events).toHaveLength(1);
      expect(events[0].action).toBe(AuditableAction.LESSON_PLAN_CREATED);
      expect(events[0].actorId).toBe(director.id);
      expect(events[0].targetType).toBe("lesson_plan");
      expect(events[0].targetId).toBe(created.id);
      expect(events[0].before).toBeNull();
      expect(events[0].after).toEqual({
        title: "Teclado, mouse e janelas",
        objective: "Familiarizar o aluno com o teclado, o mouse e o uso básico das janelas.",
        expectedDurationMinutes: 90,
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        contents: ["Teclado e mouse", "Janelas do sistema"],
      });
    });
  });

  describe("GET /lesson-plans/:id (getLessonPlan)", () => {
    it("returns the plan with the contents in order for a director, a coordinator and a member", async () => {
      const created = await createPlan({ contents: ["Pastas", "Janelas", "Teclado"] });

      for (const actor of [director, coordinator, member]) {
        const res = await getPlan(created.id, actor).expect(200);

        expect(res.body).toEqual({ ...created, contents: ["Pastas", "Janelas", "Teclado"] });
      }
    });

    it("keeps an archived plan readable with the archive data", async () => {
      const created = await createPlan();
      await archivePlan(created.id, coordinator, { reason: "Conteúdo revisado." }).expect(200);

      const res = await getPlan(created.id, member).expect(200);

      expect(res.body).toMatchObject({
        id: created.id,
        title: "Teclado, mouse e janelas",
        contents: ["Teclado e mouse", "Janelas do sistema"],
        archivedAt: expect.any(String),
        archivedById: coordinator.id,
        archiveReason: "Conteúdo revisado.",
      });
    });

    it("returns 404 LESSON_PLAN_NOT_FOUND for an unknown id and for a malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await getPlan(id, director).expect(404);

        expect(res.body.error).toBe("LESSON_PLAN_NOT_FOUND");
        expect(res.body.message).toBe("Lesson plan not found.");
      }
    });

    it("returns 401 without a session cookie", async () => {
      const created = await createPlan();

      await request(app.getHttpServer()).get(`/lesson-plans/${created.id}`).expect(401);
    });
  });

  describe("PATCH /lesson-plans/:id (updateLessonPlan)", () => {
    it("changes the duration from 90 to 120 and returns 200 with the new value", async () => {
      const created = await createPlan();
      expect(created.expectedDurationMinutes).toBe(90);

      const res = await updatePlan(created.id, director, { expectedDurationMinutes: 120 }).expect(
        200,
      );

      expect(res.body).toMatchObject({
        id: created.id,
        expectedDurationMinutes: 120,
        title: "Teclado, mouse e janelas",
        objective: "Familiarizar o aluno com o teclado, o mouse e o uso básico das janelas.",
        contents: ["Teclado e mouse", "Janelas do sistema"],
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        createdById: director.id,
      });
      const rows: Array<{ expected_duration_minutes: number }> = await dataSource.query(
        `SELECT expected_duration_minutes FROM lesson_plans WHERE id = $1`,
        [created.id],
      );
      expect(rows).toEqual([{ expected_duration_minutes: 120 }]);
      expect((await getPlan(created.id, member).expect(200)).body.expectedDurationMinutes).toBe(
        120,
      );
    });

    it("updates the fields sent and clears objective and materialUrl sent as null", async () => {
      const created = await createPlan();

      const res = await updatePlan(created.id, coordinator, {
        title: "Janelas e pastas",
        objective: null,
        materialUrl: null,
      }).expect(200);

      expect(res.body).toMatchObject({
        title: "Janelas e pastas",
        objective: null,
        materialUrl: null,
        expectedDurationMinutes: 90,
        contents: ["Teclado e mouse", "Janelas do sistema"],
      });
    });

    it("replaces the whole list of contents and removes the old rows", async () => {
      const created = await createPlan({ contents: ["Pastas", "Janelas", "Teclado"] });

      const res = await updatePlan(created.id, director, {
        contents: ["Mouse", "Teclado"],
      }).expect(200);

      expect(res.body.contents).toEqual(["Mouse", "Teclado"]);
      expect(await storedContents(created.id)).toEqual([
        { position: 0, text: "Mouse" },
        { position: 1, text: "Teclado" },
      ]);
      expect(await countRows("lesson_plan_contents")).toBe(2);

      const longer = await updatePlan(created.id, director, {
        contents: ["A", "B", "C", "D"],
      }).expect(200);
      expect(longer.body.contents).toEqual(["A", "B", "C", "D"]);
      expect(await countRows("lesson_plan_contents")).toBe(4);
    });

    it("reorders the contents when the same texts come in another order", async () => {
      const created = await createPlan();

      const res = await updatePlan(created.id, director, {
        contents: ["Janelas do sistema", "Teclado e mouse"],
      }).expect(200);

      expect(res.body.contents).toEqual(["Janelas do sistema", "Teclado e mouse"]);
      expect((await getPlan(created.id, director).expect(200)).body.contents).toEqual([
        "Janelas do sistema",
        "Teclado e mouse",
      ]);
    });

    it("moves updatedAt forward when only the contents change", async () => {
      const created = await createPlan();

      const res = await updatePlan(created.id, director, { contents: ["Pastas"] }).expect(200);

      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt as string).getTime(),
      );
      expect(res.body.createdAt).toBe(created.createdAt);
      const rows: Array<{ updated_at: Date }> = await dataSource.query(
        `SELECT updated_at FROM lesson_plans WHERE id = $1`,
        [created.id],
      );
      expect(rows[0].updated_at.toISOString()).toBe(res.body.updatedAt);
    });

    it("answers 200 without changing anything or emitting an event when nothing changed", async () => {
      const created = await createPlan();
      const events = collectEvents();

      const same = await updatePlan(created.id, director, {
        title: "Teclado, mouse e janelas",
        expectedDurationMinutes: 90,
        contents: ["Teclado e mouse", "Janelas do sistema"],
      }).expect(200);
      const empty = await updatePlan(created.id, director, {}).expect(200);

      expect(same.body).toEqual(created);
      expect(empty.body).toEqual(created);
      expect(events).toHaveLength(0);
    });

    it("returns 400 VALIDATION_FAILED when title, duration or contents are null or invalid", async () => {
      const created = await createPlan();

      const nulls = await updatePlan(created.id, director, {
        title: null,
        expectedDurationMinutes: null,
        contents: null,
      }).expect(400);
      expect(nulls.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(nulls.body)).toEqual(["contents", "expectedDurationMinutes", "title"]);

      for (const [field, body] of [
        ["expectedDurationMinutes", { expectedDurationMinutes: 0 }],
        ["expectedDurationMinutes", { expectedDurationMinutes: -5 }],
        ["contents", { contents: [] }],
        ["contents", { contents: ["Teclado", " "] }],
        ["title", { title: "   " }],
        ["materialUrl", { materialUrl: "not a url" }],
      ] as const) {
        const res = await updatePlan(created.id, director, body).expect(400);

        expect(fieldsOf(res.body)).toEqual([field]);
      }

      expect((await getPlan(created.id, director).expect(200)).body).toEqual(created);
    });

    it("returns 409 LESSON_PLAN_ARCHIVED for an archived plan and changes nothing", async () => {
      const created = await createPlan();
      await archivePlan(created.id, coordinator).expect(200);

      const res = await updatePlan(created.id, director, {
        expectedDurationMinutes: 120,
        contents: ["Novo"],
      }).expect(409);

      expect(res.body.error).toBe("LESSON_PLAN_ARCHIVED");
      const stored = (await getPlan(created.id, director).expect(200)).body;
      expect(stored.expectedDurationMinutes).toBe(90);
      expect(stored.contents).toEqual(["Teclado e mouse", "Janelas do sistema"]);
    });

    it("returns 404 LESSON_PLAN_NOT_FOUND for an unknown id and for a malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await updatePlan(id, director, { title: "Outro" }).expect(404);

        expect(res.body.error).toBe("LESSON_PLAN_NOT_FOUND");
      }
    });

    it("returns 403 FORBIDDEN for a member", async () => {
      const created = await createPlan();

      const res = await updatePlan(created.id, member, { expectedDurationMinutes: 120 }).expect(
        403,
      );
      expect(res.body.error).toBe("FORBIDDEN");
      await updatePlan(created.id, member, { title: null }).expect(403);

      expect((await getPlan(created.id, director).expect(200)).body.expectedDurationMinutes).toBe(
        90,
      );
    });

    it("locks the plan row with FOR UPDATE before it edits and waits for whoever holds it", async () => {
      const created = await createPlan();
      const holder = dataSource.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query(`SELECT id FROM lesson_plans WHERE id = $1 FOR UPDATE`, [created.id]);

      const pending = updatePlan(created.id, director, { expectedDurationMinutes: 120 }).then(
        (res) => res,
      );

      try {
        expect(await blockedStatement()).toMatch(/FOR UPDATE/);
      } finally {
        await holder.commitTransaction();
        await holder.release();
      }

      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body.expectedDurationMinutes).toBe(120);
    });

    it("serializes concurrent edits of the same plan: one of the two lists wins, whole", async () => {
      const created = await createPlan({ contents: ["Pastas", "Janelas", "Teclado"] });

      const [first, second] = await Promise.all([
        updatePlan(created.id, director, { contents: ["A1", "A2", "A3", "A4"] }),
        updatePlan(created.id, coordinator, { contents: ["B1", "B2"] }),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);
      const stored = await storedContents(created.id);
      expect([
        ["A1", "A2", "A3", "A4"],
        ["B1", "B2"],
      ]).toContainEqual(stored.map((row) => row.text));
      expect(stored.map((row) => row.position)).toEqual(stored.map((_, index) => index));
      expect(await countRows("lesson_plan_contents")).toBe(stored.length);
    });
  });

  describe("PATCH /lesson-plans/:id/archive (archiveLessonPlan)", () => {
    it("archives with a reason and returns 200 for a coordinator", async () => {
      const created = await createPlan();

      const res = await archivePlan(created.id, coordinator, {
        reason: "Conteúdo revisado.",
      }).expect(200);

      expect(res.body).toMatchObject({
        id: created.id,
        archivedAt: expect.any(String),
        archivedById: coordinator.id,
        archiveReason: "Conteúdo revisado.",
        contents: ["Teclado e mouse", "Janelas do sistema"],
      });
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT archived_at IS NOT NULL AS archived, archived_by_id, archive_reason
           FROM lesson_plans WHERE id = $1`,
        [created.id],
      );
      expect(rows).toEqual([
        { archived: true, archived_by_id: coordinator.id, archive_reason: "Conteúdo revisado." },
      ]);
    });

    it("archives without a body and returns 200 for a director", async () => {
      const created = await createPlan();

      const res = await archivePlan(created.id, director).expect(200);

      expect(res.body.archivedAt).toEqual(expect.any(String));
      expect(res.body.archivedById).toBe(director.id);
      expect(res.body.archiveReason).toBeNull();
    });

    it("keeps the plan accessible by id after it is archived", async () => {
      const created = await createPlan();
      await archivePlan(created.id, director).expect(200);

      const res = await getPlan(created.id, director).expect(200);

      expect(res.body.id).toBe(created.id);
      expect(res.body.archivedAt).toEqual(expect.any(String));
    });

    it("keeps the first archive when archiving twice and emits one event", async () => {
      const created = await createPlan();
      const events = collectEvents();

      const first = await archivePlan(created.id, coordinator, { reason: "first" }).expect(200);
      const second = await archivePlan(created.id, director, { reason: "second" }).expect(200);

      expect(second.body.archivedAt).toBe(first.body.archivedAt);
      expect(second.body.archivedById).toBe(coordinator.id);
      expect(second.body.archiveReason).toBe("first");
      expect(events.filter((e) => e.action === AuditableAction.LESSON_PLAN_ARCHIVED)).toHaveLength(
        1,
      );
    });

    it("returns 400 when the reason is too long", async () => {
      const created = await createPlan();

      const res = await archivePlan(created.id, coordinator, { reason: "a".repeat(501) }).expect(
        400,
      );

      expect(fieldsOf(res.body)).toEqual(["reason"]);
    });

    it("returns 404 LESSON_PLAN_NOT_FOUND for an unknown id and for a malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await archivePlan(id, coordinator, {}).expect(404);

        expect(res.body.error).toBe("LESSON_PLAN_NOT_FOUND");
      }
    });

    it("returns 403 FORBIDDEN for a member and leaves the plan active", async () => {
      const created = await createPlan();

      const res = await archivePlan(created.id, member, {}).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      const rows: Array<{ archived_at: Date | null }> = await dataSource.query(
        `SELECT archived_at FROM lesson_plans WHERE id = $1`,
        [created.id],
      );
      expect(rows[0].archived_at).toBeNull();
    });
  });

  describe("PATCH /lesson-plans/:id/unarchive (unarchiveLessonPlan)", () => {
    it("unarchives and returns 200 for a coordinator and a director, and the plan is editable again", async () => {
      for (const actor of [coordinator, director]) {
        const created = await createPlan();
        await archivePlan(created.id, director, { reason: "Conteúdo revisado." }).expect(200);

        const res = await unarchivePlan(created.id, actor).expect(200);

        expect(res.body).toMatchObject({
          id: created.id,
          archivedAt: null,
          archivedById: null,
          archiveReason: null,
          contents: ["Teclado e mouse", "Janelas do sistema"],
        });
        const rows: Array<Record<string, unknown>> = await dataSource.query(
          `SELECT archived_at, archived_by_id, archive_reason FROM lesson_plans WHERE id = $1`,
          [created.id],
        );
        expect(rows).toEqual([{ archived_at: null, archived_by_id: null, archive_reason: null }]);

        await updatePlan(created.id, director, { expectedDurationMinutes: 120 }).expect(200);
      }
    });

    it("answers 200 without an event when the plan is not archived", async () => {
      const created = await createPlan();
      const events = collectEvents();

      const res = await unarchivePlan(created.id, coordinator).expect(200);

      expect(res.body.archivedAt).toBeNull();
      expect(events).toHaveLength(0);
    });

    it("returns 404 LESSON_PLAN_NOT_FOUND for an unknown id", async () => {
      const res = await unarchivePlan(UNKNOWN_ID, coordinator).expect(404);

      expect(res.body.error).toBe("LESSON_PLAN_NOT_FOUND");
    });

    it("returns 403 FORBIDDEN for a member and keeps the plan archived", async () => {
      const created = await createPlan();
      await archivePlan(created.id, director).expect(200);

      const res = await unarchivePlan(created.id, member).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect((await getPlan(created.id, director).expect(200)).body.archivedAt).toEqual(
        expect.any(String),
      );
    });
  });

  describe("routes and events", () => {
    it("has no DELETE /lesson-plans/:id route", async () => {
      const created = await createPlan();

      const res = await request(app.getHttpServer())
        .delete(`/lesson-plans/${created.id}`)
        .set("Cookie", coordinator.cookie)
        .expect(404);

      expect(res.body.error).toBe("NOT_FOUND");
      expect(await countRows("lesson_plans")).toBe(1);
    });

    it("emits one event per mutation: CREATED, UPDATED, ARCHIVED, UNARCHIVED", async () => {
      const events = collectEvents();

      const created = await createPlan();
      await updatePlan(created.id, director, {
        expectedDurationMinutes: 120,
        contents: ["Pastas"],
      }).expect(200);
      await archivePlan(created.id, coordinator, { reason: "Conteúdo revisado." }).expect(200);
      await unarchivePlan(created.id, coordinator).expect(200);

      expect(events.map((event) => event.action)).toEqual([
        AuditableAction.LESSON_PLAN_CREATED,
        AuditableAction.LESSON_PLAN_UPDATED,
        AuditableAction.LESSON_PLAN_ARCHIVED,
        AuditableAction.LESSON_PLAN_UNARCHIVED,
      ]);
      expect(events.map((event) => event.actorId)).toEqual([
        director.id,
        director.id,
        coordinator.id,
        coordinator.id,
      ]);
      expect(events.every((event) => event.targetType === "lesson_plan")).toBe(true);
      expect(events.every((event) => event.targetId === created.id)).toBe(true);
      expect(events[1].before).toEqual({
        expectedDurationMinutes: 90,
        contents: ["Teclado e mouse", "Janelas do sistema"],
      });
      expect(events[1].after).toEqual({
        expectedDurationMinutes: 120,
        contents: ["Pastas"],
        changedFields: ["expectedDurationMinutes", "contents"],
      });
      expect(events[2].before).toEqual({ archivedAt: null });
      expect(events[2].after).toEqual({
        archivedAt: expect.any(Date),
        archiveReason: "Conteúdo revisado.",
      });
      expect(events[3].before).toEqual({
        archivedAt: expect.any(Date),
        archivedById: coordinator.id,
        archiveReason: "Conteúdo revisado.",
      });
      expect(events[3].after).toEqual({ archivedAt: null });
    });
  });
});
