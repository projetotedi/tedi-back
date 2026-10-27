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

process.env.JWT_SECRET = "e2e-lesson-plan-detail-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const DETAIL_KEYS = [
  "id",
  "title",
  "objective",
  "expectedDurationMinutes",
  "contents",
  "materialUrl",
  "archivedAt",
  "archivedById",
  "archiveReason",
  "createdById",
  "createdAt",
  "updatedAt",
  "status",
  "createdBy",
  "usedIn",
];

const USED_IN_KEYS = [
  "courseId",
  "courseName",
  "category",
  "position",
  "lessonPlanCount",
  "courseStatus",
];

const USAGE_KEYS = ["lessonPlanId", "currentDurationMinutes", "newDurationMinutes", "courses"];

const USAGE_COURSE_KEYS = [
  "courseId",
  "courseName",
  "position",
  "lessonPlanCount",
  "currentWorkloadMinutes",
  "newWorkloadMinutes",
];

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface PlanBody {
  id: string;
  title: string;
  expectedDurationMinutes: number;
}

interface CourseBody {
  id: string;
  name: string;
}

interface UsedInItem {
  courseId: string;
  courseName: string;
  category: string;
  position: number;
  lessonPlanCount: number;
  courseStatus: string;
}

interface DetailBody {
  id: string;
  status: string;
  createdById: string;
  createdBy: { id: string; name: string } | null;
  archivedAt: string | null;
  archivedById: string | null;
  archiveReason: string | null;
  usedIn: UsedInItem[];
}

interface UsageCourse {
  courseId: string;
  courseName: string;
  position: number;
  lessonPlanCount: number;
  currentWorkloadMinutes: number;
  newWorkloadMinutes: number;
}

interface UsageBody {
  lessonPlanId: string;
  currentDurationMinutes: number;
  newDurationMinutes: number;
  courses: UsageCourse[];
}

interface SequenceItem {
  position: number;
  lessonPlanId: string;
  courseCount: number;
}

interface SequenceBody {
  courseId: string;
  plannedWorkloadMinutes: number;
  items: SequenceItem[];
}

/**
 * The scenario of the card: X (90 min) is 2nd of 4 in "Curso A" (workload 360) and 5th of 6 in
 * "Curso B" (workload 600). `othersA` and `othersB` are the other plans of each sequence, in order.
 */
