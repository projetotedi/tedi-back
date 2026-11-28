/**
 * E2e spec for the applications of the members — GUS-160 (candidatura e aprovação).
 *
 * CA1: a member applies as monitor to a lesson with an open place and sees it pending in Minhas aulas
 * CA2: a director approves and the coverage of the lesson goes up; declining frees the place
 * CA3: a member gets 403 on the routes of the review
 *
 * Routes: POST /lessons/:id/applications, GET /applications, PATCH /applications/:id/approve,
 * PATCH /applications/:id/reject, GET /me/assignments and GET /me/open-lessons.
 *
 * The clock of the app is fixed at 2026-03-09 12:00 in São Paulo (`Clock` overridden in every
 * module that provides it), so "today" and "the past" do not move with the day the suite runs. The
 * scenery (the people, the course, the class and the lessons) comes from the services that the
 * other modules export, and a department and a member profile from the fixture of `people`, as in
 * the e2e of the GUS-158. Sessions are cookies signed with the JwtService (no login). Some tests run
 * two requests at the same time, so the app listens on a port of its own.
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
import { CatalogModule } from "@modules/catalog/catalog.module";
import { CoursesService } from "@modules/catalog/services/courses.service";
import { LessonPlansService } from "@modules/catalog/services/lesson-plans.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService, ClassStatus } from "@modules/classes/services/classes.service";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { LessonsService } from "@modules/lessons/services/lessons.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Clock } from "@shared/dates/clock";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { AssignmentsModule } from "../assignments.module";
import { lessonStaffLockKey } from "../services/applications.service";
import {
  assignmentBody,
  CLASS_PERIOD,
  insertAssignment,
  insertDepartment,
  insertLesson,
  insertMemberProfile,
  lessonBody,
} from "./fixtures/assignments.fixture";

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

process.env.JWT_SECRET = "e2e-applications-secret";

const SESSION_COOKIE_NAME = "tedi_session";

/** 12:00 in São Paulo on 2026-03-09: the "now" of every service of the app. */
const NOW = new Date("2026-03-09T15:00:00.000Z");
const TODAY = "2026-03-09";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

const NOTE = "Posso chegar 15 min antes para ligar os computadores.";

type CreateCourseInput = Parameters<CoursesService["create"]>[0];
type CreateLessonInput = Parameters<LessonsService["create"]>[0];

/** Someone with a session: a member who applies, or a director who reviews. */
interface Actor {
  id: string;
  name: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface AssignmentBody extends Record<string, unknown> {
  id: string;
  lessonId: string;
  person: { id: string; name: string } | null;
  role: string;
  status: string;
  source: string;
  note: string | null;
  createdById: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  cancelledById: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CoverageBody {
  teacher: { confirmed: number; expected: number };
  monitors: { confirmed: number; expected: number | null };
}

interface AgendaLessonBody {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  sequenceOrder: number | null;
  location: string | null;
  class: { id: string; code: string; name: string };
}

interface MyAssignmentsBody {
  from: string;
  to: string;
  totals: { upcoming: number; confirmed: number; pending: number; openLessons: number };
  items: Array<{
    id: string;
    lesson: AgendaLessonBody;
    role: string;
    status: string;
    source: string;
  }>;
}

interface OpenLessonBody {
  lesson: AgendaLessonBody;
  coverage: CoverageBody;
  openRoles: string[];
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

describe("Applications (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonsService: LessonsService;
  let lessonPlansService: LessonPlansService;

  let director: Actor;
  let coordinator: Actor;
  let superadmin: Actor;

  /** Members with an approved profile (Tecnologia: ana and bruno; Comunicação: carla). */
  let ana: Actor;
  let bruno: Actor;
  let carla: Actor;
  /** A member with a role and no member profile at all: active by the rule of the GUS-158. */
  let diego: Actor;

  let tech: string;
  let comms: string;
  let classId: string;
  /** The lesson of the scenery: 2026-03-10, two monitors expected, nobody assigned. */
  let lessonId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          // Every entity: the foreign keys of LessonAssignment point to other modules' tables by name.
          entities: [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
        AuthModule,
        PeopleModule,
        CatalogModule,
        ClassesModule,
        LessonsModule,
        AssignmentsModule,
      ],
    })
      // Every module that provides a Clock gets this one: "today" is 2026-03-09 in São Paulo.
      .overrideProvider(Clock)
      .useValue({ now: () => new Date(NOW) })
      .compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    // One server up for the whole suite: supertest would otherwise open and close it around each
    // request, and the close of one request resets a concurrent one (the races below).
    await app.listen(0);

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    jwtService = module.get(JwtService);
    eventEmitter = module.get(EventEmitter2);
    coursesService = module.get(CoursesService);
    classesService = module.get(ClassesService);
    lessonsService = module.get(LessonsService);
    lessonPlansService = module.get(LessonPlansService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // CASCADE from people also truncates member_profiles and student_profiles.
    await dataSource.query(
      `TRUNCATE TABLE lesson_assignments, lessons, classes, editions, course_lesson_plans,
                      lesson_plan_contents, lesson_plans, course_prerequisites, courses, invites,
                      departments, people
       RESTART IDENTITY CASCADE`,
    );

    tech = await insertDepartment(dataSource, "Tecnologia");
    comms = await insertDepartment(dataSource, "Comunicação");

    director = await createActor("Director", Role.DIRECTOR);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    superadmin = await createActor("Superadmin", Role.SUPERADMIN);

    ana = await createMember("Ana Torres", tech);
    bruno = await createMember("Bruno Lima", tech);
    carla = await createMember("Carla Menezes", comms);
    diego = await createMember("Diego Rocha", null);

    const courseId = await createCourse("Informática Básica");
    classId = await createClassOf(courseId, "INFO-A");
    lessonId = await createLesson({ date: "2026-03-10", expectedMonitors: 2 });
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
  });

  // ---------------------------------------------------------------------------
  // Scenery
  // ---------------------------------------------------------------------------

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, name, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /** A member with a session: a role, access, and (optionally) an approved profile in a department. */
  async function createMember(name: string, departmentId: string | null): Promise<Actor> {
    const member = await createActor(name, Role.MEMBER);
    if (departmentId !== null) {
      await insertMemberProfile(dataSource, {
        personId: member.id,
        status: "approved",
        departmentId,
      });
    }
    return member;
  }

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

  /** A lesson of the class of the scenery, through the service that the lessons export. */
  async function createLesson(overrides: Record<string, unknown> = {}): Promise<string> {
    const lesson = await lessonsService.create(
      lessonBody({ classId, ...overrides }) as unknown as CreateLessonInput,
      director.id,
    );
    return lesson.id;
  }

  /** Marks a lesson done, as `PATCH /lessons/:id` with status done leaves it (no rule of transition). */
  async function markDone(id: string): Promise<void> {
    await dataSource.query(`UPDATE lessons SET status = 'done' WHERE id = $1`, [id]);
  }

  /**
   * A lesson of the class of the scenery that came from a plan, at a position of the sequence (the
   * 5 of "Aula 5"): inserted through the fixture of the lessons, since POST /lessons only takes a
   * position with the sequence of the course behind it.
   */
  async function createLessonOfPlan(values: {
    title: string;
    sequenceOrder: number;
    date: string;
    location?: string;
    expectedMonitors?: number;
  }): Promise<string> {
    const plan = await lessonPlansService.create(
      { title: values.title, objective: null, expectedDurationMinutes: 90, contents: ["Conteúdo"] },
      director.id,
    );
    const lesson = await insertLesson(dataSource, {
      classId,
      createdById: director.id,
      lessonPlanId: plan.id,
      ...values,
    });
    return lesson.id;
  }

  /** Cancels a lesson the way the FOR UPDATE of PATCH /lessons/:id/cancel leaves it. */
  async function cancelLesson(id: string): Promise<void> {
    await dataSource.query(
      `UPDATE lessons SET status = 'cancelled', cancelled_at = now(), cancelled_by_id = $2 WHERE id = $1`,
      [id, director.id],
    );
  }

  // ---------------------------------------------------------------------------
  // HTTP and database helpers
  // ---------------------------------------------------------------------------

  function applyTo(forLessonId: string, actor: Actor | null, payload: Record<string, unknown>) {
    const req = request(app.getHttpServer()).post(`/lessons/${forLessonId}/applications`);
    return (actor === null ? req : req.set("Cookie", actor.cookie)).send(payload);
  }

