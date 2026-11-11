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

process.env.JWT_SECRET = "e2e-course-duplicate-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const SOURCE = {
  name: "Redes Sociais com Segurança",
  description: "Uso seguro das redes sociais: privacidade, senhas e golpes.",
  objective: "Ensinar o aluno a se proteger nas redes sociais.",
  category: "intermediate",
};

const BASIC = {
  name: "Informática Básica",
  description: "Fundamentos do uso do computador.",
  category: "basic",
};

const NEXT = {
  name: "Redes Sociais Avançada",
  description: "Aprofundamento em segurança digital.",
  category: "advanced",
};

const COPY_NAME = "Redes Sociais com Segurança (2026.2)";

const NAME_TAKEN = {
  statusCode: 409,
  error: "COURSE_NAME_TAKEN",
  message: "A course with this name already exists.",
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
  createdAt: string;
  updatedAt: string;
}

interface PlanBody extends Record<string, unknown> {
  id: string;
  title: string;
}

interface SequenceItemBody {
  position: number;
  lessonPlanId: string;
  title: string;
  contents: string[];
  expectedDurationMinutes: number;
  materialUrl: string | null;
  courseCount: number;
  archivedAt: string | null;
}

interface CourseDetailBody extends Record<string, unknown> {
  id: string;
  name: string;
  status: string;
  prerequisites: unknown[];
  requiredBy: unknown[];
  lessonPlans: SequenceItemBody[];
  plannedWorkloadMinutes: number;
  lessonPlanCount: number;
}

type Table = "courses" | "course_lesson_plans" | "course_prerequisites" | "lesson_plans";

