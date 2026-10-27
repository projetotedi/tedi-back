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

process.env.JWT_SECRET = "e2e-course-lesson-plans-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface PlanBody extends Record<string, unknown> {
  id: string;
  title: string;
}

interface CourseBody extends Record<string, unknown> {
  id: string;
  name: string;
  updatedAt: string;
}

interface SequenceItem {
  position: number;
  lessonPlanId: string;
  title: string;
  contents: string[];
  expectedDurationMinutes: number;
  materialUrl: string | null;
  courseCount: number;
  archivedAt: string | null;
}

interface SequenceBody {
  courseId: string;
  plannedWorkloadMinutes: number;
  items: SequenceItem[];
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

function positionsAndIds(body: SequenceBody): Array<[number, string]> {
  return body.items.map((item) => [item.position, item.lessonPlanId]);
}

describe("CourseLessonPlansController (e2e)", () => {
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

  async function createLessonPlan(
    title: string,
    expectedDurationMinutes: number,
    overrides: Record<string, unknown> = {},
  ): Promise<PlanBody> {
    const res = await request(app.getHttpServer())
      .post("/lesson-plans")
      .set("Cookie", director.cookie)
      .send({ title, expectedDurationMinutes, contents: [`Conteúdo de ${title}`], ...overrides })
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

  /** Creates plans P1..Pn (the titles are "P1".."Pn") with the durations in minutes. */
  async function createPlans(...durations: number[]): Promise<PlanBody[]> {
    const plans: PlanBody[] = [];
    for (const [index, minutes] of durations.entries()) {
      plans.push(await createLessonPlan(`P${index + 1}`, minutes));
    }
    return plans;
  }

  function putBody(courseId: string, actor: Actor, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .put(`/courses/${courseId}/lesson-plans`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  function putSequence(courseId: string, actor: Actor, lessonPlanIds: string[]) {
    return putBody(courseId, actor, { lessonPlanIds });
  }

  function getSequence(courseId: string, actor: Actor) {
    return request(app.getHttpServer())
      .get(`/courses/${courseId}/lesson-plans`)
      .set("Cookie", actor.cookie);
  }

  /** The sequence of a course through the API, expecting it to be there. */
  async function sequenceOf(courseId: string): Promise<SequenceBody> {
    const res = await getSequence(courseId, director).expect(200);
    return res.body as SequenceBody;
  }

  /** Puts the sequence, expecting 200, and answers the new sequence. */
  async function setSequence(courseId: string, lessonPlanIds: string[]): Promise<SequenceBody> {
    const res = await putSequence(courseId, director, lessonPlanIds).expect(200);
    return res.body as SequenceBody;
  }

  function archivePlan(id: string) {
    return request(app.getHttpServer())
      .patch(`/lesson-plans/${id}/archive`)
      .set("Cookie", coordinator.cookie)
      .send({})
      .expect(200);
  }

  function updatePlanDuration(id: string, expectedDurationMinutes: number) {
    return request(app.getHttpServer())
      .patch(`/lesson-plans/${id}`)
      .set("Cookie", director.cookie)
      .send({ expectedDurationMinutes })
      .expect(200);
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

  async function storedLinks(courseId: string): Promise<Array<[number, string]>> {
    const rows: Array<{ position: number; lesson_plan_id: string }> = await dataSource.query(
      `SELECT position, lesson_plan_id FROM course_lesson_plans WHERE course_id = $1 ORDER BY position`,
      [courseId],
    );
    return rows.map((row) => [row.position, row.lesson_plan_id]);
  }

  /** The id of each stored link row: it changes when the rows are deleted and inserted again. */
  async function storedLinkRowIds(courseId: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM course_lesson_plans WHERE course_id = $1 ORDER BY position`,
      [courseId],
    );
    return rows.map((row) => row.id);
  }

  async function countLinks(): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM course_lesson_plans`,
    );
    return Number(rows[0].total);
  }

  async function courseUpdatedAt(courseId: string): Promise<Date> {
    const rows: Array<{ updated_at: Date }> = await dataSource.query(
      `SELECT updated_at FROM courses WHERE id = $1`,
      [courseId],
    );
    return rows[0].updated_at;
  }

  /** Inserts plans straight in the table, so a test of the limit does not make 100 requests. */
  async function insertPlans(total: number, minutes: number): Promise<string[]> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO lesson_plans (id, title, expected_duration_minutes, created_by_id)
       SELECT gen_random_uuid(), 'Plano ' || n, $2::int, $1::uuid FROM generate_series(1, $3::int) AS n
       RETURNING id`,
      [director.id, minutes, total],
    );
    return rows.map((row) => row.id);
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

  describe("GET /courses/:id/lesson-plans (listCourseLessonPlans)", () => {
    it("answers plannedWorkloadMinutes 270 for P1 (90), P2 (120) and P3 (60), with the items in order", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2, p3] = await createPlans(90, 120, 60);
      await setSequence(course.id, [p1.id, p2.id, p3.id]);

      const res = await getSequence(course.id, director).expect(200);

      expect(res.body.courseId).toBe(course.id);
      expect(res.body.plannedWorkloadMinutes).toBe(270);
      expect(positionsAndIds(res.body)).toEqual([
        [1, p1.id],
        [2, p2.id],
        [3, p3.id],
      ]);
      expect(
        res.body.items.map((item: SequenceItem) => [item.title, item.expectedDurationMinutes]),
      ).toEqual([
        ["P1", 90],
        ["P2", 120],
        ["P3", 60],
      ]);
    });

    it("shows the position of each course: P1 at 1 in course A and at 4 in course B", async () => {
      const courseA = await createCourse("Curso A");
      const courseB = await createCourse("Curso B");
      const [p1, p2, p3, p4] = await createPlans(90, 120, 60, 45);
      await setSequence(courseA.id, [p1.id, p2.id]);
      await setSequence(courseB.id, [p2.id, p3.id, p4.id, p1.id]);

      const inA = await sequenceOf(courseA.id);
      const inB = await sequenceOf(courseB.id);

      expect(inA.items.find((item) => item.lessonPlanId === p1.id)?.position).toBe(1);
      expect(inB.items.find((item) => item.lessonPlanId === p1.id)?.position).toBe(4);
      expect(positionsAndIds(inA)).toEqual([
        [1, p1.id],
        [2, p2.id],
      ]);
      expect(positionsAndIds(inB)).toEqual([
        [1, p2.id],
        [2, p3.id],
        [3, p4.id],
        [4, p1.id],
      ]);
      expect(inA.plannedWorkloadMinutes).toBe(210);
      expect(inB.plannedWorkloadMinutes).toBe(315);
    });

    it("changes plannedWorkloadMinutes of every course that uses a plan when its duration changes", async () => {
      const courseA = await createCourse("Curso A");
      const courseB = await createCourse("Curso B");
      const courseC = await createCourse("Curso C");
      const [p1, p2] = await createPlans(90, 120);
      await setSequence(courseA.id, [p1.id, p2.id]);
      await setSequence(courseB.id, [p1.id]);
      await setSequence(courseC.id, [p2.id]);
      expect((await sequenceOf(courseA.id)).plannedWorkloadMinutes).toBe(210);
      expect((await sequenceOf(courseB.id)).plannedWorkloadMinutes).toBe(90);

      await updatePlanDuration(p1.id, 30);

      expect((await sequenceOf(courseA.id)).plannedWorkloadMinutes).toBe(150);
      expect((await sequenceOf(courseB.id)).plannedWorkloadMinutes).toBe(30);
      // A course that does not use the plan is not affected.
      expect((await sequenceOf(courseC.id)).plannedWorkloadMinutes).toBe(120);
    });

    it("answers an empty sequence with plannedWorkloadMinutes 0 for a course without plans", async () => {
      const course = await createCourse("Curso A");

      const res = await getSequence(course.id, director).expect(200);

      expect(res.body).toEqual({ courseId: course.id, plannedWorkloadMinutes: 0, items: [] });
    });

    it("answers each item with position, lessonPlanId, title, contents in order, expectedDurationMinutes, materialUrl, courseCount and archivedAt", async () => {
      const course = await createCourse("Curso A");
      const plan = await createLessonPlan("Teclado, mouse e janelas", 90, {
        contents: ["Teclado e mouse", "Janelas do sistema", "Menu iniciar"],
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
      });
      const bare = await createLessonPlan("Pastas e arquivos", 120, { contents: ["Pastas"] });
      await setSequence(course.id, [plan.id, bare.id]);

      const res = await getSequence(course.id, director).expect(200);

      expect(Object.keys(res.body).sort()).toEqual(["courseId", "items", "plannedWorkloadMinutes"]);
      expect(res.body.items).toEqual([
        {
          position: 1,
          lessonPlanId: plan.id,
          title: "Teclado, mouse e janelas",
          contents: ["Teclado e mouse", "Janelas do sistema", "Menu iniciar"],
          expectedDurationMinutes: 90,
          materialUrl: "https://drive.google.com/file/d/exemplo/view",
          courseCount: 1,
          archivedAt: null,
        },
        {
          position: 2,
          lessonPlanId: bare.id,
          title: "Pastas e arquivos",
          contents: ["Pastas"],
          expectedDurationMinutes: 120,
          materialUrl: null,
          courseCount: 1,
          archivedAt: null,
        },
      ]);
      // COUNT is a bigint, which the driver hands over as a string unless the query casts it.
      for (const item of res.body.items as SequenceItem[]) {
        expect(typeof item.courseCount).toBe("number");
        expect(typeof item.position).toBe("number");
        expect(typeof item.expectedDurationMinutes).toBe("number");
      }
      expect(typeof res.body.plannedWorkloadMinutes).toBe("number");
    });

    it("counts in courseCount every course that uses the plan, archived ones included", async () => {
      const courseA = await createCourse("Curso A");
      const courseB = await createCourse("Curso B");
      const courseC = await createCourse("Curso C");
      const [p1, p2] = await createPlans(90, 120);
      await setSequence(courseA.id, [p1.id, p2.id]);
      await setSequence(courseB.id, [p1.id]);
      await setSequence(courseC.id, [p1.id]);

      const before = await sequenceOf(courseA.id);
      expect(before.items.map((item) => item.courseCount)).toEqual([3, 1]);

      await archiveCourse(courseC.id);

      // The archived course still uses the plan: a change of duration reaches it as well (RN-24).
      const after = await sequenceOf(courseA.id);
      expect(after.items.map((item) => item.courseCount)).toEqual([3, 1]);
      expect((await sequenceOf(courseB.id)).items[0].courseCount).toBe(3);
    });

    it("keeps an archived plan that was already in the sequence, with archivedAt set, and counts its duration", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2] = await createPlans(90, 120);
      await setSequence(course.id, [p1.id, p2.id]);

      await archivePlan(p2.id);

      const res = await getSequence(course.id, director).expect(200);
      expect(positionsAndIds(res.body)).toEqual([
        [1, p1.id],
        [2, p2.id],
      ]);
      expect(res.body.items[0].archivedAt).toBeNull();
      expect(res.body.items[1].archivedAt).toEqual(expect.any(String));
      expect(res.body.plannedWorkloadMinutes).toBe(210);
    });

    it("reads the sequence of an archived course", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2] = await createPlans(90, 120);
      await setSequence(course.id, [p1.id, p2.id]);
      await archiveCourse(course.id);

      const res = await getSequence(course.id, director).expect(200);

      expect(res.body.plannedWorkloadMinutes).toBe(210);
      expect(positionsAndIds(res.body)).toEqual([
        [1, p1.id],
        [2, p2.id],
      ]);
    });

    it("returns 200 for a member", async () => {
      const course = await createCourse("Curso A");
      const [p1] = await createPlans(90);
      await setSequence(course.id, [p1.id]);

      const res = await getSequence(course.id, member).expect(200);

      expect(res.body.plannedWorkloadMinutes).toBe(90);
      await getSequence(course.id, coordinator).expect(200);
    });

    it("returns 404 COURSE_NOT_FOUND for an unknown and a malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await getSequence(id, director).expect(404);

        expect(res.body.error).toBe("COURSE_NOT_FOUND");
        expect(res.body.message).toBe("Course not found.");
      }
    });

    it("returns 401 without a session cookie", async () => {
      const course = await createCourse("Curso A");

      await request(app.getHttpServer()).get(`/courses/${course.id}/lesson-plans`).expect(401);
    });

    it("finds the course by an id in upper case and answers the courseId stored in the database", async () => {
      const course = await createCourse("Curso A");
      const [p1] = await createPlans(90);
      await setSequence(course.id, [p1.id]);

      const res = await getSequence(course.id.toUpperCase(), director).expect(200);

      expect(res.body.courseId).toBe(course.id);
      expect(positionsAndIds(res.body)).toEqual([[1, p1.id]]);
    });
  });

  describe("PUT /courses/:id/lesson-plans (replaceCourseLessonPlans)", () => {
    it("stores positions 1, 2 and 3 in the order sent and answers the new sequence", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2, p3] = await createPlans(90, 120, 60);

      const res = await putSequence(course.id, director, [p2.id, p3.id, p1.id]).expect(200);

      expect(res.body.courseId).toBe(course.id);
      expect(res.body.plannedWorkloadMinutes).toBe(270);
      expect(positionsAndIds(res.body)).toEqual([
        [1, p2.id],
        [2, p3.id],
        [3, p1.id],
      ]);
      expect(await storedLinks(course.id)).toEqual([
        [1, p2.id],
        [2, p3.id],
        [3, p1.id],
      ]);
      // What the PUT answers is what the GET answers.
      expect(await sequenceOf(course.id)).toEqual(res.body);
    });

    it("reorders to P3, P1: positions 1 and 2, P2 out, plannedWorkloadMinutes 150", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2, p3] = await createPlans(90, 120, 60);
      const first = await setSequence(course.id, [p1.id, p2.id, p3.id]);
      expect(first.plannedWorkloadMinutes).toBe(270);

      const res = await putSequence(course.id, director, [p3.id, p1.id]).expect(200);

      expect(positionsAndIds(res.body)).toEqual([
        [1, p3.id],
        [2, p1.id],
      ]);
      expect(res.body.plannedWorkloadMinutes).toBe(150);
      expect(await storedLinks(course.id)).toEqual([
        [1, p3.id],
        [2, p1.id],
      ]);
      expect(await countLinks()).toBe(2);
    });

    it("adds, removes and reorders in one call", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2, p3, p4] = await createPlans(90, 120, 60, 45);
      await setSequence(course.id, [p1.id, p2.id, p3.id]);

      const res = await putSequence(course.id, director, [p4.id, p3.id, p1.id]).expect(200);

      expect(positionsAndIds(res.body)).toEqual([
        [1, p4.id],
        [2, p3.id],
        [3, p1.id],
      ]);
      expect(res.body.plannedWorkloadMinutes).toBe(195);
      expect(await storedLinks(course.id)).toEqual([
        [1, p4.id],
        [2, p3.id],
        [3, p1.id],
      ]);
    });

    it("clears the sequence with [] and answers plannedWorkloadMinutes 0", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2] = await createPlans(90, 120);
      await setSequence(course.id, [p1.id, p2.id]);

      const res = await putSequence(course.id, director, []).expect(200);

      expect(res.body).toEqual({ courseId: course.id, plannedWorkloadMinutes: 0, items: [] });
      expect(await storedLinks(course.id)).toEqual([]);
      expect(await countLinks()).toBe(0);
      expect(await sequenceOf(course.id)).toEqual(res.body);
      // The plans themselves are not touched: only the links go.
      const plan = await request(app.getHttpServer())
        .get(`/lesson-plans/${p1.id}`)
        .set("Cookie", director.cookie)
        .expect(200);
      expect(plan.body.title).toBe("P1");
    });

    it("lets the same plan be in two courses with different positions", async () => {
      const courseA = await createCourse("Curso A");
      const courseB = await createCourse("Curso B");
      const [p1, p2, p3] = await createPlans(90, 120, 60);

      await putSequence(courseA.id, director, [p1.id, p2.id]).expect(200);
      const inB = await putSequence(courseB.id, director, [p2.id, p3.id, p1.id]).expect(200);

      expect(positionsAndIds(inB.body)).toEqual([
        [1, p2.id],
        [2, p3.id],
        [3, p1.id],
      ]);
      expect(await storedLinks(courseA.id)).toEqual([
        [1, p1.id],
        [2, p2.id],
      ]);
      expect(await storedLinks(courseB.id)).toEqual([
        [1, p2.id],
        [2, p3.id],
        [3, p1.id],
      ]);
      // Course B did not touch course A.
      expect((await sequenceOf(courseA.id)).items.map((item) => item.courseCount)).toEqual([2, 2]);
    });

    it("returns 400 DUPLICATE_LESSON_PLAN for [P1, P1] and for the same id in upper and lower case, and changes nothing", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2] = await createPlans(90, 120);
      await setSequence(course.id, [p2.id]);
      const events = collectEvents();

      for (const ids of [
        [p1.id, p1.id],
        [p1.id, p2.id, p1.id],
        [p1.id, p1.id.toUpperCase()],
      ]) {
        const res = await putSequence(course.id, director, ids).expect(400);

        expect(res.body.error).toBe("DUPLICATE_LESSON_PLAN");
        expect(res.body.message).toBe(
          "The same lesson plan appears more than once in the sequence.",
        );
      }

      expect(await storedLinks(course.id)).toEqual([[1, p2.id]]);
      expect(events).toHaveLength(0);
    });

    it("returns 400 LESSON_PLAN_NOT_FOUND for an unknown lesson plan id and changes nothing", async () => {
      const course = await createCourse("Curso A");
      const [p1] = await createPlans(90);
      await setSequence(course.id, [p1.id]);
      const events = collectEvents();

      const res = await putSequence(course.id, director, [p1.id, UNKNOWN_ID]).expect(400);

      expect(res.body.error).toBe("LESSON_PLAN_NOT_FOUND");
      expect(res.body.message).toBe("One or more lesson plans do not exist.");
      expect(await storedLinks(course.id)).toEqual([[1, p1.id]]);
      expect(events).toHaveLength(0);
    });

    it("returns 400 LESSON_PLAN_ARCHIVED for an archived plan that was not in the course, and keeps one that already was", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2, p3] = await createPlans(90, 120, 60);
      await setSequence(course.id, [p1.id, p2.id]);
      await archivePlan(p2.id);
      await archivePlan(p3.id);

      // P3 is archived and was never in the course: refused, and nothing changes.
      const refused = await putSequence(course.id, director, [p1.id, p2.id, p3.id]).expect(400);
      expect(refused.body.error).toBe("LESSON_PLAN_ARCHIVED");
      expect(refused.body.message).toBe("An archived lesson plan cannot be added to a course.");
      expect(await storedLinks(course.id)).toEqual([
        [1, p1.id],
        [2, p2.id],
      ]);

      // P2 is archived but already in the course: it stays, even moved to another position.
      const kept = await putSequence(course.id, director, [p2.id, p1.id]).expect(200);
      expect(positionsAndIds(kept.body)).toEqual([
        [1, p2.id],
        [2, p1.id],
      ]);
      expect(kept.body.items[0].archivedAt).toEqual(expect.any(String));
      expect(kept.body.plannedWorkloadMinutes).toBe(210);
    });

    it("returns 400 VALIDATION_FAILED with field lessonPlanIds for a missing list, null, a non-uuid or more than 100 ids", async () => {
      const course = await createCourse("Curso A");
      const [p1] = await createPlans(90);
      await setSequence(course.id, [p1.id]);
      const events = collectEvents();

      for (const body of [
        {},
        { lessonPlanIds: null },
        { lessonPlanIds: "not-a-list" },
        { lessonPlanIds: [p1.id, "not-a-uuid"] },
        { lessonPlanIds: [p1.id, 7] },
        { lessonPlanIds: uuids(101) },
      ]) {
        const res = await putBody(course.id, director, body).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["lessonPlanIds"]);
      }

      expect(await storedLinks(course.id)).toEqual([[1, p1.id]]);
      expect(events).toHaveLength(0);
    });

    it("answers DUPLICATE_LESSON_PLAN before COURSE_NOT_FOUND", async () => {
      const [p1] = await createPlans(90);

      const duplicated = await putSequence(UNKNOWN_ID, director, [p1.id, p1.id]).expect(400);
      expect(duplicated.body.error).toBe("DUPLICATE_LESSON_PLAN");

      const missing = await putSequence(UNKNOWN_ID, director, [p1.id]).expect(404);
      expect(missing.body.error).toBe("COURSE_NOT_FOUND");
    });

    it("returns 409 COURSE_ARCHIVED for an archived course and changes nothing", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2] = await createPlans(90, 120);
      await setSequence(course.id, [p1.id, p2.id]);
      await archiveCourse(course.id);
      const events = collectEvents();

      for (const ids of [[p2.id, p1.id], [], [p1.id, p2.id], [UNKNOWN_ID]]) {
        const res = await putSequence(course.id, director, ids).expect(409);

        expect(res.body.error).toBe("COURSE_ARCHIVED");
        expect(res.body.message).toBe("Archived courses are read-only.");
      }

      expect(await storedLinks(course.id)).toEqual([
        [1, p1.id],
        [2, p2.id],
      ]);
      expect(events).toHaveLength(0);
    });

    it("returns 404 COURSE_NOT_FOUND for an unknown and a malformed id", async () => {
      const [p1] = await createPlans(90);

      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await putSequence(id, director, [p1.id]).expect(404);

        expect(res.body.error).toBe("COURSE_NOT_FOUND");
        expect(res.body.message).toBe("Course not found.");
      }
      expect(await countLinks()).toBe(0);
    });

    it("returns 200 for a coordinator", async () => {
      const course = await createCourse("Curso A");
      const [p1] = await createPlans(90);

      const res = await putSequence(course.id, coordinator, [p1.id]).expect(200);

      expect(positionsAndIds(res.body)).toEqual([[1, p1.id]]);
    });

    it("returns 403 FORBIDDEN for a member and changes nothing", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2] = await createPlans(90, 120);
      await setSequence(course.id, [p1.id]);
      const events = collectEvents();

      const res = await putSequence(course.id, member, [p2.id]).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      // The permission comes before the id, the body and the rules: it answers the same for all.
      await putSequence(UNKNOWN_ID, member, [p2.id]).expect(403);
      await putBody(course.id, member, { lessonPlanIds: null }).expect(403);
      await putSequence(course.id, member, []).expect(403);
      expect(await storedLinks(course.id)).toEqual([[1, p1.id]]);
      expect(events).toHaveLength(0);
    });

    it("returns 401 without a session cookie", async () => {
      const course = await createCourse("Curso A");
      const [p1] = await createPlans(90);

      await request(app.getHttpServer())
        .put(`/courses/${course.id}/lesson-plans`)
        .send({ lessonPlanIds: [p1.id] })
        .expect(401);

      expect(await countLinks()).toBe(0);
    });

    it("answers 200 without writing or emitting when the list is the same, in the same order", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2] = await createPlans(90, 120);
      const first = await setSequence(course.id, [p1.id, p2.id]);
      const rowIds = await storedLinkRowIds(course.id);
      const updatedAt = await courseUpdatedAt(course.id);
      const events = collectEvents();

      const same = await putSequence(course.id, director, [p1.id, p2.id]).expect(200);
      const upper = await putSequence(course.id, coordinator, [
        p1.id.toUpperCase(),
        p2.id.toUpperCase(),
      ]).expect(200);
      const upperPath = await putSequence(course.id.toUpperCase(), director, [p1.id, p2.id]).expect(
        200,
      );

      expect(same.body).toEqual(first);
      expect(upper.body).toEqual(first);
      expect(upperPath.body).toEqual(first);
      // The rows are the very same ones: nothing was deleted and inserted again.
      expect(await storedLinkRowIds(course.id)).toEqual(rowIds);
      expect(await courseUpdatedAt(course.id)).toEqual(updatedAt);
      expect(events).toHaveLength(0);
    });

    it("answers 200 without writing or emitting when [] is sent to a course that has no plans", async () => {
      const course = await createCourse("Curso A");
      const updatedAt = await courseUpdatedAt(course.id);
      const events = collectEvents();

      const res = await putSequence(course.id, director, []).expect(200);

      expect(res.body).toEqual({ courseId: course.id, plannedWorkloadMinutes: 0, items: [] });
      expect(await courseUpdatedAt(course.id)).toEqual(updatedAt);
      expect(events).toHaveLength(0);
    });

    it("moves the course updatedAt forward when the sequence changes", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2] = await createPlans(90, 120);

      await setSequence(course.id, [p1.id, p2.id]);

      // The course answers the new updatedAt as well: the contract of CourseResponseDto.updatedAt.
      const patched = await request(app.getHttpServer())
        .patch(`/courses/${course.id}`)
        .set("Cookie", director.cookie)
        .send({})
        .expect(200);
      expect(new Date(patched.body.updatedAt).getTime()).toBeGreaterThan(
        new Date(course.updatedAt).getTime(),
      );
      expect(patched.body.createdAt).toBe(course.createdAt);
      expect((await courseUpdatedAt(course.id)).toISOString()).toBe(patched.body.updatedAt);

      // Reordering is a change too, so it moves again.
      const afterFirst = await courseUpdatedAt(course.id);
      await setSequence(course.id, [p2.id, p1.id]);
      expect((await courseUpdatedAt(course.id)).getTime()).toBeGreaterThan(afterFirst.getTime());
    });

    it("accepts 100 lesson plans and stores positions 1 to 100 in the order sent", async () => {
      const course = await createCourse("Curso A");
      const ids = (await insertPlans(100, 60)).reverse();

      const res = await putSequence(course.id, director, ids).expect(200);

      expect(res.body.items).toHaveLength(100);
      expect(res.body.plannedWorkloadMinutes).toBe(6000);
      expect(res.body.items.map((item: SequenceItem) => item.lessonPlanId)).toEqual(ids);
      expect(res.body.items.map((item: SequenceItem) => item.position)).toEqual(
        Array.from({ length: 100 }, (_, index) => index + 1),
      );
      expect(await storedLinks(course.id)).toEqual(ids.map((id, index) => [index + 1, id]));
    });

    it("replaces the found course by an id in upper case and emits the id stored in the database", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2] = await createPlans(90, 120);
      await setSequence(course.id, [p1.id]);
      const events = collectEvents();

      const res = await putSequence(course.id.toUpperCase(), director, [p2.id, p1.id]).expect(200);

      expect(res.body.courseId).toBe(course.id);
      expect(positionsAndIds(res.body)).toEqual([
        [1, p2.id],
        [2, p1.id],
      ]);
      expect(await storedLinks(course.id)).toEqual([
        [1, p2.id],
        [2, p1.id],
      ]);
      expect(await countLinks()).toBe(2);
      expect(events).toHaveLength(1);
      expect(events[0].targetId).toBe(course.id);
      expect(events[0].before).toEqual({ lessonPlanIds: [p1.id] });
    });

    it("emits COURSE_LESSON_PLANS_REPLACED with the ids before and after, in order", async () => {
      const course = await createCourse("Curso A");
      const [p1, p2, p3] = await createPlans(90, 120, 60);
      const events = collectEvents();

      await putSequence(course.id, director, [p1.id, p2.id, p3.id]).expect(200);
      await putSequence(course.id, coordinator, [p3.id, p1.id]).expect(200);
      await putSequence(course.id, director, []).expect(200);

      expect(events.map((event) => event.action)).toEqual([
        AuditableAction.COURSE_LESSON_PLANS_REPLACED,
        AuditableAction.COURSE_LESSON_PLANS_REPLACED,
        AuditableAction.COURSE_LESSON_PLANS_REPLACED,
      ]);
      expect(events.map((event) => [event.before, event.after])).toEqual([
        [{ lessonPlanIds: [] }, { lessonPlanIds: [p1.id, p2.id, p3.id] }],
        [{ lessonPlanIds: [p1.id, p2.id, p3.id] }, { lessonPlanIds: [p3.id, p1.id] }],
        [{ lessonPlanIds: [p3.id, p1.id] }, { lessonPlanIds: [] }],
      ]);
      expect(events.map((event) => event.actorId)).toEqual([
        director.id,
        coordinator.id,
        director.id,
      ]);
      for (const event of events) {
        expect(event.targetType).toBe("course");
        expect(event.targetId).toBe(course.id);
        expect(event.occurredAt).toBeInstanceOf(Date);
      }
    });

    it("does not emit when the replacement is refused", async () => {
      const course = await createCourse("Curso A");
      const archivedCourse = await createCourse("Curso B");
      const [p1, p2] = await createPlans(90, 120);
      await archivePlan(p2.id);
      await archiveCourse(archivedCourse.id);
      const events = collectEvents();

      await putSequence(course.id, director, [p1.id, p1.id]).expect(400);
      await putSequence(course.id, director, [p1.id, UNKNOWN_ID]).expect(400);
      await putSequence(course.id, director, [p1.id, p2.id]).expect(400);
      await putBody(course.id, director, { lessonPlanIds: null }).expect(400);
      await putSequence(archivedCourse.id, director, [p1.id]).expect(409);
      await putSequence(UNKNOWN_ID, director, [p1.id]).expect(404);
      await putSequence(course.id, member, [p1.id]).expect(403);

      expect(events).toHaveLength(0);
      expect(await countLinks()).toBe(0);
    });

    it("locks the course row with FOR UPDATE and waits for whoever holds it", async () => {
      const course = await createCourse("Curso A");
      const [p1] = await createPlans(90);
      const holder = dataSource.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query(`SELECT id FROM courses WHERE id = $1 FOR UPDATE`, [course.id]);

      const pending = putSequence(course.id, director, [p1.id]).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FOR UPDATE/);
      } finally {
        await holder.commitTransaction();
        await holder.release();
      }

      const res = await pending;
      expect(res.status).toBe(200);
      expect(positionsAndIds(res.body)).toEqual([[1, p1.id]]);
    });

    it("waits for an archiving of the plan in progress and then answers 400 LESSON_PLAN_ARCHIVED", async () => {
      const course = await createCourse("Curso A");
      const [p1] = await createPlans(90);
      // What PATCH /lesson-plans/:id/archive does: it locks the plan FOR UPDATE and archives it.
      const archiving = dataSource.createQueryRunner();
      await archiving.connect();
      await archiving.startTransaction();
      await archiving.query(`SELECT id FROM lesson_plans WHERE id = $1 FOR UPDATE`, [p1.id]);
      await archiving.query(
        `UPDATE lesson_plans SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
        [p1.id, coordinator.id],
      );

      const pending = putSequence(course.id, director, [p1.id]).then((res) => res);

      try {
        // The plan is locked FOR SHARE, which waits for the FOR UPDATE of the archiving.
        expect(await blockedStatement()).toMatch(/FOR SHARE/);
      } finally {
        await archiving.commitTransaction();
        await archiving.release();
      }

      // It read the plan only after the commit, so it saw it archived.
      const res = await pending;
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("LESSON_PLAN_ARCHIVED");
      expect(await storedLinks(course.id)).toEqual([]);
    });

    it("serializes two concurrent replacements of the same course: one of the lists wins, whole", async () => {
      for (let round = 0; round < 4; round++) {
        const course = await createCourse(`Curso ${round}`);
        const [p1, p2, p3] = await createPlans(90, 120, 60);
        await setSequence(course.id, [p1.id]);

        const [first, second] = await Promise.all([
          putSequence(course.id, director, [p2.id, p3.id]),
          putSequence(course.id, coordinator, [p3.id, p1.id, p2.id]),
        ]);

        // Neither is a 500 from the unique index of the position: the lock lines them up.
        expect([first.status, second.status]).toEqual([200, 200]);
        const stored = await storedLinks(course.id);
        expect([
          [
            [1, p2.id],
            [2, p3.id],
          ],
          [
            [1, p3.id],
            [2, p1.id],
            [3, p2.id],
          ],
        ]).toContainEqual(stored);
        expect(await sequenceOf(course.id)).toMatchObject({
          items: stored.map(([position, lessonPlanId]) =>
            expect.objectContaining({ position, lessonPlanId }),
          ),
        });
      }
    });

    it("lets two courses replace their sequences at the same time with the same plans", async () => {
      const courseA = await createCourse("Curso A");
      const courseB = await createCourse("Curso B");
      const [p1, p2, p3] = await createPlans(90, 120, 60);

      const [first, second] = await Promise.all([
        putSequence(courseA.id, director, [p1.id, p2.id, p3.id]),
        putSequence(courseB.id, coordinator, [p3.id, p2.id, p1.id]),
      ]);

      // The plans are locked FOR SHARE, which does not conflict with itself: nobody waits for anybody.
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(await storedLinks(courseA.id)).toEqual([
        [1, p1.id],
        [2, p2.id],
        [3, p3.id],
      ]);
      expect(await storedLinks(courseB.id)).toEqual([
        [1, p3.id],
        [2, p2.id],
        [3, p1.id],
      ]);
    });
  });

  describe("routes", () => {
    it("has no POST, PATCH or DELETE on /courses/:id/lesson-plans", async () => {
      const course = await createCourse("Curso A");
      const [p1] = await createPlans(90);
      const path = `/courses/${course.id}/lesson-plans`;

      for (const method of ["post", "patch", "delete"] as const) {
        await request(app.getHttpServer())
          [method](path)
          .set("Cookie", coordinator.cookie)
          .send({ lessonPlanIds: [p1.id] })
          .expect(404);
      }
      expect(await countLinks()).toBe(0);
    });
  });
});