  /** The member applies through the route, and the application comes back. */
  async function apply(
    who: Actor,
    role: "teacher" | "monitor" = "monitor",
    forLessonId: string = lessonId,
  ): Promise<AssignmentBody> {
    const res = await applyTo(forLessonId, who, { role }).expect(201);
    return res.body as AssignmentBody;
  }

  /** The member applies with a note, and the application comes back with it. */
  async function applyWithNote(who: Actor, note: string): Promise<AssignmentBody> {
    const res = await applyTo(lessonId, who, { role: "monitor", note }).expect(201);
    return res.body as AssignmentBody;
  }

  function getPending(actor: Actor, query: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .get("/applications")
      .query(query)
      .set("Cookie", actor.cookie);
  }

  function approve(id: string, actor: Actor) {
    return request(app.getHttpServer())
      .patch(`/applications/${id}/approve`)
      .set("Cookie", actor.cookie);
  }

  function reject(id: string, actor: Actor) {
    return request(app.getHttpServer())
      .patch(`/applications/${id}/reject`)
      .set("Cookie", actor.cookie);
  }

  function getMine(actor: Actor, query: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .get("/me/assignments")
      .query(query)
      .set("Cookie", actor.cookie);
  }

  function getOpen(actor: Actor, query: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .get("/me/open-lessons")
      .query(query)
      .set("Cookie", actor.cookie);
  }

  /** The coverage of a lesson, as GET /lessons/:id shows it (only confirmed assignments count). */
  async function coverageOf(forLessonId: string): Promise<CoverageBody> {
    const res = await request(app.getHttpServer())
      .get(`/lessons/${forLessonId}`)
      .set("Cookie", coordinator.cookie)
      .expect(200);
    return (res.body as { coverage: CoverageBody }).coverage;
  }

  /** A direct assignment of the GUS-158, made by the director. */
  async function assignDirect(
    who: Actor,
    overrides: { role?: "teacher" | "monitor"; status?: "pending" | "confirmed" } = {},
    forLessonId: string = lessonId,
  ): Promise<AssignmentBody> {
    const res = await request(app.getHttpServer())
      .post(`/lessons/${forLessonId}/assignments`)
      .set("Cookie", director.cookie)
      .send(assignmentBody({ personId: who.id, ...overrides }))
      .expect(201);
    return res.body as AssignmentBody;
  }