/** The item of the sequence for a plan made by `createPlans`, used by `courseCount` courses. */
function sequenceItem(
  plan: PlanBody,
  position: number,
  minutes: number,
  courseCount: number,
): SequenceItemBody {
  return {
    position,
    lessonPlanId: plan.id,
    title: plan.title,
    contents: [`Conteúdo de ${plan.title}`],
    expectedDurationMinutes: minutes,
    materialUrl: null,
    courseCount,
    archivedAt: null,
  };
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

describe("Course duplicate (e2e)", () => {
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

  async function createCourse(body: Record<string, unknown>): Promise<CourseBody> {
    const res = await request(app.getHttpServer())
      .post("/courses")
      .set("Cookie", director.cookie)
      .send(body)
      .expect(201);
    return res.body as CourseBody;
  }

  /** Creates plans P1..Pn (the titles are "P1".."Pn") with the durations in minutes. */
  async function createPlans(...durations: number[]): Promise<PlanBody[]> {
    const plans: PlanBody[] = [];
    for (const [index, minutes] of durations.entries()) {
      const res = await request(app.getHttpServer())
        .post("/lesson-plans")
        .set("Cookie", director.cookie)
        .send({
          title: `P${index + 1}`,
          expectedDurationMinutes: minutes,
          contents: [`Conteúdo de P${index + 1}`],
        })
        .expect(201);
      plans.push(res.body as PlanBody);
    }
    return plans;
  }

  /** Puts the sequence of a course, expecting 200. */
  async function putSequence(courseId: string, lessonPlanIds: string[]): Promise<void> {
    await request(app.getHttpServer())
      .put(`/courses/${courseId}/lesson-plans`)
      .set("Cookie", director.cookie)
      .send({ lessonPlanIds })
      .expect(200);
  }

  /** "Redes Sociais com Segurança" with a sequence of plans P1..Pn of these durations, no prerequisite. */
  async function createSource(...durations: number[]) {
    const source = await createCourse(SOURCE);
    const plans = await createPlans(...durations);
    if (plans.length > 0)
      await putSequence(
        source.id,
        plans.map((plan) => plan.id),
      );
    return { source, plans };
  }

  function postDuplicate(id: string, body: Record<string, unknown>, actor: Actor = director) {
    return request(app.getHttpServer())
      .post(`/courses/${id}/duplicate`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  function duplicateCourse(id: string, name: string = COPY_NAME, actor: Actor = director) {
    return postDuplicate(id, { name }, actor);
  }

  /** The page of a course through the API, expecting it to be there. */
  async function detailOf(id: string): Promise<CourseDetailBody> {
    const res = await request(app.getHttpServer())
      .get(`/courses/${id}`)
      .set("Cookie", director.cookie)
      .expect(200);
    return res.body as CourseDetailBody;
  }

  function patchCourse(id: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/courses/${id}`)
      .set("Cookie", director.cookie)
      .send(body);
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

  async function softDeleteCourse(id: string): Promise<void> {
    await dataSource.query(`UPDATE courses SET deleted_at = now() WHERE id = $1`, [id]);
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  async function countRows(table: Table): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM ${table}`,
    );
    return Number(rows[0].total);
  }

  /** The links of the course as stored: [position, lessonPlanId], in order of position. */
  async function storedLinks(courseId: string): Promise<Array<[number, string]>> {
    const rows: Array<{ position: number; lesson_plan_id: string }> = await dataSource.query(
      `SELECT position, lesson_plan_id FROM course_lesson_plans WHERE course_id = $1 ORDER BY position`,
      [courseId],
    );
    return rows.map((row) => [row.position, row.lesson_plan_id]);
  }

  async function storedPrerequisiteIds(courseId: string): Promise<string[]> {
    const rows: Array<{ prerequisite_id: string }> = await dataSource.query(
      `SELECT prerequisite_id FROM course_prerequisites WHERE course_id = $1`,
      [courseId],
    );
    return rows.map((row) => row.prerequisite_id);
  }

  async function storedCourse(id: string): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT name, description, objective, category, created_by_id, archived_at, archived_by_id,
              archive_reason, deleted_at
         FROM courses WHERE id = $1`,
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

  describe("POST /courses/:id/duplicate (duplicateCourse)", () => {
    it("duplicates 'Redes Sociais com Segurança' with 4 plans as 'Redes Sociais com Segurança (2026.2)'", async () => {
      // The source requires Informática Básica and is required by Redes Sociais Avançada: neither link comes along.
      const basic = await createCourse(BASIC);
      const source = await createCourse({ ...SOURCE, prerequisiteIds: [basic.id] });
      const next = await createCourse({ ...NEXT, prerequisiteIds: [source.id] });
      const [p1, p2, p3, p4] = await createPlans(60, 90, 45, 75);
      await putSequence(source.id, [p1.id, p2.id, p3.id, p4.id]);
      const sourceBefore = await detailOf(source.id);
      const prerequisiteRowsBefore = await countRows("course_prerequisites");

      const res = await duplicateCourse(source.id, COPY_NAME, coordinator).expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        name: COPY_NAME,
        description: SOURCE.description,
        objective: SOURCE.objective,
        category: "intermediate",
        status: "active",
        prerequisites: [],
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: coordinator.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      const copy = res.body as CourseBody;
      expect(copy.id).not.toBe(source.id);

      // The copy has the same sequence in the same order and the same workload, and nothing else.
      expect(await detailOf(copy.id)).toEqual({
        id: copy.id,
        name: COPY_NAME,
        description: SOURCE.description,
        objective: SOURCE.objective,
        category: "intermediate",
        status: "active",
        createdAt: copy.createdAt,
        createdBy: { id: coordinator.id, name: "Coordinator" },
        updatedAt: copy.updatedAt,
        prerequisites: [],
        requiredBy: [],
        lessonPlans: [
          sequenceItem(p1, 1, 60, 2),
          sequenceItem(p2, 2, 90, 2),
          sequenceItem(p3, 3, 45, 2),
          sequenceItem(p4, 4, 75, 2),
        ],
        plannedWorkloadMinutes: 270,
        lessonPlanCount: 4,
      });
      expect(sourceBefore.plannedWorkloadMinutes).toBe(270);
      expect(await storedLinks(copy.id)).toEqual([
        [1, p1.id],
        [2, p2.id],
        [3, p3.id],
        [4, p4.id],
      ]);
      expect(await storedCourse(copy.id)).toMatchObject({
        name: COPY_NAME,
        created_by_id: coordinator.id,
        archived_at: null,
        deleted_at: null,
      });

      // No prerequisite row is written, and the plans are shared: no plan was copied.
      expect(await storedPrerequisiteIds(copy.id)).toEqual([]);
      expect(await countRows("course_prerequisites")).toBe(prerequisiteRowsBefore);
      expect(await countRows("lesson_plans")).toBe(4);
      expect(await countRows("course_lesson_plans")).toBe(8);

      // The source stays as it was. Only courseCount changes: each plan is now in 2 courses (RN-17).
      expect(await detailOf(source.id)).toEqual({
        ...sourceBefore,
        lessonPlans: sourceBefore.lessonPlans.map((item) => ({ ...item, courseCount: 2 })),
      });
      expect(await storedPrerequisiteIds(source.id)).toEqual([basic.id]);
      expect(await storedPrerequisiteIds(next.id)).toEqual([source.id]);
    });

    it("shares the plans: changing a duration changes the workload of both courses", async () => {
      const { source, plans } = await createSource(60, 90);
      const copy = (await duplicateCourse(source.id).expect(201)).body as CourseBody;
      expect((await detailOf(source.id)).plannedWorkloadMinutes).toBe(150);
      expect((await detailOf(copy.id)).plannedWorkloadMinutes).toBe(150);

      await updatePlanDuration(plans[1].id, 120);

      const sourceDetail = await detailOf(source.id);
      const copyDetail = await detailOf(copy.id);
      expect(sourceDetail.plannedWorkloadMinutes).toBe(180);
      expect(copyDetail.plannedWorkloadMinutes).toBe(180);
      expect(copyDetail.lessonPlans).toEqual([
        sequenceItem(plans[0], 1, 60, 2),
        sequenceItem(plans[1], 2, 120, 2),
      ]);
      expect(sourceDetail.lessonPlans).toEqual(copyDetail.lessonPlans);
      // One plan row for each plan: the duplication never copies a plan.
      expect(await countRows("lesson_plans")).toBe(2);
    });

    it("keeps the two sequences independent: editing one does not touch the other", async () => {
      const { source, plans } = await createSource(60, 90, 45);
      const copy = (await duplicateCourse(source.id).expect(201)).body as CourseBody;

      await putSequence(copy.id, [plans[2].id, plans[0].id]);

      expect(await storedLinks(copy.id)).toEqual([
        [1, plans[2].id],
        [2, plans[0].id],
      ]);
      expect(await storedLinks(source.id)).toEqual([
        [1, plans[0].id],
        [2, plans[1].id],
        [3, plans[2].id],
      ]);
      expect((await detailOf(source.id)).plannedWorkloadMinutes).toBe(195);
      expect((await detailOf(copy.id)).plannedWorkloadMinutes).toBe(105);
    });

    it("duplicates an archived course into an active one, created by whoever duplicated", async () => {
      const { source } = await createSource(60, 90);
      await archiveCourse(source.id);

      const res = await duplicateCourse(source.id, COPY_NAME, coordinator).expect(201);

      expect(res.body).toMatchObject({
        name: COPY_NAME,
        status: "active",
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: coordinator.id,
      });
      const copy = res.body as CourseBody;
      expect(await storedCourse(copy.id)).toMatchObject({
        archived_at: null,
        archived_by_id: null,
        archive_reason: null,
        created_by_id: coordinator.id,
      });
      expect((await detailOf(copy.id)).lessonPlanCount).toBe(2);

      // Active means editable: an archived course answers 409 COURSE_ARCHIVED on PATCH.
      await patchCourse(copy.id, { description: "Nova descrição." }).expect(200);

      // The source is still archived, by the same person.
      expect((await detailOf(source.id)).status).toBe("archived");
      expect(await storedCourse(source.id)).toMatchObject({
        archived_at: expect.any(Date),
        archived_by_id: coordinator.id,
      });
    });

    it("copies an archived lesson plan of the sequence and counts its duration", async () => {
      const { source, plans } = await createSource(60, 90);
      await archivePlan(plans[1].id);

      const copy = (await duplicateCourse(source.id).expect(201)).body as CourseBody;

      const detail = await detailOf(copy.id);
      expect(detail.lessonPlanCount).toBe(2);
      expect(detail.plannedWorkloadMinutes).toBe(150);
      expect(
        detail.lessonPlans.map((item) => [item.lessonPlanId, item.archivedAt !== null]),
      ).toEqual([
        [plans[0].id, false],
        [plans[1].id, true],
      ]);
      expect(await storedLinks(copy.id)).toEqual([
        [1, plans[0].id],
        [2, plans[1].id],
      ]);
      expect((await detailOf(source.id)).plannedWorkloadMinutes).toBe(150);
    });

    it("duplicates a course without lesson plans", async () => {
      const { source } = await createSource();

      const res = await duplicateCourse(source.id).expect(201);

      const detail = await detailOf((res.body as CourseBody).id);
      expect(detail).toMatchObject({
        name: COPY_NAME,
        lessonPlans: [],
        plannedWorkloadMinutes: 0,
        lessonPlanCount: 0,
      });
      expect(await storedLinks((res.body as CourseBody).id)).toEqual([]);
      expect(await countRows("course_lesson_plans")).toBe(0);
    });

    it("takes only the name from the body: everything else is ignored", async () => {
      const { source } = await createSource(60);
      const basic = await createCourse(BASIC);

      const res = await postDuplicate(source.id, {
        name: COPY_NAME,
        description: "Outra descrição.",
        objective: "Outro objetivo.",
        category: "basic",
        prerequisiteIds: [basic.id],
        createdById: member.id,
        archivedAt: "2026-01-01T00:00:00.000Z",
      }).expect(201);

      expect(res.body).toMatchObject({
        name: COPY_NAME,
        description: SOURCE.description,
        objective: SOURCE.objective,
        category: "intermediate",
        status: "active",
        prerequisites: [],
        archivedAt: null,
        createdById: director.id,
      });
      expect(await storedPrerequisiteIds((res.body as CourseBody).id)).toEqual([]);
    });

    it("copies a source without objective as null", async () => {
      const source = await createCourse({
        name: SOURCE.name,
        description: SOURCE.description,
        category: SOURCE.category,
      });

      const res = await duplicateCourse(source.id).expect(201);

      expect(res.body.objective).toBeNull();
      expect(await storedCourse((res.body as CourseBody).id)).toMatchObject({ objective: null });
    });

    it("returns 409 COURSE_NAME_TAKEN for another course's name, the source's own name, another case and an archived course's name, and writes nothing", async () => {
      const { source } = await createSource(60, 90);
      await createCourse(BASIC);
      const old = await createCourse({ ...NEXT, name: "Curso Antigo" });
      await archiveCourse(old.id);
      const coursesBefore = await countRows("courses");
      const linksBefore = await countRows("course_lesson_plans");
      const events = collectEvents();

      for (const name of [
        "Informática Básica",
        SOURCE.name,
        "INFORMÁTICA BÁSICA",
        "redes sociais com segurança",
        "  Informática Básica  ",
        "Curso Antigo",
        "CURSO ANTIGO",
      ]) {
        const res = await duplicateCourse(source.id, name).expect(409);

        expect(res.body).toEqual(NAME_TAKEN);
      }

      expect(await countRows("courses")).toBe(coursesBefore);
      expect(await countRows("course_lesson_plans")).toBe(linksBefore);
      expect(events).toEqual([]);
    });

    it("answers one 201 and one 409 COURSE_NAME_TAKEN to two concurrent duplications with the same name", async () => {
      const { source } = await createSource(60, 90);
      const coursesBefore = await countRows("courses");
      const linksBefore = await countRows("course_lesson_plans");
      const events = collectEvents();

      const [first, second] = await Promise.all([
        duplicateCourse(source.id, COPY_NAME, director),
        duplicateCourse(source.id, COPY_NAME.toUpperCase(), coordinator),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const created = first.status === 201 ? first : second;
      const conflict = first.status === 409 ? first : second;
      expect(conflict.body).toEqual(NAME_TAKEN);
      // Only the winner wrote: its course and its 2 links, nothing of the loser.
      expect(await countRows("courses")).toBe(coursesBefore + 1);
      expect(await countRows("course_lesson_plans")).toBe(linksBefore + 2);
      expect(await storedLinks((created.body as CourseBody).id)).toHaveLength(2);
      expect(events.map((event) => event.action)).toEqual([AuditableAction.COURSE_DUPLICATED]);
    });

    it("trims the name and accepts exactly 200 characters", async () => {
      const { source } = await createSource(60);

      const trimmed = await duplicateCourse(source.id, `  ${COPY_NAME}  `).expect(201);
      expect(trimmed.body.name).toBe(COPY_NAME);
      expect(await storedCourse((trimmed.body as CourseBody).id)).toMatchObject({
        name: COPY_NAME,
      });

      const longest = await duplicateCourse(source.id, "n".repeat(200)).expect(201);
      expect(longest.body.name).toBe("n".repeat(200));
    });

    it("returns 400 VALIDATION_FAILED with field name when it is missing, blank, not text or longer than 200, and writes nothing", async () => {
      const { source } = await createSource(60);
      const coursesBefore = await countRows("courses");
      const events = collectEvents();

      for (const body of [
        {},
        { name: "" },
        { name: "   " },
        { name: null },
        { name: 12 },
        { name: ["Redes"] },
        { name: "n".repeat(201) },
        { description: "Sem nome." },
      ]) {
        const res = await postDuplicate(source.id, body).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["name"]);
      }

      expect(await countRows("courses")).toBe(coursesBefore);
      expect(events).toEqual([]);
    });

    it("returns 404 COURSE_NOT_FOUND for an unknown, a malformed and a deleted id, and writes nothing", async () => {
      const { source } = await createSource(60);
      const deleted = await createCourse({ ...NEXT, name: "Curso Excluído" });
      await softDeleteCourse(deleted.id);
      const coursesBefore = await countRows("courses");
      const events = collectEvents();

      for (const id of [randomUUID(), "not-a-uuid", deleted.id]) {
        const res = await duplicateCourse(id).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "COURSE_NOT_FOUND",
          message: "Course not found.",
        });
      }

      expect(await countRows("courses")).toBe(coursesBefore);
      expect(await storedCourse(source.id)).toMatchObject({ name: SOURCE.name });
      expect(events).toEqual([]);
    });

    it("answers 400 for the body, then 404 for the source, then 409 for the name", async () => {
      const { source } = await createSource(60);
      await createCourse(BASIC);

      // The body is validated before the service runs: an invalid one answers 400 whatever the source.
      const invalid = await postDuplicate(randomUUID(), {}).expect(400);
      expect(invalid.body.error).toBe("VALIDATION_FAILED");
      // Then the source is looked up before the name is checked: an unknown source answers 404 even
      // for a name that is taken.
      const unknown = await duplicateCourse(randomUUID(), "Informática Básica").expect(404);
      expect(unknown.body.error).toBe("COURSE_NOT_FOUND");
      // Only a source that exists reaches the name check.
      const taken = await duplicateCourse(source.id, "Informática Básica").expect(409);
      expect(taken.body).toEqual(NAME_TAKEN);
    });

    it("finds the source by an id in upper case and emits the id stored in the database", async () => {
      const { source, plans } = await createSource(60, 90);
      const events = collectEvents();

      const res = await duplicateCourse(source.id.toUpperCase()).expect(201);

      const copy = res.body as CourseBody;
      expect(await storedLinks(copy.id)).toEqual([
        [1, plans[0].id],
        [2, plans[1].id],
      ]);
      expect(events).toHaveLength(1);
      expect(events[0].targetId).toBe(copy.id);
      expect(events[0].after.sourceCourseId).toBe(source.id);
      expect(events[0].after.lessonPlanIds).toEqual([plans[0].id, plans[1].id]);
    });

    it("emits COURSE_DUPLICATED with the copy as target and sourceCourseId in after", async () => {
      const basic = await createCourse(BASIC);
      const source = await createCourse({ ...SOURCE, prerequisiteIds: [basic.id] });
      const [p1, p2, p3] = await createPlans(60, 90, 45);
      await putSequence(source.id, [p3.id, p1.id, p2.id]);
      const events = collectEvents();

      const res = await duplicateCourse(source.id, COPY_NAME, coordinator).expect(201);

      // One event, and no COURSE_CREATED nor COURSE_LESSON_PLANS_REPLACED for the copy.
      expect(events.map((event) => event.action)).toEqual([AuditableAction.COURSE_DUPLICATED]);
      expect(events[0]).toMatchObject({
        actorId: coordinator.id,
        action: AuditableAction.COURSE_DUPLICATED,
        targetType: "course",
        targetId: (res.body as CourseBody).id,
        before: null,
        after: {
          sourceCourseId: source.id,
          name: COPY_NAME,
          description: SOURCE.description,
          objective: SOURCE.objective,
          category: "intermediate",
          lessonPlanIds: [p3.id, p1.id, p2.id],
        },
        occurredAt: expect.any(Date),
      });
      // The payload has no prerequisites: they are not copied.
      expect(Object.keys(events[0].after).sort()).toEqual([
        "category",
        "description",
        "lessonPlanIds",
        "name",
        "objective",
        "sourceCourseId",
      ]);
    });

    it("returns 201 for a director and a coordinator", async () => {
      const { source } = await createSource(60, 90);

      const byDirector = await duplicateCourse(source.id, "Cópia da diretoria", director).expect(
        201,
      );
      const byCoordinator = await duplicateCourse(
        source.id,
        "Cópia da coordenação",
        coordinator,
      ).expect(201);

      expect(byDirector.body.createdById).toBe(director.id);
      expect(byCoordinator.body.createdById).toBe(coordinator.id);
      expect(await countRows("courses")).toBe(3);
      expect(await countRows("course_lesson_plans")).toBe(6);
    });

    it("returns 403 FORBIDDEN for a member and writes nothing", async () => {
      const { source } = await createSource(60, 90);
      const coursesBefore = await countRows("courses");
      const linksBefore = await countRows("course_lesson_plans");
      const events = collectEvents();

      const res = await duplicateCourse(source.id, COPY_NAME, member).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect(await countRows("courses")).toBe(coursesBefore);
      expect(await countRows("course_lesson_plans")).toBe(linksBefore);
      expect(events).toEqual([]);
    });

    it("returns 401 without a session cookie", async () => {
      const { source } = await createSource(60);

      await request(app.getHttpServer())
        .post(`/courses/${source.id}/duplicate`)
        .send({ name: COPY_NAME })
        .expect(401);

      expect(await countRows("courses")).toBe(1);
    });

    it("waits for a sequence replacement in progress (FOR SHARE) and copies the committed sequence", async () => {
      const source = await createCourse(SOURCE);
      const [p1, p2, p3] = await createPlans(60, 90, 30);
      await putSequence(source.id, [p1.id, p2.id]);
      const replacing = dataSource.createQueryRunner();
      await replacing.connect();
      await replacing.startTransaction();
      // What a replacement of the sequence does: lock the course FOR UPDATE, delete the links and
      // insert the new ones (P3 then P1).
      await replacing.query(`SELECT id FROM courses WHERE id = $1 FOR UPDATE`, [source.id]);
      await replacing.query(`DELETE FROM course_lesson_plans WHERE course_id = $1`, [source.id]);
      await replacing.query(
        `INSERT INTO course_lesson_plans (id, course_id, lesson_plan_id, position)
         VALUES (gen_random_uuid(), $1, $2, 1), (gen_random_uuid(), $1, $3, 2)`,
        [source.id, p3.id, p1.id],
      );

      const pending = duplicateCourse(source.id).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FOR SHARE/);
      } finally {
        await replacing.commitTransaction();
        await replacing.release();
      }

      // It read the sequence only after the commit: the copy has the new one, whole.
      const res = await pending;
      expect(res.status).toBe(201);
      expect(await storedLinks(res.body.id)).toEqual([
        [1, p3.id],
        [2, p1.id],
      ]);
      // P3 (30) and P1 (60): the workload of the new sequence, not of the one before (150).
      expect((await detailOf(res.body.id)).plannedWorkloadMinutes).toBe(90);
    });
  });
});