interface Scenario {
  x: PlanBody;
  courseA: CourseBody;
  courseB: CourseBody;
  othersA: PlanBody[];
  othersB: PlanBody[];
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

function sorted(keys: readonly string[]): string[] {
  return [...keys].sort();
}

describe("Lesson plan detail and usage (e2e)", () => {
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

  async function createLessonPlan(
    title: string,
    expectedDurationMinutes: number,
    actor: Actor = director,
  ): Promise<PlanBody> {
    const res = await request(app.getHttpServer())
      .post("/lesson-plans")
      .set("Cookie", actor.cookie)
      .send({ title, expectedDurationMinutes, contents: [`Conteúdo de ${title}`] })
      .expect(201);
    return res.body as PlanBody;
  }

  /** Creates plans "<prefix>1".."<prefix>n" with the durations in minutes. */
  async function createPlans(prefix: string, ...durations: number[]): Promise<PlanBody[]> {
    const plans: PlanBody[] = [];
    for (const [index, minutes] of durations.entries()) {
      plans.push(await createLessonPlan(`${prefix}${index + 1}`, minutes));
    }
    return plans;
  }

  async function createCourse(name: string, category = "basic"): Promise<CourseBody> {
    const res = await request(app.getHttpServer())
      .post("/courses")
      .set("Cookie", director.cookie)
      .send({ name, description: `Descrição de ${name}.`, category })
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
    const x = await createLessonPlan("X", 90);
    const othersA = await createPlans("A", 90, 90, 90);
    const othersB = await createPlans("B", 120, 120, 90, 90, 90);
    const courseA = await createCourse("Curso A", "basic");
    const courseB = await createCourse("Curso B", "advanced");

    await setSequence(courseA.id, [othersA[0].id, x.id, othersA[1].id, othersA[2].id]);
    await setSequence(courseB.id, [
      othersB[0].id,
      othersB[1].id,
      othersB[2].id,
      othersB[3].id,
      x.id,
      othersB[4].id,
    ]);

    return { x, courseA, courseB, othersA, othersB };
  }

  function getDetail(id: string, actor: Actor = director) {
    return request(app.getHttpServer()).get(`/lesson-plans/${id}`).set("Cookie", actor.cookie);
  }

  function getUsage(id: string, actor: Actor = director, query?: Record<string, unknown>) {
    const usage = request(app.getHttpServer())
      .get(`/lesson-plans/${id}/usage`)
      .set("Cookie", actor.cookie);
    return query === undefined ? usage : usage.query(query);
  }

  function getSequence(courseId: string, actor: Actor = director) {
    return request(app.getHttpServer())
      .get(`/courses/${courseId}/lesson-plans`)
      .set("Cookie", actor.cookie);
  }

  function archivePlan(id: string, reason?: string) {
    return request(app.getHttpServer())
      .patch(`/lesson-plans/${id}/archive`)
      .set("Cookie", coordinator.cookie)
      .send(reason === undefined ? {} : { reason })
      .expect(200);
  }

  function updatePlanDuration(id: string, expectedDurationMinutes: number) {
    return request(app.getHttpServer())
      .patch(`/lesson-plans/${id}`)
      .set("Cookie", director.cookie)
      .send({ expectedDurationMinutes })
      .expect(200);
  }

  /** The archive route of courses is GUS-116: until it exists, a course is archived in the table. */
  async function archiveCourse(id: string): Promise<void> {
    await dataSource.query(
      `UPDATE courses SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
      [id, coordinator.id],
    );
  }

  async function softDelete(table: "courses" | "lesson_plans" | "people", id: string) {
    await dataSource.query(`UPDATE ${table} SET deleted_at = now() WHERE id = $1`, [id]);
  }

  async function softDeleteLink(courseId: string, lessonPlanId: string): Promise<void> {
    await dataSource.query(
      `UPDATE course_lesson_plans SET deleted_at = now() WHERE course_id = $1 AND lesson_plan_id = $2`,
      [courseId, lessonPlanId],
    );
  }

  async function storedPlan(
    id: string,
  ): Promise<{ expected_duration_minutes: number; updated_at: Date }> {
    const rows: Array<{ expected_duration_minutes: number; updated_at: Date }> =
      await dataSource.query(
        `SELECT expected_duration_minutes, updated_at FROM lesson_plans WHERE id = $1`,
        [id],
      );
    return rows[0];
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  describe("GET /lesson-plans/:id (getLessonPlan)", () => {
    it("answers usedIn with the position of the plan in each course and the length of each sequence", async () => {
      const { x, courseA, courseB } = await createScenario();

      const res = await getDetail(x.id).expect(200);
      const body = res.body as DetailBody;

      expect(body.status).toBe("in_use");
      expect(body.usedIn).toEqual([
        {
          courseId: courseA.id,
          courseName: "Curso A",
          category: "basic",
          position: 2,
          lessonPlanCount: 4,
          courseStatus: "active",
        },
        {
          courseId: courseB.id,
          courseName: "Curso B",
          category: "advanced",
          position: 5,
          lessonPlanCount: 6,
          courseStatus: "active",
        },
      ]);
    });

    it("answers usedIn [] and status unused for a plan in no course", async () => {
      const plan = await createLessonPlan("Sem uso", 90);

      const res = await getDetail(plan.id).expect(200);

      expect(res.body.usedIn).toEqual([]);
      expect(res.body.status).toBe("unused");
    });

    it("answers status in_use and createdBy with the id and name of the creator", async () => {
      const { x } = await createScenario();

      // Read by a member, created by the director: createdBy is who created, not who reads.
      const res = await getDetail(x.id, member).expect(200);
      const body = res.body as DetailBody;

      expect(body.status).toBe("in_use");
      expect(body.createdById).toBe(director.id);
      expect(body.createdBy).toEqual({ id: director.id, name: "Director" });
    });

    it("orders usedIn by course name, accents included", async () => {
      const plan = await createLessonPlan("X", 90);
      const names = ["Zoologia", "Banco de dados", "Excel", "Álgebra"];
      for (const name of names) {
        const course = await createCourse(name);
        await setSequence(course.id, [plan.id]);
      }

      const res = await getDetail(plan.id).expect(200);

      expect((res.body as DetailBody).usedIn.map((item) => item.courseName)).toEqual([
        "Álgebra",
        "Banco de dados",
        "Excel",
        "Zoologia",
      ]);
    });

    it("includes archived courses with courseStatus archived and leaves soft-deleted courses out", async () => {
      const plan = await createLessonPlan("X", 90);
      const onlyInDeleted = await createLessonPlan("Y", 45);
      const active = await createCourse("Curso ativo");
      const archived = await createCourse("Curso arquivado");
      const deleted = await createCourse("Curso excluído");
      const unlinked = await createCourse("Curso sem o vínculo");
      await setSequence(active.id, [plan.id]);
      await setSequence(archived.id, [plan.id]);
      await setSequence(deleted.id, [plan.id, onlyInDeleted.id]);
      await setSequence(unlinked.id, [plan.id]);
      await archiveCourse(archived.id);
      await softDelete("courses", deleted.id);
      await softDeleteLink(unlinked.id, plan.id);

      const res = await getDetail(plan.id).expect(200);

      expect(
        (res.body as DetailBody).usedIn.map((item) => [item.courseName, item.courseStatus]),
      ).toEqual([
        ["Curso arquivado", "archived"],
        ["Curso ativo", "active"],
      ]);
      expect(res.body.status).toBe("in_use");

      const other = await getDetail(onlyInDeleted.id).expect(200);

      expect(other.body.usedIn).toEqual([]);
      expect(other.body.status).toBe("unused");
    });

    it("answers usedIn with as many courses as courseCount in listCourseLessonPlans", async () => {
      const plan = await createLessonPlan("X", 90);
      const courses = [
        await createCourse("Curso 1"),
        await createCourse("Curso 2"),
        await createCourse("Curso 3"),
      ];
      for (const course of courses) await setSequence(course.id, [plan.id]);
      await archiveCourse(courses[2].id);

      const sequence = (await getSequence(courses[0].id).expect(200)).body as SequenceBody;
      const item = sequence.items.find((candidate) => candidate.lessonPlanId === plan.id);
      const detail = (await getDetail(plan.id).expect(200)).body as DetailBody;

      expect(item?.courseCount).toBe(3);
      expect(detail.usedIn).toHaveLength(item?.courseCount ?? -1);
    });

    it("answers createdBy null when the creator was soft-deleted", async () => {
      const former = await createActor("Former director", Role.DIRECTOR);
      const plan = await createLessonPlan("X", 90, former);
      await softDelete("people", former.id);

      const res = await getDetail(plan.id).expect(200);
      const body = res.body as DetailBody;

      expect(body.createdBy).toBeNull();
      expect(body.createdById).toBe(former.id);
    });

    it("keeps an archived plan readable, with archivedAt, its usedIn and its usage", async () => {
      const { x, courseA, courseB } = await createScenario();
      const unused = await createLessonPlan("Y", 45);
      await archivePlan(x.id, "Conteúdo revisado.");
      await archivePlan(unused.id);

      const detail = await getDetail(x.id, member).expect(200);

      expect(detail.body).toMatchObject({
        id: x.id,
        archivedAt: expect.any(String),
        archivedById: coordinator.id,
        archiveReason: "Conteúdo revisado.",
        status: "in_use",
      });
      expect((detail.body as DetailBody).usedIn.map((item) => item.courseId)).toEqual([
        courseA.id,
        courseB.id,
      ]);

      const usage = await getUsage(x.id, member, { expectedDurationMinutes: 120 }).expect(200);

      expect(
        (usage.body as UsageBody).courses.map((course) => [
          course.currentWorkloadMinutes,
          course.newWorkloadMinutes,
        ]),
      ).toEqual([
        [360, 390],
        [600, 630],
      ]);

      // The status is about use, not about archiving: an archived plan in no course is unused.
      const archivedUnused = await getDetail(unused.id).expect(200);

      expect(archivedUnused.body.archivedAt).toEqual(expect.any(String));
      expect(archivedUnused.body.status).toBe("unused");
    });

    it("answers exactly the keys of LessonPlanDetailDto", async () => {
      const { x } = await createScenario();

      const res = await getDetail(x.id).expect(200);

      expect(Object.keys(res.body).sort()).toEqual(sorted(DETAIL_KEYS));
      expect(Object.keys(res.body.createdBy).sort()).toEqual(["id", "name"]);
      for (const item of (res.body as DetailBody).usedIn) {
        expect(Object.keys(item).sort()).toEqual(sorted(USED_IN_KEYS));
      }
    });

    it("finds the plan by an id in upper case and answers the id stored in the database", async () => {
      const { x, courseA, courseB } = await createScenario();

      const res = await getDetail(x.id.toUpperCase()).expect(200);
      const body = res.body as DetailBody;

      expect(body.id).toBe(x.id);
      expect(body.usedIn.map((item) => item.courseId)).toEqual([courseA.id, courseB.id]);
    });

    it("emits no audit event and changes nothing", async () => {
      const { x } = await createScenario();
      const before = await storedPlan(x.id);
      const events = collectEvents();

      await getDetail(x.id).expect(200);

      expect(events).toEqual([]);
      expect(await storedPlan(x.id)).toEqual(before);
    });

    it("returns 200 for a member", async () => {
      const { x } = await createScenario();

      await getDetail(x.id, member).expect(200);
    });

    it("returns 404 LESSON_PLAN_NOT_FOUND in the ApiErrorDto format for a random uuid and a malformed id", async () => {
      for (const id of [randomUUID(), "not-a-uuid"]) {
        const res = await getDetail(id).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "LESSON_PLAN_NOT_FOUND",
          message: "Lesson plan not found.",
        });
      }
    });

    it("returns 401 without a session cookie", async () => {
      const { x } = await createScenario();

      await request(app.getHttpServer()).get(`/lesson-plans/${x.id}`).expect(401);
    });
  });

  describe("GET /lesson-plans/:id/usage (getLessonPlanUsage)", () => {
    it("recalculates the workload of each course with the new duration: A 360 → 390 and B 600 → 630", async () => {
      const { x, courseA, courseB } = await createScenario();
      const before = await storedPlan(x.id);
      const events = collectEvents();

      const res = await getUsage(x.id, director, { expectedDurationMinutes: 120 }).expect(200);

      expect(res.body).toEqual({
        lessonPlanId: x.id,
        currentDurationMinutes: 90,
        newDurationMinutes: 120,
        courses: [
          {
            courseId: courseA.id,
            courseName: "Curso A",
            position: 2,
            lessonPlanCount: 4,
            currentWorkloadMinutes: 360,
            newWorkloadMinutes: 390,
          },
          {
            courseId: courseB.id,
            courseName: "Curso B",
            position: 5,
            lessonPlanCount: 6,
            currentWorkloadMinutes: 600,
            newWorkloadMinutes: 630,
          },
        ],
      });
      // Only a simulation: the duration of X is still 90, and nothing was written or emitted.
      expect(await storedPlan(x.id)).toEqual(before);
      expect(events).toEqual([]);
    });

    it("recalculates with a shorter duration too: 90 → 30 gives A 300 and B 540", async () => {
      const { x } = await createScenario();

      const res = await getUsage(x.id, director, { expectedDurationMinutes: 30 }).expect(200);
      const body = res.body as UsageBody;

      expect(body.newDurationMinutes).toBe(30);
      expect(body.courses.map((course) => course.newWorkloadMinutes)).toEqual([300, 540]);
      expect(body.courses.map((course) => course.currentWorkloadMinutes)).toEqual([360, 600]);
    });

    it("repeats the current workload as newWorkloadMinutes without the parameter", async () => {
      const { x } = await createScenario();

      const res = await getUsage(x.id).expect(200);
      const body = res.body as UsageBody;

      expect(body.currentDurationMinutes).toBe(90);
      expect(body.newDurationMinutes).toBe(90);
      expect(
        body.courses.map((course) => [course.currentWorkloadMinutes, course.newWorkloadMinutes]),
      ).toEqual([
        [360, 360],
        [600, 600],
      ]);
    });

    it("answers currentWorkloadMinutes equal to plannedWorkloadMinutes of listCourseLessonPlans", async () => {
      const { x, othersA } = await createScenario();
      // An archived plan stays in its sequence and its duration still counts.
      await archivePlan(othersA[0].id);

      const usage = (await getUsage(x.id, director, { expectedDurationMinutes: 120 }).expect(200))
        .body as UsageBody;

      expect(usage.courses).toHaveLength(2);
      for (const course of usage.courses) {
        const sequence = (await getSequence(course.courseId).expect(200)).body as SequenceBody;
        const own = sequence.items.find((item) => item.lessonPlanId === x.id);

        expect(course.currentWorkloadMinutes).toBe(sequence.plannedWorkloadMinutes);
        expect(course.lessonPlanCount).toBe(sequence.items.length);
        expect(course.position).toBe(own?.position);
      }
    });

    it("predicts the workload that the sequences answer after PATCH /lesson-plans/:id saves the duration", async () => {
      const { x, courseA, courseB } = await createScenario();

      const usage = (await getUsage(x.id, director, { expectedDurationMinutes: 120 }).expect(200))
        .body as UsageBody;
      await updatePlanDuration(x.id, 120);

      for (const course of usage.courses) {
        const sequence = (await getSequence(course.courseId).expect(200)).body as SequenceBody;

        expect(sequence.plannedWorkloadMinutes).toBe(course.newWorkloadMinutes);
      }
      expect([courseA.id, courseB.id]).toEqual(usage.courses.map((course) => course.courseId));

      const after = (await getUsage(x.id).expect(200)).body as UsageBody;

      expect(after.currentDurationMinutes).toBe(120);
      expect(after.courses.map((course) => course.currentWorkloadMinutes)).toEqual([390, 630]);
    });

    it("leaves soft-deleted links and plans out of the counts, as the sequence does", async () => {
      const { x, courseA, othersA, othersB } = await createScenario();
      await softDeleteLink(courseA.id, othersA[1].id);
      await softDelete("lesson_plans", othersB[4].id);

      const usage = (await getUsage(x.id, director, { expectedDurationMinutes: 120 }).expect(200))
        .body as UsageBody;

      expect(
        usage.courses.map((course) => [
          course.lessonPlanCount,
          course.currentWorkloadMinutes,
          course.newWorkloadMinutes,
        ]),
      ).toEqual([
        [3, 270, 300],
        [5, 510, 540],
      ]);
      for (const course of usage.courses) {
        const sequence = (await getSequence(course.courseId).expect(200)).body as SequenceBody;

        expect(sequence.items).toHaveLength(course.lessonPlanCount);
        expect(sequence.plannedWorkloadMinutes).toBe(course.currentWorkloadMinutes);
      }
    });

    it("answers courses [] on usage for a plan in no course", async () => {
      const plan = await createLessonPlan("Sem uso", 90);

      const res = await getUsage(plan.id, director, { expectedDurationMinutes: 120 }).expect(200);

      expect(res.body).toEqual({
        lessonPlanId: plan.id,
        currentDurationMinutes: 90,
        newDurationMinutes: 120,
        courses: [],
      });
    });

    it("returns 400 VALIDATION_FAILED with field expectedDurationMinutes for 0, 1441, 1.5 and abc", async () => {
      const { x } = await createScenario();

      for (const expectedDurationMinutes of [0, 1441, 1.5, "abc", ""]) {
        const res = await getUsage(x.id, director, { expectedDurationMinutes }).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["expectedDurationMinutes"]);
      }
    });

    it("accepts the limits 1 and 1440 minutes", async () => {
      const { x } = await createScenario();

      for (const [expectedDurationMinutes, newWorkload] of [
        [1, 271],
        [1440, 1710],
      ]) {
        const res = await getUsage(x.id, director, { expectedDurationMinutes }).expect(200);

        expect((res.body as UsageBody).courses[0].newWorkloadMinutes).toBe(newWorkload);
      }
    });

    it("answers exactly the keys of LessonPlanUsageResponseDto", async () => {
      const { x } = await createScenario();

      const res = await getUsage(x.id, director, { expectedDurationMinutes: 120 }).expect(200);

      expect(Object.keys(res.body).sort()).toEqual(sorted(USAGE_KEYS));
      for (const course of (res.body as UsageBody).courses) {
        expect(Object.keys(course).sort()).toEqual(sorted(USAGE_COURSE_KEYS));
      }
    });

    it("finds the plan by an id in upper case and answers the lessonPlanId stored in the database", async () => {
      const { x, courseA, courseB } = await createScenario();

      const res = await getUsage(x.id.toUpperCase(), director, {
        expectedDurationMinutes: 120,
      }).expect(200);
      const body = res.body as UsageBody;

      expect(body.lessonPlanId).toBe(x.id);
      expect(body.courses.map((course) => course.courseId)).toEqual([courseA.id, courseB.id]);
    });

    it("emits no audit event", async () => {
      const { x } = await createScenario();
      const events = collectEvents();

      await getUsage(x.id).expect(200);
      await getUsage(x.id, director, { expectedDurationMinutes: 120 }).expect(200);

      expect(events).toEqual([]);
    });

    it("returns 404 LESSON_PLAN_NOT_FOUND on usage for an unknown and a malformed id", async () => {
      for (const id of [randomUUID(), "not-a-uuid"]) {
        const res = await getUsage(id, director, { expectedDurationMinutes: 120 }).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "LESSON_PLAN_NOT_FOUND",
          message: "Lesson plan not found.",
        });
      }
    });

    it("returns 200 for a member", async () => {
      const { x } = await createScenario();

      await getUsage(x.id, member, { expectedDurationMinutes: 120 }).expect(200);
    });

    it("returns 401 without a session cookie", async () => {
      const { x } = await createScenario();

      await request(app.getHttpServer())
        .get(`/lesson-plans/${x.id}/usage`)
        .query({ expectedDurationMinutes: 120 })
        .expect(401);
    });
  });
});