  function cancelAssignment(id: string, actor: Actor = director) {
    return request(app.getHttpServer())
      .patch(`/assignments/${id}/cancel`)
      .set("Cookie", actor.cookie);
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  async function countAssignments(): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM lesson_assignments`,
    );
    return Number(rows[0].total);
  }

  async function countConfirmed(forLessonId: string, role: "teacher" | "monitor"): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM lesson_assignments
        WHERE lesson_id = $1 AND role = $2 AND status = 'confirmed'`,
      [forLessonId, role],
    );
    return Number(rows[0].total);
  }

  /** The row as the table has it. */
  async function storedAssignment(id: string): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT lesson_id, person_id, role, status, source, note, created_by_id, reviewed_by_id,
              reviewed_at, cancelled_by_id, cancelled_at, deleted_at, updated_at
         FROM lesson_assignments WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  /**
   * The text of a statement that is waiting for a lock, or undefined after 3 seconds: a row lock or
   * an advisory lock (both are wait_event_type Lock). A plain SELECT is never blocked by a row lock
   * (MVCC), so a statement that waits proves it takes the lock.
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
   * concurrent write of another module would. `run` runs a statement inside that transaction;
   * `release` commits it. The caller releases it in a `finally`, so a failed assertion does not
   * leave the transaction open and the suite stuck.
   */
  async function holdRow(table: "lessons" | "classes" | "people", id: string, lock: string) {
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

  /**
   * Holds the advisory lock of a key in a transaction of its own, as an approval of the same lesson
   * in flight does. `run` and `release` as in `holdRow`.
   */
  async function holdAdvisory(key: string) {
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);

    return {
      run: (sql: string, parameters: unknown[]) => holder.query(sql, parameters),
      release: async () => {
        await holder.commitTransaction();
        await holder.release();
      },
    };
  }

  // ---------------------------------------------------------------------------
  // POST /lessons/:id/applications
  // ---------------------------------------------------------------------------

  describe("POST /lessons/:id/applications (applyToLesson)", () => {
    it("creates a pending application of the member as monitor in a lesson with an open place (201)", async () => {
      const res = await applyTo(lessonId, ana, { role: "monitor", note: `  ${NOTE}  ` }).expect(
        201,
      );

      expect(res.body).toEqual({
        id: expect.any(String),
        lessonId,
        person: { id: ana.id, name: "Ana Torres" },
        role: "monitor",
        status: "pending",
        source: "application",
        note: NOTE,
        createdById: ana.id,
        reviewedById: null,
        reviewedAt: null,
        cancelledById: null,
        cancelledAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(await storedAssignment(res.body.id)).toMatchObject({
        lesson_id: lessonId,
        person_id: ana.id,
        role: "monitor",
        status: "pending",
        source: "application",
        note: NOTE,
        created_by_id: ana.id,
        reviewed_by_id: null,
        reviewed_at: null,
        cancelled_by_id: null,
        cancelled_at: null,
        deleted_at: null,
      });
    });

    it("applies as teacher in a lesson without a confirmed teacher, while other teachers are pending", async () => {
      await assignDirect(bruno, { role: "teacher", status: "pending" });
      await apply(carla, "teacher");

      const application = await apply(ana, "teacher");

      expect(application).toMatchObject({ role: "teacher", status: "pending" });
      expect(await countAssignments()).toBe(3);
    });

    it("lets a director, a coordinator and a superadmin apply for themselves", async () => {
      for (const actor of [director, coordinator, superadmin]) {
        const application = await apply(actor);

        expect(application.person).toEqual({ id: actor.id, name: actor.name });
        expect(application.createdById).toBe(actor.id);
        expect(application.source).toBe("application");
      }
    });

    it("lets a member without a member profile apply: she is active by the rule of the GUS-158", async () => {
      const application = await apply(diego);

      expect(application.person).toEqual({ id: diego.id, name: "Diego Rocha" });
    });

    it("ignores personId, status and source in the body: the applicant is the one of the session", async () => {
      const res = await applyTo(lessonId, ana, {
        role: "monitor",
        personId: bruno.id,
        status: "confirmed",
        source: "direct",
      }).expect(201);

      expect(res.body).toMatchObject({
        person: { id: ana.id },
        status: "pending",
        source: "application",
        createdById: ana.id,
        reviewedById: null,
      });
      expect(await countAssignments()).toBe(1);
    });

    it("answers 400 VALIDATION_FAILED without role, for a role that is not teacher or monitor, and for a note over 500 characters", async () => {
      const cases: Array<[Record<string, unknown>, string[]]> = [
        [{}, ["role"]],
        [{ role: "student" }, ["role"]],
        [{ role: "monitor", note: "x".repeat(501) }, ["note"]],
      ];

      for (const [payload, fields] of cases) {
        const res = await applyTo(lessonId, ana, payload).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(fields);
      }
      expect(await countAssignments()).toBe(0);
    });

    it("answers 404 LESSON_NOT_FOUND for an unknown and for a malformed lesson id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await applyTo(id, ana, { role: "monitor" }).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "LESSON_NOT_FOUND",
          message: "Lesson not found.",
        });
      }
    });

    it("answers 409 LESSON_CANCELLED for a cancelled lesson", async () => {
      await cancelLesson(lessonId);

      const res = await applyTo(lessonId, ana, { role: "monitor" }).expect(409);

      expect(res.body.error).toBe("LESSON_CANCELLED");
      expect(await countAssignments()).toBe(0);
    });

    it("accepts an application in planned and in_progress classes (201)", async () => {
      await apply(ana, "monitor", lessonId);

      const inProgressClass = await createClassOf(
        await createCourse("Segurança Digital"),
        "SEG-IP",
      );
      await classesService.update(
        inProgressClass,
        { status: ClassStatus.IN_PROGRESS },
        director.id,
      );
      const inProgressLesson = await createLesson({
        classId: inProgressClass,
        date: "2026-03-17",
        expectedMonitors: 2,
      });

      await apply(bruno, "monitor", inProgressLesson);

      expect(await countAssignments()).toBe(2);
    });

    it("answers 409 CLASS_NOT_ACTIVE for an archived, completed or cancelled class, and saves nothing", async () => {
      const courseId = await createCourse("Segurança Digital");
      const archivedClass = await createClassOf(courseId, "SEG-ARCH");
      const completedClass = await createClassOf(courseId, "SEG-COMP");
      const cancelledClass = await createClassOf(courseId, "SEG-CANC");

      const archivedLesson = await createLesson({ classId: archivedClass, expectedMonitors: 2 });
      const completedLesson = await createLesson({ classId: completedClass, expectedMonitors: 2 });
      const cancelledLesson = await createLesson({ classId: cancelledClass, expectedMonitors: 2 });

      await classesService.archive(archivedClass, undefined, director.id);
      await classesService.update(completedClass, { status: ClassStatus.COMPLETED }, director.id);
      await classesService.update(cancelledClass, { status: ClassStatus.CANCELLED }, director.id);

      const events = collectEvents();
      for (const targetLessonId of [archivedLesson, completedLesson, cancelledLesson]) {
        const res = await applyTo(targetLessonId, ana, { role: "monitor" }).expect(409);

        expect(res.body).toEqual({
          statusCode: 409,
          error: "CLASS_NOT_ACTIVE",
          message: "Assignments and applications are only allowed in active classes.",
        });
      }
      expect(await countAssignments()).toBe(0);
      expect(events).toHaveLength(0);
    });

    it("waits for an archive or status update of the class that is in flight, and then answers 409 CLASS_NOT_ACTIVE", async () => {
      const classLock = await holdRow("classes", classId, "FOR UPDATE");
      const pending = applyTo(lessonId, ana, { role: "monitor" }).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/"SchoolClass"/);
        expect(await countAssignments()).toBe(0);
        await classLock.run(`UPDATE classes SET status = 'completed' WHERE id = $1`, [classId]);
      } finally {
        await classLock.release();
      }

      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("CLASS_NOT_ACTIVE");
      expect(await countAssignments()).toBe(0);
    });

    it("answers 409 LESSON_IN_PAST for a lesson before today, and accepts a lesson of today", async () => {
      const past = await createLesson({ date: "2026-03-05", expectedMonitors: 2 });
      const today = await createLesson({ date: TODAY, expectedMonitors: 2 });

      const res = await applyTo(past, ana, { role: "monitor" }).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        error: "LESSON_IN_PAST",
        message: "Applications are only taken for lessons that have not happened yet.",
      });
      await applyTo(today, ana, { role: "monitor" }).expect(201);
    });

    it("answers 409 LESSON_IN_PAST for a lesson of today already marked done, and for a later one marked done, and leaves both out of /me/open-lessons", async () => {
      const doneToday = await createLesson({ date: TODAY, expectedMonitors: 2 });
      const doneLater = await createLesson({ date: "2026-03-17", expectedMonitors: 2 });
      await markDone(doneToday);
      await markDone(doneLater);

      for (const forLessonId of [doneToday, doneLater]) {
        const res = await applyTo(forLessonId, ana, { role: "monitor" }).expect(409);

        expect(res.body.error).toBe("LESSON_IN_PAST");
      }
      expect(await countAssignments()).toBe(0);

      const open = (await getOpen(ana).expect(200)).body as OpenLessonBody[];
      const mine = (await getMine(ana).expect(200)).body as MyAssignmentsBody;
      expect(open.map((item) => item.lesson.id)).toEqual([lessonId]);
      expect(mine.totals.openLessons).toBe(1);
    });

    it("answers 409 MEMBER_INACTIVE for a member whose profile is inactive but whose access was enabled again", async () => {
      // The access is still enabled (it was enabled again in /access after the inactivation): the
      // guard lets her in, and only the status of the profile keeps her out.
      await dataSource.query(
        `UPDATE member_profiles SET status = 'inactive', exit_date = '2026-03-01' WHERE person_id = $1`,
        [ana.id],
      );

      const res = await applyTo(lessonId, ana, { role: "monitor" }).expect(409);

      expect(res.body.error).toBe("MEMBER_INACTIVE");
      expect(await countAssignments()).toBe(0);
    });

    it("answers 409 ALREADY_APPLIED when the member already applied to the lesson, as the same role or the other one", async () => {
      await apply(ana, "monitor");

      for (const role of ["monitor", "teacher"]) {
        const res = await applyTo(lessonId, ana, { role }).expect(409);

        expect(res.body).toEqual({
          statusCode: 409,
          error: "ALREADY_APPLIED",
          message: "The member already has an assignment or an application in this lesson.",
        });
      }
      expect(await countAssignments()).toBe(1);
    });

    it("answers 409 ALREADY_APPLIED when the member is already assigned to the lesson, pending or confirmed", async () => {
      await assignDirect(ana, { role: "teacher", status: "pending" });
      await assignDirect(bruno, { role: "monitor", status: "confirmed" });

      const pending = await applyTo(lessonId, ana, { role: "monitor" }).expect(409);
      const confirmed = await applyTo(lessonId, bruno, { role: "teacher" }).expect(409);

      expect(pending.body.error).toBe("ALREADY_APPLIED");
      expect(confirmed.body.error).toBe("ALREADY_APPLIED");
      expect(await countAssignments()).toBe(2);
    });

    it("accepts a new application after the previous one was declined, and after the assignment was cancelled", async () => {
      await insertAssignment(dataSource, {
        lessonId,
        personId: ana.id,
        createdById: ana.id,
        status: "declined",
        source: "application",
        reviewedById: coordinator.id,
        reviewedAt: NOW,
      });
      const direct = await assignDirect(bruno, { role: "monitor", status: "confirmed" });
      await cancelAssignment(direct.id).expect(200);

      await apply(ana);
      await apply(bruno);

      expect(await countAssignments()).toBe(4);
    });

    it("answers 409 ROLE_FULL for teacher when the lesson has a confirmed teacher", async () => {
      await assignDirect(bruno, { role: "teacher", status: "confirmed" });

      const res = await applyTo(lessonId, ana, { role: "teacher" }).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        error: "ROLE_FULL",
        message: "The lesson has no open place for this role.",
      });
      // The monitors are another place: still open.
      await apply(ana, "monitor");
    });

    it("answers 409 ROLE_FULL for monitor when the confirmed monitors reach expectedMonitors, and when expectedMonitors is null or 0", async () => {
      await assignDirect(bruno, { role: "monitor", status: "confirmed" });
      await assignDirect(carla, { role: "monitor", status: "confirmed" });
      const notInformed = await createLesson({ date: "2026-03-24" });
      const noMonitors = await createLesson({ date: "2026-03-31", expectedMonitors: 0 });

      for (const forLessonId of [lessonId, notInformed, noMonitors]) {
        const res = await applyTo(forLessonId, ana, { role: "monitor" }).expect(409);

        expect(res.body.error).toBe("ROLE_FULL");
      }
      expect(await countAssignments()).toBe(2);
    });

    it("does not count pending applications as places: a second member applies to the last monitor place", async () => {
      const onePlace = await createLesson({ date: "2026-03-17", expectedMonitors: 1 });
      await apply(ana, "monitor", onePlace);

      const second = await apply(bruno, "monitor", onePlace);

      expect(second.status).toBe("pending");
    });

    it("keeps one application when the same member applies twice at the same time: 201 and 409 ALREADY_APPLIED", async () => {
      const [first, second] = await Promise.all([
        applyTo(lessonId, ana, { role: "monitor" }),
        applyTo(lessonId, ana, { role: "teacher" }),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const refused = first.status === 409 ? first : second;
      expect(refused.body.error).toBe("ALREADY_APPLIED");
      expect(await countAssignments()).toBe(1);
    });

    it("emits LESSON_ASSIGNMENT_APPLIED once, after the commit, without the note, and nothing for a refused request", async () => {
      const events = collectEvents();

      const res = await applyTo(lessonId, ana, { role: "monitor", note: NOTE }).expect(201);
      await applyTo(lessonId, ana, { role: "monitor" }).expect(409);
      await applyTo(UNKNOWN_ID, bruno, { role: "monitor" }).expect(404);
      await applyTo(lessonId, bruno, {}).expect(400);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: ana.id,
        action: AuditableAction.LESSON_ASSIGNMENT_APPLIED,
        targetType: "lesson_assignment",
        targetId: res.body.id,
        before: null,
        after: {
          lessonId,
          personId: ana.id,
          role: "monitor",
          status: "pending",
          source: "application",
        },
        occurredAt: NOW,
      });
      expect(JSON.stringify(events[0])).not.toContain(NOTE);
    });

    it("answers 401 without a session", async () => {
      const res = await applyTo(lessonId, null, { role: "monitor" }).expect(401);

      expect(res.body.error).toBe("UNAUTHORIZED");
      expect(await countAssignments()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /applications
  // ---------------------------------------------------------------------------

  describe("GET /applications (listPendingApplications)", () => {
    it("groups the pending applications by lesson, the soonest lesson first and the oldest application first, with the class, the position, the coverage and the note", async () => {
      const lessonFive = await createLessonOfPlan({
        title: "E-mail do zero",
        sequenceOrder: 5,
        date: "2026-03-17",
        location: "Laboratório 2",
        expectedMonitors: 3,
      });
      await assignDirect(director, { role: "monitor", status: "confirmed" }, lessonFive);
      const first = await applyTo(lessonFive, ana, { role: "monitor", note: NOTE }).expect(201);
      const second = await apply(bruno, "teacher", lessonId);
      const third = await apply(carla, "teacher", lessonFive);
      const fourth = await apply(diego, "monitor", lessonId);

      const res = await getPending(coordinator).expect(200);

      expect(res.body.total).toBe(4);
      expect(res.body.lessons).toHaveLength(2);
      expect(res.body.lessons[0]).toEqual({
        lesson: {
          id: lessonId,
          title: "Teclado, mouse e janelas",
          date: "2026-03-10",
          startTime: "14:00",
          endTime: "15:30",
          status: "planned",
          sequenceOrder: null,
          location: null,
          class: { id: classId, code: "INFO-A", name: "INFO-A" },
        },
        coverage: {
          teacher: { confirmed: 0, expected: 1 },
          monitors: { confirmed: 0, expected: 2 },
        },
        applications: [
          expect.objectContaining({
            id: second.id,
            person: { id: bruno.id, name: "Bruno Lima" },
            role: "teacher",
            status: "pending",
            source: "application",
            note: null,
          }),
          expect.objectContaining({ id: fourth.id, person: { id: diego.id, name: "Diego Rocha" } }),
        ],
      });
      expect(res.body.lessons[1].lesson).toMatchObject({
        id: lessonFive,
        title: "E-mail do zero",
        sequenceOrder: 5,
        date: "2026-03-17",
        location: "Laboratório 2",
      });
      expect(res.body.lessons[1].coverage).toEqual({
        teacher: { confirmed: 0, expected: 1 },
        monitors: { confirmed: 1, expected: 3 },
      });
      expect(
        res.body.lessons[1].applications.map((item: AssignmentBody) => [item.id, item.note]),
      ).toEqual([
        [first.body.id, NOTE],
        [third.id, null],
      ]);
      // "Enviada em": when the member sent it.
      expect(res.body.lessons[1].applications[0].createdAt).toBe(first.body.createdAt);
    });

    it("counts in total every pending application listed: the number of the button", async () => {
      const other = await createLesson({ date: "2026-03-17", expectedMonitors: 2 });
      await apply(ana, "monitor", lessonId);
      await apply(bruno, "teacher", lessonId);
      await apply(carla, "monitor", other);

      const res = await getPending(director).expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.lessons).toHaveLength(2);
    });

    it("leaves out direct pending assignments and applications that were approved or declined", async () => {
      await assignDirect(ana, { role: "monitor", status: "pending" });
      const approved = await apply(bruno);
      const declined = await apply(carla);
      const waiting = await apply(diego);
      await approve(approved.id, director).expect(200);
      await reject(declined.id, director).expect(200);

      const res = await getPending(coordinator).expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.lessons[0].applications.map((item: AssignmentBody) => item.id)).toEqual([
        waiting.id,
      ]);
    });

    it("lists a pending application of a cancelled lesson and of a past lesson, so it can be declined", async () => {
      const past = await createLesson({ date: "2026-03-05", expectedMonitors: 2 });
      // The route refuses a past lesson: this one was sent before the lesson happened.
      const ofPast = await insertAssignment(dataSource, {
        lessonId: past,
        personId: bruno.id,
        createdById: bruno.id,
        source: "application",
      });
      const ofCancelled = await apply(ana);
      await cancelLesson(lessonId);

      const res = await getPending(coordinator).expect(200);

      expect(
        res.body.lessons.map((group: { lesson: { date: string; status: string } }) => [
          group.lesson.date,
          group.lesson.status,
        ]),
      ).toEqual([
        ["2026-03-05", "planned"],
        ["2026-03-10", "cancelled"],
      ]);
      await reject(ofPast, coordinator).expect(200);
      await reject(ofCancelled.id, coordinator).expect(200);
      expect((await getPending(coordinator).expect(200)).body).toEqual({ total: 0, lessons: [] });
    });

    it("shows the coverage counting only confirmed assignments: a pending application does not raise it", async () => {
      await apply(ana, "monitor");
      await apply(bruno, "teacher");
      await assignDirect(carla, { role: "monitor", status: "confirmed" });

      const res = await getPending(coordinator).expect(200);

      expect(res.body.lessons[0].coverage).toEqual({
        teacher: { confirmed: 0, expected: 1 },
        monitors: { confirmed: 1, expected: 2 },
      });
    });

    it("answers { total: 0, lessons: [] } with no pending application", async () => {
      await assignDirect(ana, { role: "monitor", status: "pending" });

      const res = await getPending(coordinator).expect(200);

      expect(res.body).toEqual({ total: 0, lessons: [] });
    });

    it("accepts ?status=pending and no status, and answers 400 VALIDATION_FAILED for another status", async () => {
      await apply(ana);

      const withStatus = await getPending(coordinator, { status: "pending" }).expect(200);
      const without = await getPending(coordinator).expect(200);
      const other = await getPending(coordinator, { status: "declined" }).expect(400);

      expect(withStatus.body).toEqual(without.body);
      expect(withStatus.body.total).toBe(1);
      expect(other.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(other.body)).toEqual(["status"]);
    });

    it("lets a coordinator, a superadmin and directors of any department list them, note included", async () => {
      const directorComms = await createActor("Director Comms", Role.DIRECTOR);
      await insertMemberProfile(dataSource, {
        personId: directorComms.id,
        status: "approved",
        departmentId: comms,
      });
      await applyTo(lessonId, ana, { role: "monitor", note: NOTE }).expect(201);

      for (const actor of [coordinator, superadmin, director, directorComms]) {
        const res = await getPending(actor).expect(200);

        expect(res.body.total).toBe(1);
        expect(res.body.lessons[0].applications[0].note).toBe(NOTE);
      }
    });

    it("answers 401 without a session on GET /applications, approve and reject", async () => {
      const application = await apply(ana);
      const events = collectEvents();

      const list = await request(app.getHttpServer()).get("/applications").expect(401);
      const approval = await request(app.getHttpServer())
        .patch(`/applications/${application.id}/approve`)
        .expect(401);
      const decline = await request(app.getHttpServer())
        .patch(`/applications/${application.id}/reject`)
        .expect(401);

      for (const res of [list, approval, decline]) {
        expect(res.body.error).toBe("UNAUTHORIZED");
      }
      expect((await storedAssignment(application.id)).status).toBe("pending");
      expect(events).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /applications/:id/approve
  // ---------------------------------------------------------------------------

  describe("PATCH /applications/:id/approve (approveApplication)", () => {
    it("approves a pending application: confirmed, reviewedById and reviewedAt, and the coverage of GET /lessons/:id goes up", async () => {
      const application = await applyWithNote(ana, NOTE);
      expect((await coverageOf(lessonId)).monitors).toEqual({ confirmed: 0, expected: 2 });

      const res = await approve(application.id, director).expect(200);

      expect(res.body).toEqual({
        ...application,
        status: "confirmed",
        reviewedById: director.id,
        reviewedAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      });
      expect(res.body.note).toBe(NOTE);
      expect(await storedAssignment(application.id)).toMatchObject({
        status: "confirmed",
        source: "application",
        reviewed_by_id: director.id,
        reviewed_at: NOW,
        updated_at: NOW,
      });
      expect((await coverageOf(lessonId)).monitors).toEqual({ confirmed: 1, expected: 2 });
    });

    it("answers 200 without writing when it is already confirmed", async () => {
      const application = await apply(ana);
      const first = await approve(application.id, director).expect(200);
      const events = collectEvents();

      const second = await approve(application.id, coordinator).expect(200);

      expect(second.body).toEqual(first.body);
      expect(second.body.reviewedById).toBe(director.id);
      expect(events).toHaveLength(0);
    });

    it("answers 404 APPLICATION_NOT_FOUND for an unknown id, a malformed id and a direct assignment", async () => {
      const direct = await assignDirect(ana, { role: "monitor", status: "pending" });

      for (const id of [UNKNOWN_ID, "not-a-uuid", direct.id]) {
        const res = await approve(id, director).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "APPLICATION_NOT_FOUND",
          message: "Application not found.",
        });
      }
      expect((await storedAssignment(direct.id)).status).toBe("pending");
    });

    it("answers 409 APPLICATION_NOT_PENDING for a declined and for a cancelled application", async () => {
      const declined = await apply(ana);
      await reject(declined.id, director).expect(200);
      const cancelled = await apply(bruno);
      await cancelAssignment(cancelled.id).expect(200);

      for (const id of [declined.id, cancelled.id]) {
        const res = await approve(id, director).expect(409);

        expect(res.body).toEqual({
          statusCode: 409,
          error: "APPLICATION_NOT_PENDING",
          message: "Only a pending application can be approved or declined.",
        });
      }
    });

    it("answers 409 LESSON_CANCELLED when the lesson was cancelled while the application waited", async () => {
      const application = await apply(ana);
      await cancelLesson(lessonId);

      const res = await approve(application.id, director).expect(409);

      expect(res.body.error).toBe("LESSON_CANCELLED");
      expect((await storedAssignment(application.id)).status).toBe("pending");
    });

    it("answers 409 MEMBER_INACTIVE when the member became inactive while it waited", async () => {
      const application = await apply(ana);
      await dataSource.query(
        `UPDATE member_profiles SET status = 'inactive', exit_date = '2026-03-01' WHERE person_id = $1`,
        [ana.id],
      );

      const res = await approve(application.id, director).expect(409);

      expect(res.body.error).toBe("MEMBER_INACTIVE");
      expect((await storedAssignment(application.id)).status).toBe("pending");
    });

    it("answers 409 ROLE_FULL for a monitor when the monitors are already full", async () => {
      const application = await apply(ana, "monitor");
      await assignDirect(bruno, { role: "monitor", status: "confirmed" });
      await assignDirect(carla, { role: "monitor", status: "confirmed" });

      const res = await approve(application.id, director).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        error: "ROLE_FULL",
        message: "The lesson has no open place for this role.",
      });
      expect(await countConfirmed(lessonId, "monitor")).toBe(2);
    });

    it("answers 409 ROLE_FULL for a teacher when another teacher is confirmed", async () => {
      const application = await apply(ana, "teacher");
      await assignDirect(bruno, { role: "teacher", status: "confirmed" });

      const res = await approve(application.id, director).expect(409);

      expect(res.body.error).toBe("ROLE_FULL");
      expect(await countConfirmed(lessonId, "teacher")).toBe(1);
    });

    it("approves an application of a lesson that already happened", async () => {
      const past = await createLesson({ date: "2026-03-05", expectedMonitors: 2 });
      const application = await insertAssignment(dataSource, {
        lessonId: past,
        personId: ana.id,
        createdById: ana.id,
        source: "application",
      });

      const res = await approve(application, director).expect(200);

      expect(res.body.status).toBe("confirmed");
    });

    it("lets a director approve an application of a member of another department: assignments.review is all", async () => {
      const directorComms = await createActor("Director Comms", Role.DIRECTOR);
      await insertMemberProfile(dataSource, {
        personId: directorComms.id,
        status: "approved",
        departmentId: comms,
      });
      // Ana is in Tecnologia.
      const application = await apply(ana);

      const res = await approve(application.id, directorComms).expect(200);

      expect(res.body.reviewedById).toBe(directorComms.id);
    });

    it("never confirms more monitors than expected when two applications are approved at the same time: one 200 and one 409 ROLE_FULL", async () => {
      // Two monitors expected and one already confirmed: one place left for two applications.
      await assignDirect(carla, { role: "monitor", status: "confirmed" });
      const fromAna = await apply(ana, "monitor");
      const fromBruno = await apply(bruno, "monitor");

      const [one, other] = await Promise.all([
        approve(fromAna.id, director),
        approve(fromBruno.id, coordinator),
      ]);

      expect([one.status, other.status].sort()).toEqual([200, 409]);
      const refused = one.status === 409 ? one : other;
      expect(refused.body.error).toBe("ROLE_FULL");
      expect(await countConfirmed(lessonId, "monitor")).toBe(2);
      const statuses = [
        (await storedAssignment(fromAna.id)).status,
        (await storedAssignment(fromBruno.id)).status,
      ].sort();
      expect(statuses).toEqual(["confirmed", "pending"]);
    });

    it("keeps one confirmed teacher when two teacher applications are approved at the same time: 200 and 409 ROLE_FULL", async () => {
      const fromAna = await apply(ana, "teacher");
      const fromBruno = await apply(bruno, "teacher");

      const [one, other] = await Promise.all([
        approve(fromAna.id, director),
        approve(fromBruno.id, coordinator),
      ]);

      expect([one.status, other.status].sort()).toEqual([200, 409]);
      const refused = one.status === 409 ? one : other;
      expect(refused.body.error).toBe("ROLE_FULL");
      expect(await countConfirmed(lessonId, "teacher")).toBe(1);
    });

    it("waits on the advisory lock of the lesson and counts again after it: a monitor confirmed meanwhile makes it 409 ROLE_FULL", async () => {
      // One of two places taken; Bruno waits, pending, for a direct confirmation.
      await assignDirect(carla, { role: "monitor", status: "confirmed" });
      const waiting = await assignDirect(bruno, { role: "monitor", status: "pending" });
      const application = await apply(ana, "monitor");

      const holder = await holdAdvisory(lessonStaffLockKey(lessonId));
      const pending = approve(application.id, director).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/pg_advisory_xact_lock/);
        // It has not been decided while the place can still change under it.
        expect((await storedAssignment(application.id)).status).toBe("pending");
        await holder.run(
          `UPDATE lesson_assignments
              SET status = 'confirmed', reviewed_by_id = $2, reviewed_at = now()
            WHERE id = $1`,
          [waiting.id, coordinator.id],
        );
      } finally {
        await holder.release();
      }

      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("ROLE_FULL");
      expect((await storedAssignment(application.id)).status).toBe("pending");
      expect(await countConfirmed(lessonId, "monitor")).toBe(2);
    });

    it("waits for a cancellation of the lesson that is in flight, and then answers 409 LESSON_CANCELLED", async () => {
      const application = await apply(ana);
      const cancellation = await holdRow("lessons", lessonId, "FOR UPDATE");
      const pending = approve(application.id, director).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/"Lesson"/);
        await cancellation.run(
          `UPDATE lessons SET status = 'cancelled', cancelled_at = now(), cancelled_by_id = $2 WHERE id = $1`,
          [lessonId, director.id],
        );
      } finally {
        await cancellation.release();
      }

      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("LESSON_CANCELLED");
      expect((await storedAssignment(application.id)).status).toBe("pending");
    });

    it("decides once when it is approved and declined at the same time: one 200 and one 409 APPLICATION_NOT_PENDING, and the row says who won", async () => {
      const application = await apply(ana);

      const [approval, decline] = await Promise.all([
        approve(application.id, director),
        reject(application.id, coordinator),
      ]);

      expect([approval.status, decline.status].sort()).toEqual([200, 409]);
      const refused = approval.status === 409 ? approval : decline;
      expect(refused.body.error).toBe("APPLICATION_NOT_PENDING");
      const stored = await storedAssignment(application.id);
      expect(stored.status).toBe(approval.status === 200 ? "confirmed" : "declined");
      expect(stored.reviewed_by_id).toBe(approval.status === 200 ? director.id : coordinator.id);
    });

    it("emits LESSON_ASSIGNMENT_APPROVED once, after the commit, without the note, and nothing for the no-op or a refusal", async () => {
      const application = await applyWithNote(ana, NOTE);
      const full = await apply(bruno, "teacher");
      await assignDirect(carla, { role: "teacher", status: "confirmed" });
      const events = collectEvents();

      await approve(application.id, director).expect(200);
      await approve(application.id, director).expect(200);
      await approve(full.id, director).expect(409);
      await approve(UNKNOWN_ID, director).expect(404);
      await approve(application.id, bruno).expect(403);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: director.id,
        action: AuditableAction.LESSON_ASSIGNMENT_APPROVED,
        targetType: "lesson_assignment",
        targetId: application.id,
        before: { status: "pending" },
        after: {
          status: "confirmed",
          reviewedAt: NOW,
          lessonId,
          personId: ana.id,
          role: "monitor",
        },
        occurredAt: NOW,
      });
      expect(JSON.stringify(events[0])).not.toContain(NOTE);
    });

    it("leaves PATCH /assignments/:id/confirm as it was: it confirms a pending application over the expected monitors, without ROLE_FULL", async () => {
      const application = await apply(ana, "monitor");
      await assignDirect(bruno, { role: "monitor", status: "confirmed" });
      await assignDirect(carla, { role: "monitor", status: "confirmed" });

      const res = await request(app.getHttpServer())
        .patch(`/assignments/${application.id}/confirm`)
        .set("Cookie", director.cookie)
        .expect(200);

      expect(res.body).toMatchObject({ status: "confirmed", source: "application" });
      expect(await countConfirmed(lessonId, "monitor")).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /applications/:id/reject
  // ---------------------------------------------------------------------------

  describe("PATCH /applications/:id/reject (rejectApplication)", () => {
    it("declines a pending application: declined, reviewedById and reviewedAt, and the member can apply again", async () => {
      const application = await applyWithNote(ana, NOTE);

      const res = await reject(application.id, coordinator).expect(200);

      expect(res.body).toEqual({
        ...application,
        status: "declined",
        reviewedById: coordinator.id,
        reviewedAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      });
      expect(await storedAssignment(application.id)).toMatchObject({
        status: "declined",
        reviewed_by_id: coordinator.id,
        reviewed_at: NOW,
        cancelled_by_id: null,
        cancelled_at: null,
      });
      const again = await apply(ana, "teacher");
      expect(again.id).not.toBe(application.id);
    });

    it("answers 200 without writing when it is already declined", async () => {
      const application = await apply(ana);
      const first = await reject(application.id, coordinator).expect(200);
      const events = collectEvents();

      const second = await reject(application.id, director).expect(200);

      expect(second.body).toEqual(first.body);
      expect(second.body.reviewedById).toBe(coordinator.id);
      expect(events).toHaveLength(0);
    });

    it("answers 404 APPLICATION_NOT_FOUND for an unknown id, a malformed id and a direct assignment", async () => {
      const direct = await assignDirect(ana, { role: "monitor", status: "pending" });

      for (const id of [UNKNOWN_ID, "not-a-uuid", direct.id]) {
        const res = await reject(id, coordinator).expect(404);

        expect(res.body.error).toBe("APPLICATION_NOT_FOUND");
      }
      expect((await storedAssignment(direct.id)).status).toBe("pending");
    });

    it("answers 409 APPLICATION_NOT_PENDING for a confirmed and for a cancelled application", async () => {
      const approved = await apply(ana);
      await approve(approved.id, director).expect(200);
      const cancelled = await apply(bruno);
      await cancelAssignment(cancelled.id).expect(200);

      for (const id of [approved.id, cancelled.id]) {
        const res = await reject(id, coordinator).expect(409);

        expect(res.body.error).toBe("APPLICATION_NOT_PENDING");
      }
      expect((await storedAssignment(approved.id)).status).toBe("confirmed");
    });

    it("declines an application of a cancelled lesson", async () => {
      const application = await apply(ana);
      await cancelLesson(lessonId);

      const res = await reject(application.id, coordinator).expect(200);

      expect(res.body.status).toBe("declined");
    });

    it("emits LESSON_ASSIGNMENT_DECLINED once, after the commit, without the note, and nothing for the no-op", async () => {
      const application = await applyWithNote(ana, NOTE);
      const events = collectEvents();

      await reject(application.id, coordinator).expect(200);
      await reject(application.id, coordinator).expect(200);
      await reject(UNKNOWN_ID, coordinator).expect(404);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: coordinator.id,
        action: AuditableAction.LESSON_ASSIGNMENT_DECLINED,
        targetType: "lesson_assignment",
        targetId: application.id,
        before: { status: "pending" },
        after: {
          status: "declined",
          reviewedAt: NOW,
          lessonId,
          personId: ana.id,
          role: "monitor",
        },
        occurredAt: NOW,
      });
      expect(JSON.stringify(events[0])).not.toContain(NOTE);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /me/assignments
  // ---------------------------------------------------------------------------

  describe("GET /me/assignments (listMyAssignments)", () => {
    it("lists the lessons of the next 4 weeks where the member is assigned or applied, soonest first, with the class, the position, the role and the status", async () => {
      const lessonThree = await createLessonOfPlan({
        title: "Arquivos e pastas",
        sequenceOrder: 3,
        date: "2026-03-17",
        location: "Laboratório 2",
        expectedMonitors: 2,
      });
      const far = await createLesson({ date: "2026-04-20" });
      const applied = await apply(ana, "monitor", lessonThree);
      const assigned = await assignDirect(ana, { role: "teacher", status: "confirmed" });
      await apply(ana, "teacher", far);

      const res = await getMine(ana).expect(200);
      const body = res.body as MyAssignmentsBody;

      expect(body.items).toEqual([
        {
          id: assigned.id,
          lesson: {
            id: lessonId,
            title: "Teclado, mouse e janelas",
            date: "2026-03-10",
            startTime: "14:00",
            endTime: "15:30",
            status: "planned",
            sequenceOrder: null,
            location: null,
            class: { id: classId, code: "INFO-A", name: "INFO-A" },
          },
          role: "teacher",
          status: "confirmed",
          source: "direct",
        },
        {
          id: applied.id,
          lesson: {
            id: lessonThree,
            title: "Arquivos e pastas",
            date: "2026-03-17",
            startTime: "14:00",
            endTime: "15:30",
            status: "planned",
            sequenceOrder: 3,
            location: "Laboratório 2",
            class: { id: classId, code: "INFO-A", name: "INFO-A" },
          },
          role: "monitor",
          status: "pending",
          source: "application",
        },
      ]);
      expect(JSON.stringify(body)).not.toContain("note");
    });

    it("counts the totals: upcoming is confirmed plus pending, and openLessons", async () => {
      const onePlace = await createLesson({ date: "2026-03-17", expectedMonitors: 1 });
      const fullForAna = await createLesson({ date: "2026-03-24" });
      await createLesson({ date: "2026-03-31", expectedMonitors: 2 });
      await assignDirect(ana, { role: "monitor", status: "confirmed" });
      await apply(ana, "monitor", onePlace);
      // A confirmed teacher and no monitors expected: no place for Ana.
      await assignDirect(bruno, { role: "teacher", status: "confirmed" }, fullForAna);

      const res = await getMine(ana).expect(200);

      expect((res.body as MyAssignmentsBody).totals).toEqual({
        upcoming: 2,
        confirmed: 1,
        pending: 1,
        openLessons: 1,
      });
    });

    it("shows a declined application and a cancelled assignment with their status, and counts neither", async () => {
      const other = await createLesson({ date: "2026-03-17", expectedMonitors: 2 });
      const declined = await apply(ana, "monitor", other);
      await reject(declined.id, coordinator).expect(200);
      const cancelled = await assignDirect(ana, { role: "monitor", status: "pending" });
      await cancelAssignment(cancelled.id).expect(200);

      const body = (await getMine(ana).expect(200)).body as MyAssignmentsBody;

      expect(body.items.map((item) => [item.lesson.id, item.id, item.status])).toEqual([
        [lessonId, cancelled.id, "cancelled"],
        [other, declined.id, "declined"],
      ]);
      // Neither keeps the lesson out of the ones with an open place for her.
      expect(body.totals).toEqual({ upcoming: 0, confirmed: 0, pending: 0, openLessons: 2 });
    });

    it("shows only the latest assignment of the member in a lesson: a new application after a declined one replaces it", async () => {
      const first = await apply(ana, "monitor");
      await reject(first.id, coordinator).expect(200);
      const second = await apply(ana, "teacher");

      const body = (await getMine(ana).expect(200)).body as MyAssignmentsBody;

      expect(body.items.map((item) => [item.id, item.role, item.status])).toEqual([
        [second.id, "teacher", "pending"],
      ]);
    });

    it("leaves out lessons outside the period, cancelled lessons and lessons of archived classes, while keeping completed and cancelled classes in items", async () => {
      const far = await createLesson({ date: "2026-04-20" });
      const cancelled = await createLesson({ date: "2026-03-17", expectedMonitors: 2 });
      const courseSec = await createCourse("Segurança Digital");
      const archivedClass = await createClassOf(courseSec, "SEG-B");
      const completedClass = await createClassOf(courseSec, "SEG-C");
      const cancelledClass = await createClassOf(courseSec, "SEG-D");
      const ofArchivedClass = await createLesson({
        classId: archivedClass,
        date: "2026-03-12",
        expectedMonitors: 2,
      });
      const ofCompletedClass = await createLesson({
        classId: completedClass,
        date: "2026-03-13",
        expectedMonitors: 2,
      });
      const ofCancelledClass = await createLesson({
        classId: cancelledClass,
        date: "2026-03-14",
        expectedMonitors: 2,
      });
      await apply(ana, "teacher", far);
      await apply(ana, "monitor", cancelled);
      await apply(ana, "monitor", ofArchivedClass);
      await apply(ana, "monitor", ofCompletedClass);
      await apply(ana, "monitor", ofCancelledClass);
      await apply(ana, "monitor", lessonId);
      await cancelLesson(cancelled);
      await classesService.archive(archivedClass, undefined, director.id);
      await classesService.update(completedClass, { status: ClassStatus.COMPLETED }, director.id);
      await classesService.update(cancelledClass, { status: ClassStatus.CANCELLED }, director.id);

      const body = (await getMine(ana).expect(200)).body as MyAssignmentsBody;

      expect(body.items.map((item) => item.lesson.id)).toEqual([
        lessonId,
        ofCompletedClass,
        ofCancelledClass,
      ]);
      expect(body.totals.pending).toBe(3);
      expect(body.totals.openLessons).toBe(0);
    });

    it("defaults to today and 27 days after it, and takes from and to", async () => {
      const lessonSeventeen = await createLesson({ date: "2026-03-17", expectedMonitors: 2 });
      await apply(ana, "monitor", lessonId);
      await apply(ana, "monitor", lessonSeventeen);

      const byDefault = (await getMine(ana).expect(200)).body as MyAssignmentsBody;
      const asked = (await getMine(ana, { from: "2026-03-15", to: "2026-03-20" }).expect(200))
        .body as MyAssignmentsBody;

      expect([byDefault.from, byDefault.to]).toEqual(["2026-03-09", "2026-04-05"]);
      expect(byDefault.items).toHaveLength(2);
      expect([asked.from, asked.to]).toEqual(["2026-03-15", "2026-03-20"]);
      expect(asked.items.map((item) => item.lesson.id)).toEqual([lessonSeventeen]);
    });

    it("answers 400 INVALID_DATE_RANGE for to before from and 400 DATE_RANGE_TOO_LONG over 42 days, with details.field to", async () => {
      const reversed = await getMine(ana, { from: "2026-03-10", to: "2026-03-09" }).expect(400);
      const toAlone = await getMine(ana, { to: "2026-03-08" }).expect(400);
      const tooLong = await getMine(ana, { from: "2026-03-01", to: "2026-04-12" }).expect(400);
      const malformed = await getMine(ana, { from: "2026-02-30" }).expect(400);

      expect(reversed.body.error).toBe("INVALID_DATE_RANGE");
      expect(toAlone.body.error).toBe("INVALID_DATE_RANGE");
      expect(tooLong.body.error).toBe("DATE_RANGE_TOO_LONG");
      for (const res of [reversed, toAlone, tooLong]) {
        expect(fieldsOf(res.body)).toEqual(["to"]);
      }
      expect(malformed.body.error).toBe("VALIDATION_FAILED");
      await getMine(ana, { from: "2026-03-01", to: "2026-04-11" }).expect(200);
    });

    it("shows only the assignments of the member of the session", async () => {
      const other = await createLesson({ date: "2026-03-17", expectedMonitors: 2 });
      await apply(ana, "monitor", lessonId);
      await apply(bruno, "monitor", other);

      const forAna = (await getMine(ana).expect(200)).body as MyAssignmentsBody;
      const forBruno = (await getMine(bruno).expect(200)).body as MyAssignmentsBody;

      expect(forAna.items.map((item) => item.lesson.id)).toEqual([lessonId]);
      expect(forBruno.items.map((item) => item.lesson.id)).toEqual([other]);
    });

    it("answers no item and every total at zero for a member without assignments", async () => {
      // The only lesson is cancelled: nothing will happen in the period.
      await cancelLesson(lessonId);

      const res = await getMine(carla).expect(200);

      expect(res.body).toEqual({
        from: "2026-03-09",
        to: "2026-04-05",
        totals: { upcoming: 0, confirmed: 0, pending: 0, openLessons: 0 },
        items: [],
      });
    });

    it("lets every profile read the own lessons, and answers 401 without a session", async () => {
      for (const actor of [director, coordinator, superadmin, diego]) {
        await getMine(actor).expect(200);
      }

      const res = await request(app.getHttpServer()).get("/me/assignments").expect(401);

      expect(res.body.error).toBe("UNAUTHORIZED");
    });
  });

  // ---------------------------------------------------------------------------
  // GET /me/open-lessons
  // ---------------------------------------------------------------------------

  describe("GET /me/open-lessons (listOpenLessons)", () => {
    it("lists the future lessons with an open place, with the coverage and the open roles", async () => {
      // The Figma: "Professor(a) 0 de 1 · Monitores 2 de 3", and "Monitores 0 de 2" when the
      // teacher is already confirmed.
      const twoOfThree = await createLesson({ date: "2026-03-17", expectedMonitors: 3 });
      const withTeacher = await createLesson({ date: "2026-03-24", expectedMonitors: 2 });
      await assignDirect(bruno, { role: "monitor", status: "confirmed" }, twoOfThree);
      await assignDirect(carla, { role: "monitor", status: "confirmed" }, twoOfThree);
      await assignDirect(diego, { role: "teacher", status: "confirmed" }, withTeacher);

      const res = await getOpen(ana).expect(200);
      const open = res.body as OpenLessonBody[];

      expect(open.map((item) => [item.lesson.id, item.coverage, item.openRoles])).toEqual([
        [
          lessonId,
          { teacher: { confirmed: 0, expected: 1 }, monitors: { confirmed: 0, expected: 2 } },
          ["teacher", "monitor"],
        ],
        [
          twoOfThree,
          { teacher: { confirmed: 0, expected: 1 }, monitors: { confirmed: 2, expected: 3 } },
          ["teacher", "monitor"],
        ],
        [
          withTeacher,
          { teacher: { confirmed: 1, expected: 1 }, monitors: { confirmed: 0, expected: 2 } },
          ["monitor"],
        ],
      ]);
      expect(open[0].lesson).toEqual({
        id: lessonId,
        title: "Teclado, mouse e janelas",
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        status: "planned",
        sequenceOrder: null,
        location: null,
        class: { id: classId, code: "INFO-A", name: "INFO-A" },
      });
    });

    it("leaves out lessons where the member holds a place, pending or confirmed", async () => {
      const assigned = await createLesson({ date: "2026-03-17", expectedMonitors: 2 });
      const free = await createLesson({ date: "2026-03-24", expectedMonitors: 2 });
      await apply(ana, "monitor", lessonId);
      await assignDirect(ana, { role: "monitor", status: "confirmed" }, assigned);

      const open = (await getOpen(ana).expect(200)).body as OpenLessonBody[];

      expect(open.map((item) => item.lesson.id)).toEqual([free]);
    });

    it("lists a lesson again after the member's application was declined", async () => {
      const application = await apply(ana);
      expect(((await getOpen(ana).expect(200)).body as OpenLessonBody[]).length).toBe(0);

      await reject(application.id, coordinator).expect(200);

      const open = (await getOpen(ana).expect(200)).body as OpenLessonBody[];
      expect(open.map((item) => item.lesson.id)).toEqual([lessonId]);
    });

    it("leaves out full lessons: a confirmed teacher and monitors at expected, or expectedMonitors null", async () => {
      const notInformed = await createLesson({ date: "2026-03-17" });
      const open24 = await createLesson({ date: "2026-03-24", expectedMonitors: 1 });
      await assignDirect(bruno, { role: "teacher", status: "confirmed" });
      await assignDirect(carla, { role: "monitor", status: "confirmed" });
      await assignDirect(diego, { role: "monitor", status: "confirmed" });
      await assignDirect(bruno, { role: "teacher", status: "confirmed" }, notInformed);

      const open = (await getOpen(ana).expect(200)).body as OpenLessonBody[];

      expect(open.map((item) => item.lesson.id)).toEqual([open24]);
    });

    it("keeps open a lesson that only has pending candidates", async () => {
      await apply(bruno, "teacher");
      await apply(carla, "monitor");

      const open = (await getOpen(ana).expect(200)).body as OpenLessonBody[];

      expect(open.map((item) => [item.lesson.id, item.openRoles, item.coverage])).toEqual([
        [
          lessonId,
          ["teacher", "monitor"],
          { teacher: { confirmed: 0, expected: 1 }, monitors: { confirmed: 0, expected: 2 } },
        ],
      ]);
    });

    it("leaves out past lessons even when from is before today, cancelled lessons and lessons of archived, completed or cancelled classes", async () => {
      await createLesson({ date: "2026-03-05", expectedMonitors: 2 });
      const today = await createLesson({ date: TODAY, expectedMonitors: 2 });
      const cancelled = await createLesson({ date: "2026-03-17", expectedMonitors: 2 });
      const courseSec = await createCourse("Segurança Digital");
      const inProgressClass = await createClassOf(courseSec, "SEG-IP");
      const archivedClass = await createClassOf(courseSec, "SEG-B");
      const completedClass = await createClassOf(courseSec, "SEG-C");
      const cancelledClass = await createClassOf(courseSec, "SEG-D");
      const ofInProgressClass = await createLesson({
        classId: inProgressClass,
        date: "2026-03-11",
        expectedMonitors: 2,
      });
      await createLesson({ classId: archivedClass, date: "2026-03-12", expectedMonitors: 2 });
      await createLesson({ classId: completedClass, date: "2026-03-13", expectedMonitors: 2 });
      await createLesson({ classId: cancelledClass, date: "2026-03-14", expectedMonitors: 2 });
      await cancelLesson(cancelled);
      await classesService.update(
        inProgressClass,
        { status: ClassStatus.IN_PROGRESS },
        director.id,
      );
      await classesService.archive(archivedClass, undefined, director.id);
      await classesService.update(completedClass, { status: ClassStatus.COMPLETED }, director.id);
      await classesService.update(cancelledClass, { status: ClassStatus.CANCELLED }, director.id);

      const res = await getOpen(ana, { from: "2026-03-01", to: "2026-03-31" }).expect(200);

      expect((res.body as OpenLessonBody[]).map((item) => item.lesson.id)).toEqual([
        today,
        lessonId,
        ofInProgressClass,
      ]);
    });

    it("agrees with applyToLesson: every open role listed is accepted, and a role not listed answers ROLE_FULL", async () => {
      const notInformed = await createLesson({ date: "2026-03-17" });
      const onePlace = await createLesson({ date: "2026-03-24", expectedMonitors: 1 });
      const bothOpen = await createLesson({ date: "2026-03-31", expectedMonitors: 2 });
      await assignDirect(bruno, { role: "teacher", status: "confirmed" });
      await assignDirect(carla, { role: "monitor", status: "confirmed" }, onePlace);

      const open = (await getOpen(ana).expect(200)).body as OpenLessonBody[];
      expect(open.map((item) => [item.lesson.id, item.openRoles])).toEqual([
        [lessonId, ["monitor"]],
        [notInformed, ["teacher"]],
        [onePlace, ["teacher"]],
        [bothOpen, ["teacher", "monitor"]],
      ]);

      for (const item of open) {
        for (const role of ["teacher", "monitor"].filter((r) => !item.openRoles.includes(r))) {
          const refused = await applyTo(item.lesson.id, ana, { role }).expect(409);
          expect(refused.body.error).toBe("ROLE_FULL");
        }
        // A pending application takes no place: a second applicant still finds the other role open.
        const applicants = [ana, diego];
        for (const [index, role] of item.openRoles.entries()) {
          await applyTo(item.lesson.id, applicants[index], { role }).expect(201);
        }
      }
    });

    it("has as many items as totals.openLessons of GET /me/assignments for the same period", async () => {
      await createLesson({ date: "2026-03-17", expectedMonitors: 1 });
      const full = await createLesson({ date: "2026-03-24" });
      await createLesson({ date: "2026-04-14", expectedMonitors: 2 });
      await assignDirect(bruno, { role: "teacher", status: "confirmed" }, full);
      await apply(ana, "monitor");

      const queries: Array<Record<string, string>> = [
        {},
        { from: "2026-03-01", to: "2026-04-11" },
        { from: "2026-03-20" },
      ];
      for (const query of queries) {
        const mine = (await getMine(ana, query).expect(200)).body as MyAssignmentsBody;
        const open = (await getOpen(ana, query).expect(200)).body as OpenLessonBody[];

        expect(open).toHaveLength(mine.totals.openLessons);
      }
    });

    it("answers 400 for a period that is not valid, and 401 without a session", async () => {
      const reversed = await getOpen(ana, { from: "2026-03-10", to: "2026-03-09" }).expect(400);
      const tooLong = await getOpen(ana, { from: "2026-03-01", to: "2026-04-12" }).expect(400);

      expect(reversed.body.error).toBe("INVALID_DATE_RANGE");
      expect(tooLong.body.error).toBe("DATE_RANGE_TOO_LONG");
      await request(app.getHttpServer()).get("/me/open-lessons").expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Acceptance criteria of the card
  // ---------------------------------------------------------------------------

  describe("acceptance criteria", () => {
    it("CA1: a member applies as monitor to a lesson with an open place and sees it pending in GET /me/assignments", async () => {
      const before = (await getOpen(ana).expect(200)).body as OpenLessonBody[];
      expect(before.map((item) => [item.lesson.id, item.openRoles])).toEqual([
        [lessonId, ["teacher", "monitor"]],
      ]);

      const application = await apply(ana, "monitor");

      const mine = (await getMine(ana).expect(200)).body as MyAssignmentsBody;
      expect(mine.items).toEqual([
        expect.objectContaining({
          id: application.id,
          role: "monitor",
          status: "pending",
          source: "application",
          lesson: expect.objectContaining({ id: lessonId }),
        }),
      ]);
      // "Aguardando confirmação" on the top of the screen.
      expect(mine.totals).toEqual({ upcoming: 1, confirmed: 0, pending: 1, openLessons: 0 });
      expect((await getOpen(ana).expect(200)).body).toEqual([]);
    });

    it("CA2: a director approves and the coverage of the lesson goes up; declining frees the place", async () => {
      const onePlace = await createLesson({ date: "2026-03-17", expectedMonitors: 1 });
      const first = await apply(ana, "monitor", onePlace);

      // Declining frees the place of the member: she can apply to the same lesson again.
      await reject(first.id, director).expect(200);
      const second = await apply(ana, "monitor", onePlace);
      expect(await coverageOf(onePlace)).toEqual({
        teacher: { confirmed: 0, expected: 1 },
        monitors: { confirmed: 0, expected: 1 },
      });

      await approve(second.id, director).expect(200);

      expect(await coverageOf(onePlace)).toEqual({
        teacher: { confirmed: 0, expected: 1 },
        monitors: { confirmed: 1, expected: 1 },
      });
    });

    it("CA3: answers 403 FORBIDDEN to a member on GET /applications, approve and reject", async () => {
      const application = await apply(ana);

      const list = await getPending(bruno).expect(403);
      const approval = await approve(application.id, bruno).expect(403);
      const decline = await reject(application.id, ana).expect(403);

      for (const res of [list, approval, decline]) {
        expect(res.body).toMatchObject({ statusCode: 403, error: "FORBIDDEN" });
      }
      expect((await storedAssignment(application.id)).status).toBe("pending");
    });
  });
});
