import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
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

process.env.JWT_SECRET = "e2e-lesson-plan-duplicate-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const PLAN = {
  title: "Teclado, mouse e janelas",
  objective: "Familiarizar o aluno com o teclado, o mouse e o uso básico das janelas.",
  expectedDurationMinutes: 90,
  contents: ["Teclado e mouse", "Janelas do sistema"],
  materialUrl: "https://drive.google.com/file/d/exemplo/view",
};

const COPY_TITLE = "Teclado, mouse e janelas (cópia)";

interface Actor {
  id: string;
  cookie: string;
}

interface PlanBody {
  id: string;
  title: string;
  objective: string | null;
  expectedDurationMinutes: number;
  contents: string[];
  materialUrl: string | null;
  archivedAt: string | null;
  archivedById: string | null;
  archiveReason: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

interface CourseBody {
  id: string;
  name: string;
}

interface DetailBody {
  id: string;
  status: string;
  createdBy: { id: string; name: string } | null;
  archivedAt: string | null;
  usedIn: Array<{ courseId: string; courseName: string; position: number }>;
}

interface SequenceBody {
  courseId: string;
  items: Array<{ position: number; lessonPlanId: string; courseCount: number }>;
}

/**
 * The scenario of the card: `original` ("Teclado, mouse e janelas", 90 minutes, 2 contents) is in the
 * sequence of 2 courses, alongside `other`.
 */
interface Scenario {
  original: PlanBody;
  other: PlanBody;
  courseA: CourseBody;
  courseB: CourseBody;
}

describe("Lesson plan duplicate (e2e)", () => {
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
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      "TRUNCATE TABLE course_lesson_plans, course_prerequisites, courses, lesson_plan_contents, lesson_plans, people RESTART IDENTITY CASCADE",
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

  /** Creates a plan. A field of `overrides` set to `undefined` is left out of the body. */
  async function createPlan(
    overrides: Record<string, unknown> = {},
    actor: Actor = director,
  ): Promise<PlanBody> {
    const res = await request(app.getHttpServer())
      .post("/lesson-plans")
      .set("Cookie", actor.cookie)
      .send({ ...PLAN, ...overrides })
      .expect(201);
    return res.body as PlanBody;
  }

  async function createCourse(name: string): Promise<CourseBody> {
    const res = await request(app.getHttpServer())
      .post("/courses")
      .set("Cookie", director.cookie)
      .send({ name, description: `Descrição de ${name}.`, category: "basic" })
      .expect(201);
    return res.body as CourseBody;
  }

  /** Puts the sequence of the course, expecting 200. */
  async function setSequence(courseId: string, lessonPlanIds: string[]): Promise<void> {
    await request(app.getHttpServer())
      .put(`/courses/${courseId}/lesson-plans`)
      .set("Cookie", director.cookie)
      .send({ lessonPlanIds })
      .expect(200);
  }

  /** The scenario of the card: see `Scenario`. */
  async function createScenario(): Promise<Scenario> {
    const original = await createPlan();
    const other = await createPlan({
      title: "Pastas e arquivos",
      expectedDurationMinutes: 60,
      contents: ["Pastas"],
    });
    const courseA = await createCourse("Curso A");
    const courseB = await createCourse("Curso B");

    await setSequence(courseA.id, [original.id, other.id]);
    await setSequence(courseB.id, [other.id, original.id]);

    return { original, other, courseA, courseB };
  }

  function duplicatePlan(id: string, actor: Actor = director) {
    return request(app.getHttpServer())
      .post(`/lesson-plans/${id}/duplicate`)
      .set("Cookie", actor.cookie);
  }

  function getDetail(id: string, actor: Actor = director) {
    return request(app.getHttpServer()).get(`/lesson-plans/${id}`).set("Cookie", actor.cookie);
  }

  function getSequence(courseId: string, actor: Actor = director) {
    return request(app.getHttpServer())
      .get(`/courses/${courseId}/lesson-plans`)
      .set("Cookie", actor.cookie);
  }

  function updatePlan(id: string, body: Record<string, unknown>, actor: Actor = director) {
    return request(app.getHttpServer())
      .patch(`/lesson-plans/${id}`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  function archivePlan(id: string, reason: string) {
    return request(app.getHttpServer())
      .patch(`/lesson-plans/${id}/archive`)
      .set("Cookie", coordinator.cookie)
      .send({ reason })
      .expect(200);
  }

  async function softDeletePlan(id: string): Promise<void> {
    await dataSource.query(`UPDATE lesson_plans SET deleted_at = now() WHERE id = $1`, [id]);
  }

  async function storedContents(
    planId: string,
  ): Promise<Array<{ position: number; text: string }>> {
    return dataSource.query(
      `SELECT position, text FROM lesson_plan_contents WHERE lesson_plan_id = $1 ORDER BY position`,
      [planId],
    );
  }

  async function storedTitle(planId: string): Promise<string> {
    const rows: Array<{ title: string }> = await dataSource.query(
      `SELECT title FROM lesson_plans WHERE id = $1`,
      [planId],
    );
    return rows[0].title;
  }

  async function countRows(
    table: "lesson_plans" | "lesson_plan_contents" | "course_lesson_plans",
  ): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM ${table}`,
    );
    return Number(rows[0].total);
  }

  /** Rows of course_lesson_plans of the plan, soft-deleted ones included. */
  async function countLinks(lessonPlanId: string): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM course_lesson_plans WHERE lesson_plan_id = $1`,
      [lessonPlanId],
    );
    return Number(rows[0].total);
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
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

  describe("POST /lesson-plans/:id/duplicate (duplicateLessonPlan)", () => {
    it("duplicates 'Teclado, mouse e janelas' used in 2 courses: 201 with ' (cópia)', the 2 contents and no course", async () => {
      const { original, other, courseA, courseB } = await createScenario();

      const res = await duplicatePlan(original.id).expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        title: COPY_TITLE,
        objective: PLAN.objective,
        expectedDurationMinutes: 90,
        contents: ["Teclado e mouse", "Janelas do sistema"],
        materialUrl: PLAN.materialUrl,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: director.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      const copy = res.body as PlanBody;
      expect(copy.id).not.toBe(original.id);

      // The copy is born unused: the detail says so, no row links it to a course, and it is in no sequence.
      const detail = (await getDetail(copy.id).expect(200)).body as DetailBody;
      expect(detail.status).toBe("unused");
      expect(detail.usedIn).toEqual([]);
      expect(await countLinks(copy.id)).toBe(0);
      for (const course of [courseA, courseB]) {
        const sequence = (await getSequence(course.id).expect(200)).body as SequenceBody;

        expect(sequence.items.map((item) => item.lessonPlanId)).not.toContain(copy.id);
      }
      expect(
        ((await getSequence(courseA.id).expect(200)).body as SequenceBody).items.map(
          (item) => item.lessonPlanId,
        ),
      ).toEqual([original.id, other.id]);

      expect(await storedTitle(copy.id)).toBe(COPY_TITLE);
      expect(await storedContents(copy.id)).toEqual([
        { position: 0, text: "Teclado e mouse" },
        { position: 1, text: "Janelas do sistema" },
      ]);
    });

    it("keeps the original in its 2 courses and unchanged", async () => {
      const { original, courseA, courseB } = await createScenario();
      const detailBefore = (await getDetail(original.id).expect(200)).body as DetailBody;
      const contentsBefore = await storedContents(original.id);

      await duplicatePlan(original.id).expect(201);

      const detailAfter = (await getDetail(original.id).expect(200)).body as DetailBody;
      expect(detailAfter).toEqual(detailBefore);
      expect(detailAfter.status).toBe("in_use");
      expect(detailAfter.usedIn.map((item) => item.courseId)).toEqual([courseA.id, courseB.id]);
      for (const course of [courseA, courseB]) {
        const sequence = (await getSequence(course.id).expect(200)).body as SequenceBody;
        const item = sequence.items.find((candidate) => candidate.lessonPlanId === original.id);

        expect(item?.courseCount).toBe(2);
      }
      expect(await storedContents(original.id)).toEqual(contentsBefore);
      expect(await storedTitle(original.id)).toBe(PLAN.title);
    });

    it("copies four contents in the same order, the duration and the material, and stores positions 0..3", async () => {
      const contents = ["Pastas", "Janelas", "Teclado", "Mouse"];
      const original = await createPlan({
        contents,
        expectedDurationMinutes: 75,
        materialUrl: "https://example.com/material",
      });

      const res = await duplicatePlan(original.id).expect(201);

      expect(res.body).toMatchObject({
        contents,
        expectedDurationMinutes: 75,
        materialUrl: "https://example.com/material",
        objective: PLAN.objective,
      });
      const stored = [
        { position: 0, text: "Pastas" },
        { position: 1, text: "Janelas" },
        { position: 2, text: "Teclado" },
        { position: 3, text: "Mouse" },
      ];
      expect(await storedContents((res.body as PlanBody).id)).toEqual(stored);
      expect(await storedContents(original.id)).toEqual(stored);
    });

    it("copies a null objective and a null material as null", async () => {
      const original = await createPlan({ objective: undefined, materialUrl: undefined });
      expect(original).toMatchObject({ objective: null, materialUrl: null });

      const res = await duplicatePlan(original.id).expect(201);

      expect(res.body).toMatchObject({
        title: COPY_TITLE,
        objective: null,
        materialUrl: null,
        expectedDurationMinutes: 90,
        contents: PLAN.contents,
      });
      const rows: Array<{ objective: string | null; material_url: string | null }> =
        await dataSource.query(`SELECT objective, material_url FROM lesson_plans WHERE id = $1`, [
          (res.body as PlanBody).id,
        ]);
      expect(rows).toEqual([{ objective: null, material_url: null }]);
    });

    it("duplicates an archived plan and the copy is born active and editable", async () => {
      const original = await createPlan();
      await archivePlan(original.id, "Conteúdo revisado.");

      const res = await duplicatePlan(original.id).expect(201);

      expect(res.body).toMatchObject({
        title: COPY_TITLE,
        contents: PLAN.contents,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });
      const copy = res.body as PlanBody;

      // Active means editable: an archived plan answers 409 LESSON_PLAN_ARCHIVED on PATCH.
      const edited = await updatePlan(copy.id, {
        expectedDurationMinutes: 120,
        contents: ["Novo conteúdo"],
      }).expect(200);
      expect(edited.body).toMatchObject({
        expectedDurationMinutes: 120,
        contents: ["Novo conteúdo"],
        archivedAt: null,
      });

      // The original is still archived, and editing the copy did not touch it.
      const detail = (await getDetail(original.id).expect(200)).body as DetailBody & PlanBody;
      expect(detail.archivedAt).toEqual(expect.any(String));
      expect(detail.archivedById).toBe(coordinator.id);
      expect(detail.archiveReason).toBe("Conteúdo revisado.");
      expect(detail.expectedDurationMinutes).toBe(90);
      expect(detail.contents).toEqual(PLAN.contents);
    });

    it("sets createdById to whoever duplicated, not to the creator of the original", async () => {
      const original = await createPlan({}, director);

      const res = await duplicatePlan(original.id, coordinator).expect(201);

      expect((res.body as PlanBody).createdById).toBe(coordinator.id);
      const copyDetail = (await getDetail((res.body as PlanBody).id).expect(200))
        .body as DetailBody;
      expect(copyDetail.createdBy).toEqual({ id: coordinator.id, name: "Coordinator" });
      const originalDetail = (await getDetail(original.id).expect(200)).body as DetailBody;
      expect(originalDetail.createdBy).toEqual({ id: director.id, name: "Director" });
    });

    it("truncates a 200-character title to 192 characters plus ' (cópia)'", async () => {
      const original = await createPlan({ title: "t".repeat(200) });

      const res = await duplicatePlan(original.id).expect(201);

      const expected = `${"t".repeat(192)} (cópia)`;
      expect(expected).toHaveLength(200);
      expect((res.body as PlanBody).title).toBe(expected);
      expect(await storedTitle((res.body as PlanBody).id)).toBe(expected);
      expect(await storedTitle(original.id)).toBe("t".repeat(200));
    });

    it("duplicating the copy appends the suffix again", async () => {
      const original = await createPlan();

      const first = (await duplicatePlan(original.id).expect(201)).body as PlanBody;
      const second = (await duplicatePlan(first.id).expect(201)).body as PlanBody;

      expect(first.title).toBe("Teclado, mouse e janelas (cópia)");
      expect(second.title).toBe("Teclado, mouse e janelas (cópia) (cópia)");
      expect(second.contents).toEqual(PLAN.contents);
      expect(await countRows("lesson_plans")).toBe(3);
      expect(await countRows("lesson_plan_contents")).toBe(6);
    });

    it("finds the source by an id in upper case and emits the id stored in the database", async () => {
      const original = await createPlan();
      const events = collectEvents();

      const res = await duplicatePlan(original.id.toUpperCase()).expect(201);

      expect(res.body).toMatchObject({ title: COPY_TITLE, contents: PLAN.contents });
      expect(events).toHaveLength(1);
      expect(events[0].targetId).toBe((res.body as PlanBody).id);
      expect(events[0].after.sourceLessonPlanId).toBe(original.id);
    });

    it("emits one LESSON_PLAN_DUPLICATED with sourceLessonPlanId and no LESSON_PLAN_CREATED", async () => {
      const original = await createPlan();
      const events = collectEvents();

      const res = await duplicatePlan(original.id, coordinator).expect(201);

      expect(events.map((event) => event.action)).toEqual([AuditableAction.LESSON_PLAN_DUPLICATED]);
      expect(events[0]).toMatchObject({
        actorId: coordinator.id,
        action: AuditableAction.LESSON_PLAN_DUPLICATED,
        targetType: "lesson_plan",
        targetId: (res.body as PlanBody).id,
        before: null,
        after: {
          sourceLessonPlanId: original.id,
          title: COPY_TITLE,
          objective: PLAN.objective,
          expectedDurationMinutes: 90,
          materialUrl: PLAN.materialUrl,
          contents: PLAN.contents,
        },
        occurredAt: expect.any(Date),
      });
    });

    it("returns 201 for a director and a coordinator", async () => {
      const original = await createPlan();

      await duplicatePlan(original.id, director).expect(201);
      await duplicatePlan(original.id, coordinator).expect(201);

      expect(await countRows("lesson_plans")).toBe(3);
    });

    it("lets two duplications of the same source run at the same time, each with its own copy", async () => {
      const original = await createPlan();

      const [first, second] = await Promise.all([
        duplicatePlan(original.id, director),
        duplicatePlan(original.id, coordinator),
      ]);

      // The source is locked FOR SHARE, which does not conflict with itself, and each duplication
      // writes only its own rows: both answer 201, with a copy and its contents each.
      expect([first.status, second.status]).toEqual([201, 201]);
      expect((first.body as PlanBody).id).not.toBe((second.body as PlanBody).id);
      expect(await countRows("lesson_plans")).toBe(3);
      expect(await countRows("lesson_plan_contents")).toBe(6);
    });

    it("returns 403 FORBIDDEN for a member and creates nothing", async () => {
      const original = await createPlan();
      const plansBefore = await countRows("lesson_plans");
      const contentsBefore = await countRows("lesson_plan_contents");
      const events = collectEvents();

      const res = await duplicatePlan(original.id, member).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect(await countRows("lesson_plans")).toBe(plansBefore);
      expect(await countRows("lesson_plan_contents")).toBe(contentsBefore);
      expect(events).toEqual([]);
    });

    it("returns 404 LESSON_PLAN_NOT_FOUND for an unknown, a malformed and a soft-deleted id", async () => {
      const deleted = await createPlan({ title: "Excluído" });
      await softDeletePlan(deleted.id);
      const plansBefore = await countRows("lesson_plans");
      const contentsBefore = await countRows("lesson_plan_contents");
      const events = collectEvents();

      for (const id of [randomUUID(), "not-a-uuid", deleted.id]) {
        const res = await duplicatePlan(id).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "LESSON_PLAN_NOT_FOUND",
          message: "Lesson plan not found.",
        });
      }
      expect(await countRows("lesson_plans")).toBe(plansBefore);
      expect(await countRows("lesson_plan_contents")).toBe(contentsBefore);
      expect(events).toEqual([]);
    });

    it("returns 401 without a session cookie", async () => {
      const original = await createPlan();

      await request(app.getHttpServer()).post(`/lesson-plans/${original.id}/duplicate`).expect(401);

      expect(await countRows("lesson_plans")).toBe(1);
    });

    it("waits for an edit in progress on the source (FOR SHARE) and copies the committed version", async () => {
      const original = await createPlan();
      // What an edit does: it changes the title and rewrites the contents in one transaction.
      const editing = dataSource.createQueryRunner();
      await editing.connect();
      await editing.startTransaction();
      await editing.query(`UPDATE lesson_plans SET title = 'Janelas' WHERE id = $1`, [original.id]);
      await editing.query(
        `UPDATE lesson_plan_contents SET text = 'Janelas e pastas'
          WHERE lesson_plan_id = $1 AND position = 0`,
        [original.id],
      );

      const pending = duplicatePlan(original.id).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FOR SHARE/);
      } finally {
        await editing.commitTransaction();
        await editing.release();
      }

      // It read the source only after the commit: the title and the contents are of the same version.
      const res = await pending;
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Janelas (cópia)");
      expect(res.body.contents).toEqual(["Janelas e pastas", "Janelas do sistema"]);
      expect(await storedContents(res.body.id)).toEqual([
        { position: 0, text: "Janelas e pastas" },
        { position: 1, text: "Janelas do sistema" },
      ]);
    });
  });
});
