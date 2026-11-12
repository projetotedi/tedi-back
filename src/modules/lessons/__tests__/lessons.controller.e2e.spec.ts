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
import { CourseLessonPlansService } from "@modules/catalog/services/course-lesson-plans.service";
import { CoursesService } from "@modules/catalog/services/courses.service";
import { LessonPlansService } from "@modules/catalog/services/lesson-plans.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import {
  LESSON_CANCELLED_EVENT,
  LessonCancelledEvent,
} from "@shared/events/lesson-cancelled.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { LessonsModule } from "../lessons.module";
import { CLASS_PERIOD, lessonBody } from "./fixtures/lessons.fixture";

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

process.env.JWT_SECRET = "e2e-lessons-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

const PLAN_TITLE = "Plano: teclado, mouse e janelas";
const PLAN_OBJECTIVE = "Familiarizar o aluno com o teclado, o mouse e o uso básico das janelas.";

type CreateCourseInput = Parameters<CoursesService["create"]>[0];

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface LessonBody extends Record<string, unknown> {
  id: string;
  class: {
    id: string;
    code: string;
    name: string | null;
    startDate: string;
    endDate: string;
    archivedAt: string | null;
  };
  course: { id: string; name: string };
  edition: { id: string; name: string };
  lessonPlan: { id: string; title: string; archivedAt: string | null } | null;
  sequenceOrder: number | null;
  title: string;
  objective: string | null;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  location: string | null;
  expectedStudents: number | null;
  expectedMonitors: number | null;
  subject: string | null;
  postNotes: string | null;
  status: string;
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
  originalDate: string | null;
  rescheduleReason: string | null;
  rescheduleNote: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

describe("LessonsController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonPlansService: LessonPlansService;
  let courseLessonPlansService: CourseLessonPlansService;

  let director: Actor;
  let coordinator: Actor;
  let member: Actor;
  let superadmin: Actor;
  let courseId: string;
  let classId: string;
  /** The lesson plan at position 1 of the sequence of the course. */
  let planId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          // Every entity: the foreign keys of Lesson point to other modules' tables by name.
          entities: [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
        AuthModule,
        PeopleModule,
        CatalogModule,
        ClassesModule,
        LessonsModule,
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
    coursesService = module.get(CoursesService);
    classesService = module.get(ClassesService);
    lessonPlansService = module.get(LessonPlansService);
    courseLessonPlansService = module.get(CourseLessonPlansService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE lessons, classes, editions, course_lesson_plans, lesson_plan_contents,
                      lesson_plans, course_prerequisites, courses, people
       RESTART IDENTITY CASCADE`,
    );

    director = await createActor("Director", Role.DIRECTOR);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    member = await createActor("Member", Role.MEMBER);
    superadmin = await createActor("Superadmin", Role.SUPERADMIN);

    courseId = await createCourse("Informática Básica");
    classId = await createClassOf(courseId, "INFO-A");
    planId = await createPlan(PLAN_TITLE, PLAN_OBJECTIVE);
    await courseLessonPlansService.replace(courseId, { lessonPlanIds: [planId] }, director.id);
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
    eventEmitter.removeAllListeners(LESSON_CANCELLED_EVENT);
  });

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /** The scenery comes from the services that the other modules export, not from their tables. */
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

  /** A class of the course in 2026.1, from 2026-03-03 to 2026-06-27 (CLASS_PERIOD). */
  async function createClassOf(forCourseId: string, code: string): Promise<string> {
    const schoolClass = await classesService.create(
      {
        courseId: forCourseId,
        code,
        editionName: "2026.1",
        ...CLASS_PERIOD,
        capacity: 15,
      },
      director.id,
    );
    return schoolClass.id;
  }

  async function createPlan(title: string, objective: string | null = null): Promise<string> {
    const plan = await lessonPlansService.create(
      { title, objective, expectedDurationMinutes: 90, contents: ["Teclado e mouse"] },
      director.id,
    );
    return plan.id;
  }

  /** The body of a lesson of the class of the scenery. */
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return lessonBody({ classId, ...overrides });
  }

  function postLesson(actor: Actor, payload: Record<string, unknown>) {
    return request(app.getHttpServer()).post("/lessons").set("Cookie", actor.cookie).send(payload);
  }

  function getLesson(id: string, actor: Actor) {
    return request(app.getHttpServer()).get(`/lessons/${id}`).set("Cookie", actor.cookie);
  }

  function patchLesson(id: string, actor: Actor, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/lessons/${id}`)
      .set("Cookie", actor.cookie)
      .send(payload);
  }

  function cancelLesson(id: string, actor: Actor, payload: Record<string, unknown> | undefined) {
    const req = request(app.getHttpServer())
      .patch(`/lessons/${id}/cancel`)
      .set("Cookie", actor.cookie);
    return payload === undefined ? req : req.send(payload);
  }

  function rescheduleLesson(id: string, actor: Actor, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/lessons/${id}/reschedule`)
      .set("Cookie", actor.cookie)
      .send(payload);
  }

  async function createLesson(
    payload: Record<string, unknown> = body(),
    actor = director,
  ): Promise<LessonBody> {
    const res = await postLesson(actor, payload).expect(201);
    return res.body as LessonBody;
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  function collectCancelled(): LessonCancelledEvent[] {
    const events: LessonCancelledEvent[] = [];
    eventEmitter.on(LESSON_CANCELLED_EVENT, (event: LessonCancelledEvent) => events.push(event));
    return events;
  }

  async function countLessons(): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM lessons`,
    );
    return Number(rows[0].total);
  }

  /** The row as the table has it, with the dates and the times as text so no time zone gets in the way. */
  async function storedLesson(id: string): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT class_id, lesson_plan_id, sequence_order, title, objective, date::text AS date,
              start_time::text AS start_time, end_time::text AS end_time, location,
              expected_students, expected_monitors, subject, post_notes, status, cancel_reason,
              cancelled_at, cancelled_by_id, original_date::text AS original_date,
              reschedule_reason, reschedule_note, created_by_id, deleted_at, updated_at
         FROM lessons WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  /**
   * The text of a statement that is waiting for a lock, or undefined after 3 seconds. Postgres cuts
   * the text at 1024 bytes (track_activity_query_size), so the FOR SHARE or FOR UPDATE at the end of
   * a long select may not be visible. It does not need to be: a plain SELECT is never blocked by a
   * row lock (MVCC), so a select that waits proves it takes the lock.
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

  /**
   * Holds the row of a table in a transaction of its own, with the lock that is asked, as a
   * concurrent write of another module (or another request) would. `run` runs a statement inside
   * that transaction; `release` commits it.
   */
  async function holdRow(table: "classes" | "lessons" | "lesson_plans", id: string, lock: string) {
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(`SELECT id FROM ${table} WHERE id = $1 ${lock}`, [id]);

    return {
      run: (sql: string, parameters: unknown[]) => holder.query(sql, parameters),
      release: async () => {
        await holder.commitTransaction();
        await holder.release();
      },
    };
  }

  describe("POST /lessons (createLesson)", () => {
    it("director creates a lesson without a plan (201, status planned, durationMinutes)", async () => {
      const res = await postLesson(director, body()).expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        class: {
          id: classId,
          code: "INFO-A",
          name: null,
          startDate: "2026-03-03",
          endDate: "2026-06-27",
          archivedAt: null,
        },
        course: { id: courseId, name: "Informática Básica" },
        edition: { id: expect.any(String), name: "2026.1" },
        lessonPlan: null,
        sequenceOrder: null,
        title: "Teclado, mouse e janelas",
        objective: null,
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        durationMinutes: 90,
        location: null,
        expectedStudents: null,
        expectedMonitors: null,
        subject: null,
        postNotes: null,
        status: "planned",
        cancelReason: null,
        cancelledAt: null,
        cancelledById: null,
        originalDate: null,
        rescheduleReason: null,
        rescheduleNote: null,
        createdById: director.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      expect(await countLessons()).toBe(1);
      expect(await storedLesson(res.body.id)).toMatchObject({
        class_id: classId,
        lesson_plan_id: null,
        sequence_order: null,
        title: "Teclado, mouse e janelas",
        objective: null,
        date: "2026-03-10",
        start_time: "14:00:00",
        end_time: "15:30:00",
        status: "planned",
        created_by_id: director.id,
        cancelled_at: null,
        original_date: null,
        deleted_at: null,
      });
    });

    it("coordinator creates a lesson from a plan in the course sequence with sequenceOrder", async () => {
      const res = await postLesson(
        coordinator,
        body({ title: undefined, lessonPlanId: planId, sequenceOrder: 1 }),
      ).expect(201);

      expect(res.body).toMatchObject({
        sequenceOrder: 1,
        title: PLAN_TITLE,
        objective: PLAN_OBJECTIVE,
        lessonPlan: { id: planId, title: PLAN_TITLE, archivedAt: null },
        status: "planned",
        createdById: coordinator.id,
      });
      expect(await storedLesson(res.body.id)).toMatchObject({
        lesson_plan_id: planId,
        sequence_order: 1,
        title: PLAN_TITLE,
        objective: PLAN_OBJECTIVE,
      });
    });

    it("superadmin creates a lesson", async () => {
      const res = await postLesson(superadmin, body()).expect(201);

      expect(res.body.createdById).toBe(superadmin.id);
    });

    it("copies title and objective from the plan and keeps them after PATCH /lesson-plans/:id", async () => {
      const created = await createLesson(body({ title: undefined, lessonPlanId: planId }));
      expect(created.title).toBe(PLAN_TITLE);
      expect(created.objective).toBe(PLAN_OBJECTIVE);

      // The plan is edited through its own route, by HTTP.
      await request(app.getHttpServer())
        .patch(`/lesson-plans/${planId}`)
        .set("Cookie", director.cookie)
        .send({ title: "Título novo do plano", objective: "Objetivo novo do plano." })
        .expect(200);

      const read = await getLesson(created.id, member).expect(200);
      // The lesson keeps the text it copied (RN-18)...
      expect(read.body.title).toBe(PLAN_TITLE);
      expect(read.body.objective).toBe(PLAN_OBJECTIVE);
      // ...and the reference shows what the plan is called now.
      expect(read.body.lessonPlan).toEqual({
        id: planId,
        title: "Título novo do plano",
        archivedAt: null,
      });
      expect(await storedLesson(created.id)).toMatchObject({
        title: PLAN_TITLE,
        objective: PLAN_OBJECTIVE,
      });
    });

    it("body title and objective win over the plan", async () => {
      const res = await postLesson(
        director,
        body({ lessonPlanId: planId, title: "Título da turma", objective: "Objetivo da turma." }),
      ).expect(201);

      expect(res.body).toMatchObject({
        title: "Título da turma",
        objective: "Objetivo da turma.",
        lessonPlan: { id: planId },
      });
    });

    it("leaves the objective empty when the body sends null, and copies only the title", async () => {
      const res = await postLesson(
        director,
        body({ title: undefined, lessonPlanId: planId, objective: null }),
      ).expect(201);

      expect(res.body.title).toBe(PLAN_TITLE);
      expect(res.body.objective).toBeNull();
    });

    it("creates an extra lesson from a plan that is not in the sequence, when no sequenceOrder is sent", async () => {
      const otherPlanId = await createPlan("Plano fora da sequência", "Objetivo do plano de fora.");

      const res = await postLesson(
        director,
        body({ title: undefined, lessonPlanId: otherPlanId }),
      ).expect(201);

      expect(res.body).toMatchObject({
        sequenceOrder: null,
        title: "Plano fora da sequência",
        lessonPlan: { id: otherPlanId },
      });
    });

    it("answers 400 LESSON_PLAN_NOT_IN_COURSE_SEQUENCE when the position is not the one of the plan, or the plan is not in the sequence", async () => {
      const secondPlanId = await createPlan("Segundo plano");
      await courseLessonPlansService.replace(
        courseId,
        { lessonPlanIds: [planId, secondPlanId] },
        director.id,
      );
      const outsidePlanId = await createPlan("Plano fora da sequência");

      // The second plan is at position 2, not 1.
      const wrongPosition = await postLesson(
        director,
        body({ lessonPlanId: secondPlanId, sequenceOrder: 1 }),
      ).expect(400);
      expect(wrongPosition.body.error).toBe("LESSON_PLAN_NOT_IN_COURSE_SEQUENCE");
      expect(fieldsOf(wrongPosition.body)).toEqual(["sequenceOrder"]);

      const notInSequence = await postLesson(
        director,
        body({ lessonPlanId: outsidePlanId, sequenceOrder: 1 }),
      ).expect(400);
      expect(notInSequence.body.error).toBe("LESSON_PLAN_NOT_IN_COURSE_SEQUENCE");

      expect(await countLessons()).toBe(0);

      const right = await postLesson(
        director,
        body({ lessonPlanId: secondPlanId, sequenceOrder: 2 }),
      ).expect(201);
      expect(right.body.sequenceOrder).toBe(2);
    });

    it("keeps the position the plan had when the lesson was created, though the sequence changes later", async () => {
      const created = await createLesson(
        body({ title: undefined, lessonPlanId: planId, sequenceOrder: 1 }),
      );

      await courseLessonPlansService.replace(courseId, { lessonPlanIds: [] }, director.id);

      const read = await getLesson(created.id, director).expect(200);
      expect(read.body.sequenceOrder).toBe(1);
    });

    it("stores the optional fields it receives, trimmed", async () => {
      const res = await postLesson(
        director,
        body({
          title: "  Teclado e mouse  ",
          objective: "  Objetivo da aula.  ",
          location: "  Laboratório 3, bloco B  ",
          expectedStudents: 15,
          expectedMonitors: 2,
          subject: "  Primeiro contato com o computador  ",
        }),
      ).expect(201);

      expect(res.body).toMatchObject({
        title: "Teclado e mouse",
        objective: "Objetivo da aula.",
        location: "Laboratório 3, bloco B",
        expectedStudents: 15,
        expectedMonitors: 2,
        subject: "Primeiro contato com o computador",
      });
      expect(await storedLesson(res.body.id)).toMatchObject({
        title: "Teclado e mouse",
        objective: "Objetivo da aula.",
        location: "Laboratório 3, bloco B",
        expected_students: 15,
        expected_monitors: 2,
        subject: "Primeiro contato com o computador",
      });
    });

    it("treats blanks and nulls as not informed, and keeps a head count of zero", async () => {
      const res = await postLesson(
        director,
        body({
          objective: "   ",
          location: null,
          subject: "",
          expectedStudents: 0,
          expectedMonitors: null,
        }),
      ).expect(201);

      expect(res.body).toMatchObject({
        objective: null,
        location: null,
        subject: null,
        expectedStudents: 0,
        expectedMonitors: null,
      });
    });

    it("accepts the largest values the DTO allows and stores them whole", async () => {
      const res = await postLesson(
        director,
        body({
          title: "t".repeat(200),
          objective: "o".repeat(2000),
          location: "l".repeat(200),
          subject: "s".repeat(200),
          expectedStudents: 1000,
          expectedMonitors: 100,
          startTime: "00:00",
          endTime: "23:59",
        }),
      ).expect(201);

      expect(res.body.durationMinutes).toBe(1439);
      expect(await storedLesson(res.body.id)).toMatchObject({
        title: "t".repeat(200),
        objective: "o".repeat(2000),
        location: "l".repeat(200),
        subject: "s".repeat(200),
        expected_students: 1000,
        expected_monitors: 100,
        start_time: "00:00:00",
        end_time: "23:59:00",
      });
    });

    it("reads the ids in upper case as the ids of the database and answers them in lower case", async () => {
      const res = await postLesson(
        director,
        body({
          classId: classId.toUpperCase(),
          lessonPlanId: planId.toUpperCase(),
          title: undefined,
        }),
      ).expect(201);

      expect(res.body.class.id).toBe(classId);
      expect(res.body.lessonPlan.id).toBe(planId);
    });

    it("ignores the fields the client has no say in: the status, the notes and the audit columns", async () => {
      const res = await postLesson(
        director,
        body({
          status: "done",
          postNotes: "Notas.",
          cancelReason: "x",
          cancelledAt: "2026-03-01T00:00:00Z",
          cancelledById: member.id,
          originalDate: "2026-01-01",
          createdById: member.id,
          id: UNKNOWN_ID,
        }),
      ).expect(201);

      expect(res.body).toMatchObject({
        status: "planned",
        postNotes: null,
        cancelReason: null,
        cancelledAt: null,
        cancelledById: null,
        originalDate: null,
        createdById: director.id,
      });
      expect(res.body.id).not.toBe(UNKNOWN_ID);
    });

    it("creates two lessons of the same class on the same day and time: nothing forbids a clash", async () => {
      const first = await createLesson();
      const second = await createLesson();

      expect(second.id).not.toBe(first.id);
      expect(await countLessons()).toBe(2);
    });

    describe("the period of the class", () => {
      it.each([
        ["the day before the start", CLASS_PERIOD.startDate, -1],
        ["the day after the end", CLASS_PERIOD.endDate, 1],
      ])(
        "POST with a date before or after the class period answers 400 LESSON_OUTSIDE_CLASS_PERIOD (%s)",
        async (_label, edge, shift) => {
          const moved = new Date(`${edge}T12:00:00Z`);
          moved.setUTCDate(moved.getUTCDate() + shift);
          const date = moved.toISOString().slice(0, 10);

          const res = await postLesson(director, body({ date })).expect(400);

          expect(res.body.error).toBe("LESSON_OUTSIDE_CLASS_PERIOD");
          expect(fieldsOf(res.body)).toEqual(["date"]);
          expect(await countLessons()).toBe(0);
        },
      );

      it("accepts the first and the last day of the class", async () => {
        const first = await postLesson(director, body({ date: CLASS_PERIOD.startDate })).expect(
          201,
        );
        const last = await postLesson(director, body({ date: CLASS_PERIOD.endDate })).expect(201);

        expect(first.body.date).toBe("2026-03-03");
        expect(last.body.date).toBe("2026-06-27");
      });

      it("answers 400 LESSON_OUTSIDE_CLASS_PERIOD for a day in another year", async () => {
        for (const date of ["2025-03-10", "2027-03-10"]) {
          const res = await postLesson(director, body({ date })).expect(400);

          expect(res.body.error).toBe("LESSON_OUTSIDE_CLASS_PERIOD");
        }
      });
    });

    it("answers 400 INVALID_TIME_RANGE, pointing at endTime, when the lesson does not end after it starts", async () => {
      for (const [startTime, endTime] of [
        ["14:00", "14:00"],
        ["15:30", "14:00"],
      ]) {
        const res = await postLesson(director, body({ startTime, endTime })).expect(400);

        expect(res.body.error).toBe("INVALID_TIME_RANGE");
        expect(fieldsOf(res.body)).toEqual(["endTime"]);
      }
      expect(await countLessons()).toBe(0);
    });

    it("answers 400 CLASS_NOT_FOUND for a class that does not exist", async () => {
      const res = await postLesson(director, body({ classId: UNKNOWN_ID })).expect(400);

      expect(res.body.error).toBe("CLASS_NOT_FOUND");
      expect(fieldsOf(res.body)).toEqual(["classId"]);
      expect(await countLessons()).toBe(0);
    });

    it("POST /lessons on an archived class answers 409 CLASS_ARCHIVED", async () => {
      // The class is archived by the service of the classes module, as its route does.
      await classesService.archive(classId, undefined, director.id);

      const res = await postLesson(director, body()).expect(409);

      expect(res.body.error).toBe("CLASS_ARCHIVED");
      expect(await countLessons()).toBe(0);
    });

    it("still takes lessons for a class that is completed or cancelled: only archiving makes a class read-only", async () => {
      for (const status of ["completed", "cancelled"]) {
        await classesService.update(
          classId,
          { status } as unknown as Parameters<ClassesService["update"]>[1],
          director.id,
        );

        const res = await postLesson(director, body()).expect(201);

        // The status of the class is its own: it does not reach its lessons (RF-034).
        expect(res.body.class.id).toBe(classId);
        expect(res.body.status).toBe("planned");
      }
    });

    it("answers 400 LESSON_PLAN_NOT_FOUND for a plan that does not exist", async () => {
      const res = await postLesson(director, body({ lessonPlanId: UNKNOWN_ID })).expect(400);

      expect(res.body.error).toBe("LESSON_PLAN_NOT_FOUND");
      expect(fieldsOf(res.body)).toEqual(["lessonPlanId"]);
      expect(await countLessons()).toBe(0);
    });

    it("answers 400 LESSON_PLAN_ARCHIVED for an archived plan, even one that is in the sequence", async () => {
      await lessonPlansService.archive(planId, undefined, director.id);

      const res = await postLesson(
        director,
        body({ title: undefined, lessonPlanId: planId, sequenceOrder: 1 }),
      ).expect(400);

      expect(res.body.error).toBe("LESSON_PLAN_ARCHIVED");
      expect(fieldsOf(res.body)).toEqual(["lessonPlanId"]);
      expect(await countLessons()).toBe(0);
    });

    it("keeps working on the lessons of a plan that is archived later: they show it with archivedAt", async () => {
      const created = await createLesson(body({ title: undefined, lessonPlanId: planId }));

      await lessonPlansService.archive(planId, undefined, director.id);

      const read = await getLesson(created.id, member).expect(200);
      expect(read.body.lessonPlan).toEqual({
        id: planId,
        title: PLAN_TITLE,
        archivedAt: expect.any(String),
      });
      await patchLesson(created.id, director, { title: "Título ajustado" }).expect(200);
      await rescheduleLesson(created.id, director, {
        date: "2026-03-17",
        startTime: "14:00",
        endTime: "15:30",
      }).expect(200);
    });

    describe("order of the errors", () => {
      it("answers a body with an invalid field before everything else", async () => {
        const res = await postLesson(
          director,
          body({ classId: UNKNOWN_ID, date: "2026-02-30", startTime: "16:00", endTime: "15:00" }),
        ).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["date"]);
      });

      it("answers INVALID_TIME_RANGE before CLASS_NOT_FOUND", async () => {
        const res = await postLesson(
          director,
          body({ classId: UNKNOWN_ID, startTime: "16:00", endTime: "15:00" }),
        ).expect(400);

        expect(res.body.error).toBe("INVALID_TIME_RANGE");
      });

      it("answers CLASS_ARCHIVED before the period and the plan", async () => {
        await classesService.archive(classId, undefined, director.id);
        await lessonPlansService.archive(planId, undefined, director.id);

        const res = await postLesson(
          director,
          body({ date: "2030-01-01", lessonPlanId: planId }),
        ).expect(409);

        expect(res.body.error).toBe("CLASS_ARCHIVED");
      });

      it("answers LESSON_OUTSIDE_CLASS_PERIOD before the plan", async () => {
        const res = await postLesson(
          director,
          body({ date: "2030-01-01", lessonPlanId: UNKNOWN_ID }),
        ).expect(400);

        expect(res.body.error).toBe("LESSON_OUTSIDE_CLASS_PERIOD");
      });

      it("answers LESSON_PLAN_ARCHIVED before the position in the sequence", async () => {
        const secondPlanId = await createPlan("Segundo plano");
        await courseLessonPlansService.replace(
          courseId,
          { lessonPlanIds: [planId, secondPlanId] },
          director.id,
        );
        await lessonPlansService.archive(secondPlanId, undefined, director.id);

        const res = await postLesson(
          director,
          body({ lessonPlanId: secondPlanId, sequenceOrder: 1 }),
        ).expect(400);

        expect(res.body.error).toBe("LESSON_PLAN_ARCHIVED");
      });
    });

    it("returns 400 VALIDATION_FAILED with the fields classId, date, startTime, endTime and title when the body is empty", async () => {
      const res = await postLesson(director, {}).expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(res.body)).toEqual(["classId", "date", "endTime", "startTime", "title"]);
      expect(await countLessons()).toBe(0);
    });

    it("returns 400 VALIDATION_FAILED with field title for a body without a plan and without a title, and for a blank or null one", async () => {
      for (const title of [undefined, "", "   ", null]) {
        const res = await postLesson(director, body({ title })).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["title"]);
      }
    });

    it("returns 400 VALIDATION_FAILED with field sequenceOrder for a position without a plan, or one that is not 1 to 1000", async () => {
      const withoutPlan = await postLesson(director, body({ sequenceOrder: 1 })).expect(400);
      expect(withoutPlan.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(withoutPlan.body)).toEqual(["sequenceOrder"]);

      for (const sequenceOrder of [0, -1, 1.5, 1001, "1"]) {
        const res = await postLesson(
          director,
          body({ lessonPlanId: planId, sequenceOrder }),
        ).expect(400);

        expect(fieldsOf(res.body)).toEqual(["sequenceOrder"]);
      }
    });

    it("returns 400 VALIDATION_FAILED with field startTime or endTime for 24:00, 9:00, 14:00:00 and a value that is not a time", async () => {
      for (const time of ["24:00", "9:00", "14:00:00", "14h00", "", null, 1400]) {
        const start = await postLesson(director, body({ startTime: time })).expect(400);
        expect(start.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(start.body)).toEqual(["startTime"]);

        const end = await postLesson(director, body({ endTime: time })).expect(400);
        expect(fieldsOf(end.body)).toEqual(["endTime"]);
      }
    });

    it("returns 400 VALIDATION_FAILED with field date for a date that is not a date of the calendar", async () => {
      for (const date of ["2026-02-30", "2026-3-10", "10/03/2026", "2026-03-10T14:00:00Z", null]) {
        const res = await postLesson(director, body({ date })).expect(400);

        expect(fieldsOf(res.body)).toEqual(["date"]);
      }
    });

    it("returns 400 VALIDATION_FAILED with field classId or lessonPlanId when they are not UUIDs", async () => {
      expect(
        fieldsOf((await postLesson(director, body({ classId: "not-a-uuid" })).expect(400)).body),
      ).toEqual(["classId"]);
      expect(
        fieldsOf(
          (await postLesson(director, body({ lessonPlanId: "not-a-uuid" })).expect(400)).body,
        ),
      ).toEqual(["lessonPlanId"]);
    });

    it("returns 400 VALIDATION_FAILED with the field of a head count that is negative, fractional or too big", async () => {
      for (const value of [-1, 1.5, "10"]) {
        expect(
          fieldsOf(
            (await postLesson(director, body({ expectedStudents: value })).expect(400)).body,
          ),
        ).toEqual(["expectedStudents"]);
        expect(
          fieldsOf(
            (await postLesson(director, body({ expectedMonitors: value })).expect(400)).body,
          ),
        ).toEqual(["expectedMonitors"]);
      }
      expect(
        fieldsOf((await postLesson(director, body({ expectedStudents: 1001 })).expect(400)).body),
      ).toEqual(["expectedStudents"]);
      expect(
        fieldsOf((await postLesson(director, body({ expectedMonitors: 101 })).expect(400)).body),
      ).toEqual(["expectedMonitors"]);
    });

    it("returns 400 VALIDATION_FAILED with the field of a text that is too long", async () => {
      for (const [field, length] of [
        ["title", 201],
        ["objective", 2001],
        ["location", 201],
        ["subject", 201],
      ] as const) {
        const res = await postLesson(director, body({ [field]: "x".repeat(length) })).expect(400);

        expect(fieldsOf(res.body)).toEqual([field]);
      }
      expect(await countLessons()).toBe(0);
    });

    it("returns 201 for a coordinator", async () => {
      await postLesson(coordinator, body()).expect(201);
    });

    it("returns 403 FORBIDDEN for a member and creates nothing", async () => {
      const res = await postLesson(member, body()).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect(await countLessons()).toBe(0);
    });

    it("returns 401 without a session cookie", async () => {
      await request(app.getHttpServer()).post("/lessons").send(body()).expect(401);
    });

    it("emits LESSON_CREATED with the lesson, after it is stored", async () => {
      const events = collectEvents();

      const created = await createLesson(
        body({ title: undefined, lessonPlanId: planId, sequenceOrder: 1, location: "Sala 2" }),
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: director.id,
        action: AuditableAction.LESSON_CREATED,
        targetType: "lesson",
        targetId: created.id,
        before: null,
        after: {
          classId,
          lessonPlanId: planId,
          sequenceOrder: 1,
          title: PLAN_TITLE,
          objective: PLAN_OBJECTIVE,
          date: "2026-03-10",
          startTime: "14:00",
          endTime: "15:30",
          location: "Sala 2",
          expectedStudents: null,
          expectedMonitors: null,
          subject: null,
          status: "planned",
        },
      });
      expect(events[0].occurredAt).toBeInstanceOf(Date);
    });

    it("does not emit when the creation is refused", async () => {
      const events = collectEvents();
      const cancelled = collectCancelled();

      await postLesson(member, body()).expect(403);
      await postLesson(director, body({ date: "2030-01-01" })).expect(400);
      await postLesson(director, body({ classId: UNKNOWN_ID })).expect(400);
      await postLesson(director, {}).expect(400);

      expect(events).toHaveLength(0);
      expect(cancelled).toHaveLength(0);
    });

    it("does not wait for another lesson being created in the same class: shared locks do not conflict", async () => {
      // Another creation holds the class FOR SHARE, as POST /lessons does for the whole transaction.
      const holder = await holdRow("classes", classId, "FOR SHARE");

      try {
        // If this creation asked for FOR UPDATE it would wait for the holder, and never answer.
        const res = await postLesson(director, body()).expect(201);
        expect(res.body.class.id).toBe(classId);
      } finally {
        await holder.release();
      }
    });

    it("waits for an archive of the class that is in flight, and then answers 409 CLASS_ARCHIVED", async () => {
      // An archive (or an edit of the period) holds the class FOR UPDATE until it commits.
      const archive = await holdRow("classes", classId, "FOR UPDATE");

      const pending = postLesson(director, body()).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FROM "classes"/);
        // It is not created while the class can still change under it.
        expect(await countLessons()).toBe(0);
        await archive.run(
          `UPDATE classes SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
          [classId, director.id],
        );
      } finally {
        await archive.release();
      }

      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("CLASS_ARCHIVED");
      expect(await countLessons()).toBe(0);
    });

    it("waits for an edit of the period of the class that is in flight, and checks the day against the new period", async () => {
      const edit = await holdRow("classes", classId, "FOR UPDATE");

      // 2026-03-10 is inside the period today, and outside the one the edit is about to commit.
      const pending = postLesson(director, body({ date: "2026-03-10" })).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FROM "classes"/);
        await edit.run(`UPDATE classes SET start_date = '2026-04-01' WHERE id = $1`, [classId]);
      } finally {
        await edit.release();
      }

      const res = await pending;
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("LESSON_OUTSIDE_CLASS_PERIOD");
      expect(await countLessons()).toBe(0);
    });

    it("waits for an edit of the lesson plan that is in flight, and copies the version it commits", async () => {
      // PATCH /lesson-plans/:id holds the plan FOR UPDATE while it rewrites it.
      const edit = await holdRow("lesson_plans", planId, "FOR UPDATE");

      const pending = postLesson(director, body({ title: undefined, lessonPlanId: planId })).then(
        (res) => res,
      );

      try {
        expect(await blockedStatement()).toMatch(/FROM "lesson_plans"/);
        await edit.run(`UPDATE lesson_plans SET title = $2 WHERE id = $1`, [
          planId,
          "Título do plano depois da edição",
        ]);
      } finally {
        await edit.release();
      }

      const res = await pending;
      expect(res.status).toBe(201);
      // The lesson copies the whole version of the plan that was committed, never a mix.
      expect(res.body.title).toBe("Título do plano depois da edição");
      expect(res.body.lessonPlan.title).toBe("Título do plano depois da edição");
    });
  });

  describe("GET /lessons/:id (getLesson)", () => {
    it("member gets 200 on GET /lessons/:id", async () => {
      const created = await createLesson();

      const res = await getLesson(created.id, member).expect(200);

      expect(res.body).toEqual(created);
    });

    it("every profile reads a lesson: director, coordinator and superadmin too", async () => {
      const created = await createLesson();

      for (const actor of [director, coordinator, superadmin]) {
        const res = await getLesson(created.id, actor).expect(200);

        expect(res.body.id).toBe(created.id);
      }
    });

    it("GET /lessons/:id returns class, course, edition and lessonPlan", async () => {
      const created = await createLesson(
        body({ title: undefined, lessonPlanId: planId, sequenceOrder: 1 }),
      );

      const res = await getLesson(created.id, member).expect(200);

      expect(res.body.class).toEqual({
        id: classId,
        code: "INFO-A",
        name: null,
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        archivedAt: null,
      });
      expect(res.body.course).toEqual({ id: courseId, name: "Informática Básica" });
      expect(res.body.edition).toEqual({ id: expect.any(String), name: "2026.1" });
      expect(res.body.lessonPlan).toEqual({ id: planId, title: PLAN_TITLE, archivedAt: null });
      expect(res.body.sequenceOrder).toBe(1);
      expect(res.body.durationMinutes).toBe(90);
    });

    it("answers lessonPlan null for a lesson created on its own", async () => {
      const created = await createLesson();

      const res = await getLesson(created.id, member).expect(200);

      expect(res.body.lessonPlan).toBeNull();
    });

    it("shows a lesson of an archived class, with the class archivedAt", async () => {
      const created = await createLesson();
      await classesService.archive(classId, undefined, director.id);

      const res = await getLesson(created.id, member).expect(200);

      expect(res.body.id).toBe(created.id);
      expect(res.body.class.archivedAt).toEqual(expect.any(String));
    });

    it("shows a cancelled lesson, with its reason and who cancelled it", async () => {
      const created = await createLesson();
      await cancelLesson(created.id, coordinator, { reason: "Feriado municipal." }).expect(200);

      const res = await getLesson(created.id, member).expect(200);

      expect(res.body).toMatchObject({
        status: "cancelled",
        cancelReason: "Feriado municipal.",
        cancelledAt: expect.any(String),
        cancelledById: coordinator.id,
      });
    });

    it("GET of a malformed or unknown id answers 404 LESSON_NOT_FOUND", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid", "123"]) {
        const res = await getLesson(id, member).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "LESSON_NOT_FOUND",
          message: "Lesson not found.",
        });
      }
    });

    it("returns 401 without a session cookie", async () => {
      const created = await createLesson();

      await request(app.getHttpServer()).get(`/lessons/${created.id}`).expect(401);
    });

    it("takes no lock and emits no event", async () => {
      const created = await createLesson();
      const events = collectEvents();
      // A lock on the row of the lesson does not hold a read back.
      const holder = await holdRow("lessons", created.id, "FOR UPDATE");

      try {
        await getLesson(created.id, member).expect(200);
      } finally {
        await holder.release();
      }

      expect(events).toHaveLength(0);
    });
  });

  describe("PATCH /lessons/:id (updateLesson)", () => {
    it("PATCH /lessons/:id edits title, location, expected counts and status", async () => {
      const created = await createLesson();

      const res = await patchLesson(created.id, director, {
        title: "Novo título",
        location: "Sala 2",
        expectedStudents: 12,
        expectedMonitors: 3,
        status: "confirmed",
      }).expect(200);

      expect(res.body).toEqual({
        ...created,
        title: "Novo título",
        location: "Sala 2",
        expectedStudents: 12,
        expectedMonitors: 3,
        status: "confirmed",
        updatedAt: expect.any(String),
      });
      expect(res.body.id).toBe(created.id);
      expect(await storedLesson(created.id)).toMatchObject({
        title: "Novo título",
        location: "Sala 2",
        expected_students: 12,
        expected_monitors: 3,
        status: "confirmed",
        // What an edit does not touch stays as it was.
        date: "2026-03-10",
        start_time: "14:00:00",
        end_time: "15:30:00",
        class_id: classId,
        created_by_id: director.id,
      });
    });

    it("edits the objective, the subject and the notes, and clears the fields that take null", async () => {
      const created = await createLesson(
        body({
          objective: "Objetivo.",
          location: "Sala 1",
          expectedStudents: 10,
          subject: "Assunto",
        }),
      );

      const edited = await patchLesson(created.id, director, {
        objective: "  Novo objetivo.  ",
        subject: "Novo assunto",
        postNotes: "A turma terminou antes do previsto.",
      }).expect(200);
      expect(edited.body).toMatchObject({
        objective: "Novo objetivo.",
        subject: "Novo assunto",
        postNotes: "A turma terminou antes do previsto.",
      });

      const cleared = await patchLesson(created.id, director, {
        objective: null,
        location: "   ",
        expectedStudents: null,
        expectedMonitors: null,
        subject: "",
        postNotes: null,
      }).expect(200);
      expect(cleared.body).toMatchObject({
        objective: null,
        location: null,
        expectedStudents: null,
        expectedMonitors: null,
        subject: null,
        postNotes: null,
      });
    });

    it("moves between planned, confirmed and done in any direction", async () => {
      const created = await createLesson();

      for (const status of ["confirmed", "done", "planned", "done", "confirmed"]) {
        const res = await patchLesson(created.id, coordinator, { status }).expect(200);

        expect(res.body.status).toBe(status);
      }
    });

    it("PATCH rejects status cancelled with 400 VALIDATION_FAILED", async () => {
      const created = await createLesson();

      for (const status of ["cancelled", "open", "", null, 1]) {
        const res = await patchLesson(created.id, director, { status }).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["status"]);
      }
      expect(await storedLesson(created.id)).toMatchObject({
        status: "planned",
        cancelled_at: null,
      });
    });

    it("PATCH with nothing changed emits no event", async () => {
      const created = await createLesson(body({ location: "Sala 1" }));
      const events = collectEvents();

      for (const payload of [
        {},
        { title: created.title, location: "Sala 1", status: "planned" },
        { objective: null, subject: null, postNotes: null },
      ]) {
        const res = await patchLesson(created.id, director, payload).expect(200);

        expect(res.body).toEqual(created);
      }

      expect(events).toHaveLength(0);
      expect((await storedLesson(created.id)).updated_at).toEqual(new Date(created.updatedAt));
    });

    it("PATCH ignores date, startTime and classId in the body", async () => {
      const created = await createLesson();
      const otherClassId = await createClassOf(courseId, "INFO-B");
      const events = collectEvents();

      const res = await patchLesson(created.id, director, {
        title: "Novo título",
        date: "2026-03-17",
        startTime: "09:00",
        endTime: "10:00",
        classId: otherClassId,
        lessonPlanId: planId,
        sequenceOrder: 1,
        originalDate: "2026-01-01",
      }).expect(200);

      expect(res.body).toMatchObject({
        title: "Novo título",
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        class: { id: classId },
        lessonPlan: null,
        sequenceOrder: null,
        originalDate: null,
      });
      expect(await storedLesson(created.id)).toMatchObject({
        class_id: classId,
        lesson_plan_id: null,
        sequence_order: null,
        date: "2026-03-10",
        start_time: "14:00:00",
        end_time: "15:30:00",
        original_date: null,
      });
      // Only the title changed.
      expect(events[0].after.changedFields).toEqual(["title"]);
    });

    it("does not validate what it ignores: a bad date or a bad time in the body is dropped, not rejected", async () => {
      const created = await createLesson();

      await patchLesson(created.id, director, {
        title: "Novo título",
        date: "not-a-date",
        startTime: "25:99",
        classId: "not-a-uuid",
      }).expect(200);
    });

    it("PATCH of a cancelled lesson answers 409 LESSON_CANCELLED, even for a body that changes nothing", async () => {
      const created = await createLesson();
      await cancelLesson(created.id, director, { reason: "Feriado." }).expect(200);

      for (const payload of [{ title: "Novo título" }, {}, { status: "planned" }]) {
        const res = await patchLesson(created.id, director, payload).expect(409);

        expect(res.body.error).toBe("LESSON_CANCELLED");
      }
      expect(await storedLesson(created.id)).toMatchObject({
        title: "Teclado, mouse e janelas",
        status: "cancelled",
      });
    });

    it("PATCH of a lesson of an archived class answers 409 CLASS_ARCHIVED, even for a body that changes nothing", async () => {
      const created = await createLesson();
      await classesService.archive(classId, undefined, director.id);

      for (const payload of [{ title: "Novo título" }, {}]) {
        const res = await patchLesson(created.id, director, payload).expect(409);

        expect(res.body.error).toBe("CLASS_ARCHIVED");
      }
      expect((await storedLesson(created.id)).title).toBe("Teclado, mouse e janelas");
    });

    it("answers LESSON_CANCELLED before CLASS_ARCHIVED", async () => {
      const created = await createLesson();
      await cancelLesson(created.id, director, { reason: "Feriado." }).expect(200);
      await classesService.archive(classId, undefined, director.id);

      const res = await patchLesson(created.id, director, { title: "Novo título" }).expect(409);

      expect(res.body.error).toBe("LESSON_CANCELLED");
    });

    it("returns 400 VALIDATION_FAILED when title or status are null, or a field is invalid", async () => {
      const created = await createLesson();

      for (const [payload, fields] of [
        [{ title: null }, ["title"]],
        [{ title: "   " }, ["title"]],
        [{ title: "t".repeat(201) }, ["title"]],
        [{ objective: "o".repeat(2001) }, ["objective"]],
        [{ location: "l".repeat(201) }, ["location"]],
        [{ subject: "s".repeat(201) }, ["subject"]],
        [{ postNotes: "n".repeat(5001) }, ["postNotes"]],
        [{ expectedStudents: -1 }, ["expectedStudents"]],
        [{ expectedStudents: 1001 }, ["expectedStudents"]],
        [{ expectedMonitors: 1.5 }, ["expectedMonitors"]],
        [{ expectedMonitors: 101 }, ["expectedMonitors"]],
        [
          { title: null, status: "nope", expectedStudents: "x" },
          ["expectedStudents", "status", "title"],
        ],
      ] as const) {
        const res = await patchLesson(created.id, director, payload).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(fields);
      }
      expect(await storedLesson(created.id)).toMatchObject({ title: "Teclado, mouse e janelas" });
    });

    it("accepts the largest notes the DTO allows", async () => {
      const created = await createLesson();

      const res = await patchLesson(created.id, director, { postNotes: "n".repeat(5000) }).expect(
        200,
      );

      expect(res.body.postNotes).toBe("n".repeat(5000));
    });

    it("returns 404 LESSON_NOT_FOUND for an unknown id and for a malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await patchLesson(id, director, { title: "Novo título" }).expect(404);

        expect(res.body.error).toBe("LESSON_NOT_FOUND");
      }
    });

    it("returns 403 FORBIDDEN for a member and changes nothing", async () => {
      const created = await createLesson();

      const res = await patchLesson(created.id, member, { title: "Novo título" }).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect((await storedLesson(created.id)).title).toBe("Teclado, mouse e janelas");
    });

    it("returns 401 without a session cookie", async () => {
      const created = await createLesson();

      await request(app.getHttpServer())
        .patch(`/lessons/${created.id}`)
        .send({ title: "Novo título" })
        .expect(401);
    });

    it("edits the lesson found by an id in upper case and emits the id stored in the database", async () => {
      const created = await createLesson();
      const events = collectEvents();

      const res = await patchLesson(created.id.toUpperCase(), director, {
        title: "Novo título",
      }).expect(200);

      expect(res.body.id).toBe(created.id);
      expect(events[0].targetId).toBe(created.id);
    });

    it("does not touch the lesson plan: the title of a lesson is its own", async () => {
      const created = await createLesson(body({ title: undefined, lessonPlanId: planId }));

      await patchLesson(created.id, director, {
        title: "Título só da aula",
        objective: "Objetivo só da aula.",
      }).expect(200);

      const plan = await request(app.getHttpServer())
        .get(`/lesson-plans/${planId}`)
        .set("Cookie", director.cookie)
        .expect(200);
      expect(plan.body.title).toBe(PLAN_TITLE);
      expect(plan.body.objective).toBe(PLAN_OBJECTIVE);
    });

    it("emits LESSON_UPDATED once, with only the fields that changed", async () => {
      const created = await createLesson(body({ location: "Sala 1", expectedStudents: 10 }));
      const events = collectEvents();

      await patchLesson(created.id, coordinator, {
        title: "Novo título",
        location: "Sala 2",
        expectedStudents: 10,
      }).expect(200);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: coordinator.id,
        action: AuditableAction.LESSON_UPDATED,
        targetType: "lesson",
        targetId: created.id,
        before: { title: "Teclado, mouse e janelas", location: "Sala 1" },
        after: { title: "Novo título", location: "Sala 2", changedFields: ["title", "location"] },
      });
    });

    it("update event carries postNotes only in changedFields", async () => {
      const created = await createLesson();
      const events = collectEvents();

      await patchLesson(created.id, director, {
        postNotes: "A aluna passou mal no fim da aula.",
      }).expect(200);

      expect(events).toHaveLength(1);
      expect(events[0].after).toEqual({ changedFields: ["postNotes"] });
      expect(events[0].before).toEqual({});
      expect(JSON.stringify(events[0])).not.toContain("passou mal");
      // It was stored, all the same.
      expect((await storedLesson(created.id)).post_notes).toBe(
        "A aluna passou mal no fim da aula.",
      );
    });

    it("does not emit when an edit is refused", async () => {
      const created = await createLesson();
      const events = collectEvents();

      await patchLesson(created.id, member, { title: "Novo título" }).expect(403);
      await patchLesson(created.id, director, { status: "cancelled" }).expect(400);
      await patchLesson(UNKNOWN_ID, director, { title: "Novo título" }).expect(404);

      expect(events).toHaveLength(0);
    });

    it("waits for whoever holds the row of the lesson and then edits it", async () => {
      const created = await createLesson();
      const holder = await holdRow("lessons", created.id, "FOR UPDATE");

      const pending = patchLesson(created.id, director, { title: "Novo título" }).then(
        (res) => res,
      );

      try {
        expect(await blockedStatement()).toMatch(/"Lesson"/);
      } finally {
        await holder.release();
      }

      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Novo título");
    });

    it("serializes concurrent edits of the same lesson: both answer 200 and the last one wins, whole", async () => {
      const created = await createLesson();

      const [first, second] = await Promise.all([
        patchLesson(created.id, director, { title: "Título A", location: "Sala A" }),
        patchLesson(created.id, coordinator, { title: "Título B", location: "Sala B" }),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);
      const stored = await storedLesson(created.id);
      // The two edits never mix: the title and the place come from the same one.
      expect([
        { title: "Título A", location: "Sala A" },
        { title: "Título B", location: "Sala B" },
      ]).toContainEqual({ title: stored.title, location: stored.location });
    });

    it("waits for an archive of the class that is in flight, and then answers 409 CLASS_ARCHIVED", async () => {
      const created = await createLesson();
      const archive = await holdRow("classes", classId, "FOR UPDATE");

      const pending = patchLesson(created.id, director, { title: "Novo título" }).then(
        (res) => res,
      );

      try {
        expect(await blockedStatement()).toMatch(/FROM "classes"/);
        await archive.run(
          `UPDATE classes SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
          [classId, director.id],
        );
      } finally {
        await archive.release();
      }

      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("CLASS_ARCHIVED");
      expect((await storedLesson(created.id)).title).toBe("Teclado, mouse e janelas");
    });
  });

  describe("PATCH /lessons/:id/cancel (cancelLesson)", () => {
    it("PATCH /lessons/:id/cancel without reason answers 400 VALIDATION_FAILED", async () => {
      const created = await createLesson();

      for (const payload of [undefined, {}, { reason: "" }, { reason: "   " }, { reason: null }]) {
        const res = await cancelLesson(created.id, director, payload).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["reason"]);
      }
      expect(await storedLesson(created.id)).toMatchObject({
        status: "planned",
        cancelled_at: null,
      });
    });

    it("cancel sets status cancelled, cancelReason, cancelledAt and cancelledById", async () => {
      const created = await createLesson();

      const res = await cancelLesson(created.id, coordinator, {
        reason: "  Feriado municipal.  ",
      }).expect(200);

      expect(res.body).toEqual({
        ...created,
        status: "cancelled",
        cancelReason: "Feriado municipal.",
        cancelledAt: expect.any(String),
        cancelledById: coordinator.id,
        updatedAt: expect.any(String),
      });
      const stored = await storedLesson(created.id);
      expect(stored).toMatchObject({
        status: "cancelled",
        cancel_reason: "Feriado municipal.",
        cancelled_by_id: coordinator.id,
        deleted_at: null,
      });
      // One instant for the cancellation and the update.
      expect(stored.cancelled_at).toEqual(stored.updated_at);
      expect(res.body.cancelledAt).toBe((stored.cancelled_at as Date).toISOString());
    });

    it("keeps the lesson: it stays in the table and by id, with the schedule and the origin it had", async () => {
      const created = await createLesson(
        body({ title: undefined, lessonPlanId: planId, sequenceOrder: 1, location: "Sala 1" }),
      );

      await cancelLesson(created.id, director, { reason: "Feriado." }).expect(200);

      expect(await countLessons()).toBe(1);
      const read = await getLesson(created.id, member).expect(200);
      expect(read.body).toMatchObject({
        id: created.id,
        status: "cancelled",
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        location: "Sala 1",
        sequenceOrder: 1,
        title: PLAN_TITLE,
        lessonPlan: { id: planId },
      });
      expect((await storedLesson(created.id)).deleted_at).toBeNull();
    });

    it("cancels a confirmed lesson and a done one too", async () => {
      for (const status of ["confirmed", "done"]) {
        const created = await createLesson();
        await patchLesson(created.id, director, { status }).expect(200);

        const res = await cancelLesson(created.id, director, { reason: "Feriado." }).expect(200);

        expect(res.body.status).toBe("cancelled");
      }
    });

    it("cancelling a cancelled lesson is a 200 no-op that keeps the first reason", async () => {
      const created = await createLesson();
      const first = await cancelLesson(created.id, director, { reason: "Primeiro motivo." }).expect(
        200,
      );
      const events = collectEvents();
      const cancelled = collectCancelled();

      const second = await cancelLesson(created.id, coordinator, {
        reason: "Segundo motivo.",
      }).expect(200);

      expect(second.body).toEqual(first.body);
      expect(second.body).toMatchObject({
        cancelReason: "Primeiro motivo.",
        cancelledById: director.id,
      });
      expect(events).toHaveLength(0);
      expect(cancelled).toHaveLength(0);
      expect(await storedLesson(created.id)).toMatchObject({
        cancel_reason: "Primeiro motivo.",
        cancelled_by_id: director.id,
      });
    });

    it("answers 200 for a cancelled lesson of an archived class: the no-op comes before the check of the class", async () => {
      const created = await createLesson();
      await cancelLesson(created.id, director, { reason: "Primeiro motivo." }).expect(200);
      await classesService.archive(classId, undefined, director.id);

      const res = await cancelLesson(created.id, director, { reason: "Segundo motivo." }).expect(
        200,
      );

      expect(res.body.cancelReason).toBe("Primeiro motivo.");
    });

    it("answers 409 CLASS_ARCHIVED for a lesson that is not cancelled yet, in an archived class", async () => {
      const created = await createLesson();
      await classesService.archive(classId, undefined, director.id);

      const res = await cancelLesson(created.id, director, { reason: "Feriado." }).expect(409);

      expect(res.body.error).toBe("CLASS_ARCHIVED");
      expect((await storedLesson(created.id)).status).toBe("planned");
    });

    it("cancel emits lesson.cancelled once, after the commit, and the audit event without the reason", async () => {
      const created = await createLesson();
      const events = collectEvents();
      const cancelled = collectCancelled();

      await cancelLesson(created.id, coordinator, { reason: "A aluna foi internada." }).expect(200);

      expect(cancelled).toHaveLength(1);
      expect(cancelled[0]).toBeInstanceOf(LessonCancelledEvent);
      expect(cancelled[0]).toEqual({
        lessonId: created.id,
        classId,
        date: "2026-03-10",
        cancelledById: coordinator.id,
        cancelledAt: expect.any(Date),
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: coordinator.id,
        action: AuditableAction.LESSON_CANCELLED,
        targetType: "lesson",
        targetId: created.id,
        before: { status: "planned" },
        after: { status: "cancelled", cancelledAt: expect.any(Date) },
      });
      // The reason is free text: it is stored, and it is in no event.
      expect(JSON.stringify(events[0])).not.toContain("internada");
      expect(JSON.stringify(cancelled[0])).not.toContain("internada");
    });

    it("tells the hours about the day the lesson has after a reschedule", async () => {
      const created = await createLesson();
      await rescheduleLesson(created.id, director, {
        date: "2026-03-17",
        startTime: "14:00",
        endTime: "15:30",
      }).expect(200);
      const cancelled = collectCancelled();

      await cancelLesson(created.id, director, { reason: "Feriado." }).expect(200);

      expect(cancelled[0].date).toBe("2026-03-17");
    });

    it("after the cancel, the edit and the reschedule answer 409 LESSON_CANCELLED", async () => {
      const created = await createLesson();
      await cancelLesson(created.id, director, { reason: "Feriado." }).expect(200);

      const edit = await patchLesson(created.id, director, { title: "Novo título" }).expect(409);
      const reschedule = await rescheduleLesson(created.id, director, {
        date: "2026-03-17",
        startTime: "14:00",
        endTime: "15:30",
      }).expect(409);

      expect(edit.body.error).toBe("LESSON_CANCELLED");
      expect(reschedule.body.error).toBe("LESSON_CANCELLED");
    });

    it("accepts the longest reason the DTO allows and rejects one more character", async () => {
      const created = await createLesson();

      const tooLong = await cancelLesson(created.id, director, { reason: "r".repeat(501) }).expect(
        400,
      );
      expect(fieldsOf(tooLong.body)).toEqual(["reason"]);

      const res = await cancelLesson(created.id, director, { reason: "r".repeat(500) }).expect(200);
      expect(res.body.cancelReason).toBe("r".repeat(500));
    });

    it("returns 404 LESSON_NOT_FOUND for an unknown id and for a malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await cancelLesson(id, director, { reason: "Feriado." }).expect(404);

        expect(res.body.error).toBe("LESSON_NOT_FOUND");
      }
    });

    it("returns 403 FORBIDDEN for a member and leaves the lesson as it was", async () => {
      const created = await createLesson();

      const res = await cancelLesson(created.id, member, { reason: "Feriado." }).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect(await storedLesson(created.id)).toMatchObject({
        status: "planned",
        cancelled_at: null,
      });
    });

    it("returns 401 without a session cookie", async () => {
      const created = await createLesson();

      await request(app.getHttpServer())
        .patch(`/lessons/${created.id}/cancel`)
        .send({ reason: "Feriado." })
        .expect(401);
    });

    it("does not emit when the cancel is refused", async () => {
      const created = await createLesson();
      const events = collectEvents();
      const cancelled = collectCancelled();

      await cancelLesson(created.id, member, { reason: "Feriado." }).expect(403);
      await cancelLesson(created.id, director, {}).expect(400);
      await cancelLesson(UNKNOWN_ID, director, { reason: "Feriado." }).expect(404);

      expect(events).toHaveLength(0);
      expect(cancelled).toHaveLength(0);
    });

    it("waits for whoever holds the row of the lesson and then cancels it", async () => {
      const created = await createLesson();
      const holder = await holdRow("lessons", created.id, "FOR UPDATE");

      const pending = cancelLesson(created.id, director, { reason: "Feriado." }).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/"Lesson"/);
      } finally {
        await holder.release();
      }

      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("cancelled");
    });

    it("cancels once when two requests cancel at the same time: both answer 200 with the same reason, and one event goes out", async () => {
      const created = await createLesson();
      const events = collectEvents();
      const cancelled = collectCancelled();

      const [first, second] = await Promise.all([
        cancelLesson(created.id, director, { reason: "Motivo da diretoria." }),
        cancelLesson(created.id, coordinator, { reason: "Motivo da coordenação." }),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);
      const stored = await storedLesson(created.id);
      // Whoever came second finds it cancelled and answers the first reason.
      expect(first.body.cancelReason).toBe(stored.cancel_reason);
      expect(second.body.cancelReason).toBe(stored.cancel_reason);
      expect(first.body.cancelledById).toBe(stored.cancelled_by_id);
      expect(cancelled).toHaveLength(1);
      expect(
        events.filter((event) => event.action === AuditableAction.LESSON_CANCELLED),
      ).toHaveLength(1);
    });
  });

  describe("PATCH /lessons/:id/reschedule (rescheduleLesson)", () => {
    const moved = { date: "2026-03-17", startTime: "09:00", endTime: "10:30" };

    it("PATCH /lessons/:id/reschedule answers the same id with originalDate set", async () => {
      const created = await createLesson(
        body({ title: undefined, lessonPlanId: planId, sequenceOrder: 1, location: "Sala 1" }),
      );

      const res = await rescheduleLesson(created.id, coordinator, moved).expect(200);

      expect(res.body).toEqual({
        ...created,
        date: "2026-03-17",
        startTime: "09:00",
        endTime: "10:30",
        durationMinutes: 90,
        originalDate: "2026-03-10",
        updatedAt: expect.any(String),
      });
      // The same lesson: one row, the same id, the same origin and the same status.
      expect(res.body.id).toBe(created.id);
      expect(await countLessons()).toBe(1);
      expect(await storedLesson(created.id)).toMatchObject({
        date: "2026-03-17",
        start_time: "09:00:00",
        end_time: "10:30:00",
        original_date: "2026-03-10",
        status: "planned",
        lesson_plan_id: planId,
        sequence_order: 1,
        location: "Sala 1",
        reschedule_reason: null,
        reschedule_note: null,
      });
    });

    it("a second reschedule keeps the first originalDate", async () => {
      const created = await createLesson();
      await rescheduleLesson(created.id, director, moved).expect(200);

      const second = await rescheduleLesson(created.id, director, {
        date: "2026-03-24",
        startTime: "14:00",
        endTime: "15:30",
      }).expect(200);
      expect(second.body).toMatchObject({ date: "2026-03-24", originalDate: "2026-03-10" });

      // Back to the first day: the original date is still the first one.
      const third = await rescheduleLesson(created.id, director, {
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
      }).expect(200);
      expect(third.body).toMatchObject({ date: "2026-03-10", originalDate: "2026-03-10" });
    });

    it("a reschedule that only moves the time still marks the lesson as rescheduled", async () => {
      const created = await createLesson();

      const res = await rescheduleLesson(created.id, director, {
        date: "2026-03-10",
        startTime: "16:00",
        endTime: "17:30",
      }).expect(200);

      expect(res.body).toMatchObject({
        date: "2026-03-10",
        startTime: "16:00",
        originalDate: "2026-03-10",
      });
    });

    it("stores the reason and the note of the last reschedule, and a reschedule without them empties them", async () => {
      const created = await createLesson();

      const first = await rescheduleLesson(created.id, director, {
        ...moved,
        reason: "  Laboratório em manutenção.  ",
        note: "  Avisar a turma pelo grupo.  ",
      }).expect(200);
      expect(first.body).toMatchObject({
        rescheduleReason: "Laboratório em manutenção.",
        rescheduleNote: "Avisar a turma pelo grupo.",
      });

      const second = await rescheduleLesson(created.id, director, {
        date: "2026-03-24",
        startTime: "14:00",
        endTime: "15:30",
      }).expect(200);
      expect(second.body).toMatchObject({
        rescheduleReason: null,
        rescheduleNote: null,
        originalDate: "2026-03-10",
      });
    });

    it("keeps the status: a confirmed lesson stays confirmed and a done one stays done", async () => {
      for (const status of ["confirmed", "done"]) {
        const created = await createLesson();
        await patchLesson(created.id, director, { status }).expect(200);

        const res = await rescheduleLesson(created.id, director, moved).expect(200);

        expect(res.body.status).toBe(status);
      }
    });

    it("reschedule replaces location when sent and keeps it when omitted", async () => {
      const created = await createLesson(body({ location: "Sala 1" }));

      const kept = await rescheduleLesson(created.id, director, moved).expect(200);
      expect(kept.body.location).toBe("Sala 1");

      const replaced = await rescheduleLesson(created.id, director, {
        date: "2026-03-24",
        startTime: "14:00",
        endTime: "15:30",
        location: "  Laboratório 2, bloco A  ",
      }).expect(200);
      expect(replaced.body.location).toBe("Laboratório 2, bloco A");

      const cleared = await rescheduleLesson(created.id, director, {
        date: "2026-03-31",
        startTime: "14:00",
        endTime: "15:30",
        location: null,
      }).expect(200);
      expect(cleared.body.location).toBeNull();
    });

    it("counts a change of place alone as a reschedule", async () => {
      const created = await createLesson(body({ location: "Sala 1" }));
      const events = collectEvents();

      const res = await rescheduleLesson(created.id, director, {
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        location: "Sala 2",
      }).expect(200);

      expect(res.body).toMatchObject({ location: "Sala 2", originalDate: "2026-03-10" });
      expect(events).toHaveLength(1);
    });

    it("reschedule with the same schedule is a no-op, with no event and nothing written", async () => {
      const created = await createLesson(body({ location: "Sala 1" }));
      const events = collectEvents();

      for (const payload of [
        { date: "2026-03-10", startTime: "14:00", endTime: "15:30" },
        { date: "2026-03-10", startTime: "14:00", endTime: "15:30", location: "Sala 1" },
        {
          date: "2026-03-10",
          startTime: "14:00",
          endTime: "15:30",
          reason: "Motivo novo.",
          note: "Nota nova.",
        },
      ]) {
        const res = await rescheduleLesson(created.id, director, payload).expect(200);

        expect(res.body).toEqual(created);
      }

      expect(events).toHaveLength(0);
      expect(await storedLesson(created.id)).toMatchObject({
        original_date: null,
        reschedule_reason: null,
        reschedule_note: null,
      });
    });

    describe("the period of the class", () => {
      it("reschedule outside the period answers 400 LESSON_OUTSIDE_CLASS_PERIOD", async () => {
        const created = await createLesson();

        for (const date of ["2026-03-02", "2026-06-28", "2025-03-10", "2027-03-10"]) {
          const res = await rescheduleLesson(created.id, director, { ...moved, date }).expect(400);

          expect(res.body.error).toBe("LESSON_OUTSIDE_CLASS_PERIOD");
          expect(fieldsOf(res.body)).toEqual(["date"]);
        }
        expect(await storedLesson(created.id)).toMatchObject({
          date: "2026-03-10",
          original_date: null,
        });
      });

      it("accepts the first and the last day of the class", async () => {
        const created = await createLesson();

        const first = await rescheduleLesson(created.id, director, {
          ...moved,
          date: CLASS_PERIOD.startDate,
        }).expect(200);
        const last = await rescheduleLesson(created.id, director, {
          ...moved,
          date: CLASS_PERIOD.endDate,
        }).expect(200);

        expect(first.body.date).toBe("2026-03-03");
        expect(last.body.date).toBe("2026-06-27");
        expect(last.body.originalDate).toBe("2026-03-10");
      });
    });

    it("answers 400 INVALID_TIME_RANGE, pointing at endTime, when the lesson would not end after it starts", async () => {
      const created = await createLesson();

      for (const [startTime, endTime] of [
        ["14:00", "14:00"],
        ["15:30", "14:00"],
      ]) {
        const res = await rescheduleLesson(created.id, director, {
          ...moved,
          startTime,
          endTime,
        }).expect(400);

        expect(res.body.error).toBe("INVALID_TIME_RANGE");
        expect(fieldsOf(res.body)).toEqual(["endTime"]);
      }
      expect((await storedLesson(created.id)).original_date).toBeNull();
    });

    it("returns 400 VALIDATION_FAILED for a body without the date or the times, or with a bad one", async () => {
      const created = await createLesson();

      const empty = await rescheduleLesson(created.id, director, {}).expect(400);
      expect(empty.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(empty.body)).toEqual(["date", "endTime", "startTime"]);

      for (const [payload, fields] of [
        [{ ...moved, date: "2026-02-30" }, ["date"]],
        [{ ...moved, date: "17/03/2026" }, ["date"]],
        [{ ...moved, startTime: "24:00" }, ["startTime"]],
        [{ ...moved, startTime: "9:00" }, ["startTime"]],
        [{ ...moved, endTime: "10:30:00" }, ["endTime"]],
        [{ ...moved, location: "l".repeat(201) }, ["location"]],
        [{ ...moved, reason: "r".repeat(501) }, ["reason"]],
        [{ ...moved, note: "n".repeat(2001) }, ["note"]],
      ] as const) {
        const res = await rescheduleLesson(created.id, director, payload).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(fields);
      }
    });

    it("reschedule throws LESSON_CANCELLED: answers 409 for a cancelled lesson", async () => {
      const created = await createLesson();
      await cancelLesson(created.id, director, { reason: "Feriado." }).expect(200);

      const res = await rescheduleLesson(created.id, director, moved).expect(409);

      expect(res.body.error).toBe("LESSON_CANCELLED");
      expect(await storedLesson(created.id)).toMatchObject({
        date: "2026-03-10",
        original_date: null,
      });
    });

    it("answers 409 CLASS_ARCHIVED for a lesson of an archived class, even for the schedule it already has", async () => {
      const created = await createLesson();
      await classesService.archive(classId, undefined, director.id);

      for (const payload of [moved, { date: "2026-03-10", startTime: "14:00", endTime: "15:30" }]) {
        const res = await rescheduleLesson(created.id, director, payload).expect(409);

        expect(res.body.error).toBe("CLASS_ARCHIVED");
      }
      expect((await storedLesson(created.id)).date).toBe("2026-03-10");
    });

    it("answers the errors in the order cancelled, archived, period", async () => {
      const created = await createLesson();
      await classesService.archive(classId, undefined, director.id);

      const archived = await rescheduleLesson(created.id, director, {
        ...moved,
        date: "2030-01-01",
      }).expect(409);
      expect(archived.body.error).toBe("CLASS_ARCHIVED");

      // A cancelled lesson in an archived class: cancelled comes first.
      await dataSource.query(
        `UPDATE lessons SET status = 'cancelled', cancelled_at = now() WHERE id = $1`,
        [created.id],
      );
      const cancelled = await rescheduleLesson(created.id, director, {
        ...moved,
        date: "2030-01-01",
      }).expect(409);
      expect(cancelled.body.error).toBe("LESSON_CANCELLED");
    });

    it("answers INVALID_TIME_RANGE before it looks for the lesson", async () => {
      const res = await rescheduleLesson(UNKNOWN_ID, director, {
        ...moved,
        startTime: "16:00",
        endTime: "15:00",
      }).expect(400);

      expect(res.body.error).toBe("INVALID_TIME_RANGE");
    });

    it("returns 404 LESSON_NOT_FOUND for an unknown id and for a malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await rescheduleLesson(id, director, moved).expect(404);

        expect(res.body.error).toBe("LESSON_NOT_FOUND");
      }
    });

    it("returns 403 FORBIDDEN for a member and leaves the lesson as it was", async () => {
      const created = await createLesson();

      const res = await rescheduleLesson(created.id, member, moved).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect(await storedLesson(created.id)).toMatchObject({
        date: "2026-03-10",
        original_date: null,
      });
    });

    it("returns 401 without a session cookie", async () => {
      const created = await createLesson();

      await request(app.getHttpServer())
        .patch(`/lessons/${created.id}/reschedule`)
        .send(moved)
        .expect(401);
    });

    it("keeps the class, the plan, the title and the head counts: only the schedule moves", async () => {
      const created = await createLesson(
        body({
          title: undefined,
          lessonPlanId: planId,
          sequenceOrder: 1,
          expectedStudents: 15,
          expectedMonitors: 2,
          subject: "Primeiro contato",
        }),
      );

      const res = await rescheduleLesson(created.id, director, moved).expect(200);

      expect(res.body).toMatchObject({
        class: created.class,
        lessonPlan: created.lessonPlan,
        sequenceOrder: 1,
        title: PLAN_TITLE,
        expectedStudents: 15,
        expectedMonitors: 2,
        subject: "Primeiro contato",
        createdAt: created.createdAt,
        createdById: director.id,
      });
    });

    it("emits LESSON_RESCHEDULED once, with the schedule before and after, and without the reason or the note", async () => {
      const created = await createLesson(body({ location: "Sala 1" }));
      const events = collectEvents();
      const cancelled = collectCancelled();

      await rescheduleLesson(created.id, coordinator, {
        ...moved,
        location: "Sala 2",
        reason: "Laboratório em manutenção.",
        note: "A aluna não pode vir.",
      }).expect(200);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: coordinator.id,
        action: AuditableAction.LESSON_RESCHEDULED,
        targetType: "lesson",
        targetId: created.id,
        before: {
          date: "2026-03-10",
          startTime: "14:00",
          endTime: "15:30",
          location: "Sala 1",
          originalDate: null,
        },
        after: {
          date: "2026-03-17",
          startTime: "09:00",
          endTime: "10:30",
          location: "Sala 2",
          originalDate: "2026-03-10",
        },
      });
      expect(JSON.stringify(events[0])).not.toContain("manutenção");
      expect(JSON.stringify(events[0])).not.toContain("não pode vir");
      // Moving a lesson is not cancelling it: nothing goes to the hours.
      expect(cancelled).toHaveLength(0);
    });

    it("does not emit when the reschedule is refused", async () => {
      const created = await createLesson();
      const events = collectEvents();

      await rescheduleLesson(created.id, member, moved).expect(403);
      await rescheduleLesson(created.id, director, { ...moved, date: "2030-01-01" }).expect(400);
      await rescheduleLesson(created.id, director, {}).expect(400);
      await rescheduleLesson(UNKNOWN_ID, director, moved).expect(404);

      expect(events).toHaveLength(0);
    });

    it("waits for whoever holds the row of the lesson and then moves it", async () => {
      const created = await createLesson();
      const holder = await holdRow("lessons", created.id, "FOR UPDATE");

      const pending = rescheduleLesson(created.id, director, moved).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/"Lesson"/);
      } finally {
        await holder.release();
      }

      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ date: "2026-03-17", originalDate: "2026-03-10" });
    });

    it("serializes concurrent reschedules: both answer 200, the date is one of the two, and originalDate stays the first one", async () => {
      const created = await createLesson();

      const [first, second] = await Promise.all([
        rescheduleLesson(created.id, director, {
          date: "2026-03-17",
          startTime: "09:00",
          endTime: "10:00",
        }),
        rescheduleLesson(created.id, coordinator, {
          date: "2026-03-24",
          startTime: "11:00",
          endTime: "12:00",
        }),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);
      const stored = await storedLesson(created.id);
      // The two never mix: the day and the times come from the same one...
      expect([
        { date: "2026-03-17", start_time: "09:00:00", end_time: "10:00:00" },
        { date: "2026-03-24", start_time: "11:00:00", end_time: "12:00:00" },
      ]).toContainEqual({
        date: stored.date,
        start_time: stored.start_time,
        end_time: stored.end_time,
      });
      // ...and the second never takes the day the first one left as the original.
      expect(stored.original_date).toBe("2026-03-10");
    });

    it("waits for a change of the period of the class that is in flight, and checks the new day against it", async () => {
      const created = await createLesson();
      const edit = await holdRow("classes", classId, "FOR UPDATE");

      const pending = rescheduleLesson(created.id, director, moved).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FROM "classes"/);
        // The period is about to end before the new day.
        await edit.run(`UPDATE classes SET end_date = '2026-03-12' WHERE id = $1`, [classId]);
      } finally {
        await edit.release();
      }

      const res = await pending;
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("LESSON_OUTSIDE_CLASS_PERIOD");
      expect((await storedLesson(created.id)).date).toBe("2026-03-10");
    });
  });

  describe("permissions", () => {
    it.each([
      ["POST /lessons", (actor: Actor) => postLesson(actor, body())],
      [
        "PATCH /lessons/:id",
        (actor: Actor, id: string) => patchLesson(id, actor, { title: "Novo título" }),
      ],
      [
        "PATCH /lessons/:id/cancel",
        (actor: Actor, id: string) => cancelLesson(id, actor, { reason: "Feriado." }),
      ],
      [
        "PATCH /lessons/:id/reschedule",
        (actor: Actor, id: string) =>
          rescheduleLesson(id, actor, { date: "2026-03-17", startTime: "14:00", endTime: "15:30" }),
      ],
    ])("member gets 403 FORBIDDEN on %s", async (_route, send) => {
      const created = await createLesson();
      const before = await storedLesson(created.id);
      const events = collectEvents();
      const cancelled = collectCancelled();

      const res = await send(member, created.id).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect(await countLessons()).toBe(1);
      expect(await storedLesson(created.id)).toEqual(before);
      expect(events).toHaveLength(0);
      expect(cancelled).toHaveLength(0);
    });

    it("the member that is refused to write reads the same lesson", async () => {
      const created = await createLesson();

      const res = await getLesson(created.id, member).expect(200);

      expect(res.body.id).toBe(created.id);
    });

    it.each([
      ["director", () => director],
      ["coordinator", () => coordinator],
      ["superadmin", () => superadmin],
    ])("%s creates, edits, reschedules and cancels", async (_name, actorOf) => {
      const actor = actorOf();

      const created = await createLesson(body(), actor);
      await patchLesson(created.id, actor, { title: "Novo título" }).expect(200);
      await rescheduleLesson(created.id, actor, {
        date: "2026-03-17",
        startTime: "14:00",
        endTime: "15:30",
      }).expect(200);
      const cancelled = await cancelLesson(created.id, actor, { reason: "Feriado." }).expect(200);

      expect(cancelled.body).toMatchObject({
        status: "cancelled",
        createdById: actor.id,
        cancelledById: actor.id,
      });
    });
  });

  describe("routes and events", () => {
    it("has no DELETE /lessons/:id route", async () => {
      const created = await createLesson();

      const res = await request(app.getHttpServer())
        .delete(`/lessons/${created.id}`)
        .set("Cookie", coordinator.cookie)
        .expect(404);

      expect(res.body.error).toBe("NOT_FOUND");
      expect(await countLessons()).toBe(1);
    });

    it("has no listing yet: GET /lessons is another card", async () => {
      const res = await request(app.getHttpServer())
        .get("/lessons")
        .set("Cookie", coordinator.cookie)
        .expect(404);

      expect(res.body.error).toBe("NOT_FOUND");
    });

    it("emits one event per mutation: CREATED, UPDATED, RESCHEDULED, CANCELLED", async () => {
      const events = collectEvents();
      const cancelled = collectCancelled();

      const created = await createLesson();
      await patchLesson(created.id, coordinator, { status: "confirmed" }).expect(200);
      await rescheduleLesson(created.id, director, {
        date: "2026-03-17",
        startTime: "14:00",
        endTime: "15:30",
      }).expect(200);
      await cancelLesson(created.id, coordinator, { reason: "Feriado." }).expect(200);

      expect(events.map((event) => event.action)).toEqual([
        AuditableAction.LESSON_CREATED,
        AuditableAction.LESSON_UPDATED,
        AuditableAction.LESSON_RESCHEDULED,
        AuditableAction.LESSON_CANCELLED,
      ]);
      expect(events.map((event) => event.actorId)).toEqual([
        director.id,
        coordinator.id,
        director.id,
        coordinator.id,
      ]);
      expect(events.every((event) => event.targetId === created.id)).toBe(true);
      // Only the cancellation goes to the channel of the hours.
      expect(cancelled).toHaveLength(1);
    });
  });
});
