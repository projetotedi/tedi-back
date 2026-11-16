/**
 * E2e spec for the applications of the members — GUS-160 (candidatura e aprovação).
 *
 * Routes: POST /lessons/:id/applications.
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
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
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
import {
  assignmentBody,
  CLASS_PERIOD,
  insertAssignment,
  insertDepartment,
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

    it("answers 409 LESSON_IN_PAST for a lesson before today, and accepts a lesson of today", async () => {
      const past = await createLesson({ date: "2026-03-05", expectedMonitors: 2 });
      const today = await createLesson({ date: TODAY, expectedMonitors: 2 });

      const res = await applyTo(past, ana, { role: "monitor" }).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        error: "LESSON_IN_PAST",
        message: "Applications are only taken for lessons from today on.",
      });
      await applyTo(today, ana, { role: "monitor" }).expect(201);
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
});
