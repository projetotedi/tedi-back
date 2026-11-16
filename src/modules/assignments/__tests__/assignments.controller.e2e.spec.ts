/**
 * E2e spec for the assignments of the lessons — GUS-158 (nova alocação).
 *
 * CA1: a director assigns a member to a lesson (201); a member gets 403
 * CA2: a second role of the same member in the same lesson answers 409 DUPLICATE_ROLE_IN_LESSON
 * CA3: the coverage of the lesson follows a confirmation and a cancellation (lesson-coverage.e2e.spec.ts)
 *
 * Routes: POST /lessons/:id/assignments, GET /lessons/:id/assignments, PATCH /assignments/:id/confirm,
 * PATCH /assignments/:id/cancel and GET /members/:id/assignments.
 *
 * The scenery (the people, the course, the class and the lessons) comes from the services that the
 * other modules export, and a department and a member profile from the fixture of `people`, so the
 * test depends on their contract and not on their tables. Sessions are cookies signed with the
 * JwtService (no login). Two of the tests run two requests at the same time, so the app listens on a
 * port of its own, as in the e2e of the lessons.
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
import { LessonsService, LessonStatus } from "@modules/lessons/services/lessons.service";
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

process.env.JWT_SECRET = "e2e-assignments-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

const NOTE = "Cobre a segunda hora da aula.";

type CreateCourseInput = Parameters<CoursesService["create"]>[0];
type CreateLessonInput = Parameters<LessonsService["create"]>[0];

interface Actor {
  id: string;
  cookie: string;
}

interface Member {
  id: string;
  name: string;
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

interface MemberAssignmentBody extends Record<string, unknown> {
  id: string;
  lesson: {
    id: string;
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    status: string;
  };
  role: string;
  status: string;
  source: string;
  createdAt: string;
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

describe("Assignments (e2e)", () => {
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
  let directorTech: Actor;
  let directorComms: Actor;
  let coordinator: Actor;
  let member: Actor;
  let superadmin: Actor;

  /** Members of the department Tecnologia (approved profile), Comunicação, and with no profile at all. */
  let ana: Member;
  let bruno: Member;
  let carla: Member;
  let diego: Member;

  let tech: string;
  let comms: string;
  let classId: string;
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
    member = await createActor("Member", Role.MEMBER);
    superadmin = await createActor("Superadmin", Role.SUPERADMIN);
    // A director has the scope of the department of her APPROVED member profile: the one above has none.
    directorTech = await createActor("Director Tech", Role.DIRECTOR);
    await insertMemberProfile(dataSource, {
      personId: directorTech.id,
      status: "approved",
      departmentId: tech,
    });
    directorComms = await createActor("Director Comms", Role.DIRECTOR);
    await insertMemberProfile(dataSource, {
      personId: directorComms.id,
      status: "approved",
      departmentId: comms,
    });

    ana = await createMember("Ana Torres", tech);
    bruno = await createMember("Bruno Lima", tech);
    carla = await createMember("Carla Menezes", comms);
    diego = await createMember("Diego Rocha", null);

    const courseId = await createCourse("Informática Básica");
    classId = await createClassOf(courseId, "INFO-A");
    lessonId = await createLesson({ expectedMonitors: 2 });
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
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /** A member who can be assigned: a role, access, and (optionally) an approved profile in a department. */
  async function createMember(name: string, departmentId: string | null): Promise<Member> {
    const person = await peopleService.save({ name, role: Role.MEMBER, accessEnabled: true });
    if (departmentId !== null) {
      await insertMemberProfile(dataSource, {
        personId: person.id,
        status: "approved",
        departmentId,
      });
    }
    return { id: person.id, name };
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

  // ---------------------------------------------------------------------------
  // HTTP and database helpers
  // ---------------------------------------------------------------------------

  function postAssignment(forLessonId: string, actor: Actor, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/lessons/${forLessonId}/assignments`)
      .set("Cookie", actor.cookie)
      .send(payload);
  }

  function getLessonAssignments(forLessonId: string, actor: Actor) {
    return request(app.getHttpServer())
      .get(`/lessons/${forLessonId}/assignments`)
      .set("Cookie", actor.cookie);
  }

  function confirmAssignment(id: string, actor: Actor) {
    return request(app.getHttpServer())
      .patch(`/assignments/${id}/confirm`)
      .set("Cookie", actor.cookie);
  }

  function cancelAssignment(id: string, actor: Actor) {
    return request(app.getHttpServer())
      .patch(`/assignments/${id}/cancel`)
      .set("Cookie", actor.cookie);
  }

  function getMemberAssignments(personId: string, actor: Actor) {
    return request(app.getHttpServer())
      .get(`/members/${personId}/assignments`)
      .set("Cookie", actor.cookie);
  }

  /** Assigns a member through the route, and returns the assignment. */
  async function assign(
    who: Member,
    overrides: Record<string, unknown> = {},
    options: { actor?: Actor; lesson?: string } = {},
  ): Promise<AssignmentBody> {
    const res = await postAssignment(
      options.lesson ?? lessonId,
      options.actor ?? director,
      assignmentBody({ personId: who.id, ...overrides }),
    ).expect(201);
    return res.body as AssignmentBody;
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

  async function countConfirmedTeachers(forLessonId: string): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM lesson_assignments
        WHERE lesson_id = $1 AND role = 'teacher' AND status = 'confirmed'`,
      [forLessonId],
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
  async function holdRow(
    table: "lessons" | "people" | "lesson_assignments",
    id: string,
    lock: string,
  ) {
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

  // ---------------------------------------------------------------------------
  // POST /lessons/:id/assignments
  // ---------------------------------------------------------------------------

  describe("POST /lessons/:id/assignments (createAssignment)", () => {
    it("lets a director assign a member to a lesson (201)", async () => {
      const res = await postAssignment(
        lessonId,
        director,
        assignmentBody({ personId: ana.id, note: NOTE }),
      ).expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        lessonId,
        person: { id: ana.id, name: "Ana Torres" },
        role: "monitor",
        status: "pending",
        source: "direct",
        note: NOTE,
        createdById: director.id,
        reviewedById: null,
        reviewedAt: null,
        cancelledById: null,
        cancelledAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(await countAssignments()).toBe(1);
      expect(await storedAssignment(res.body.id)).toMatchObject({
        lesson_id: lessonId,
        person_id: ana.id,
        role: "monitor",
        status: "pending",
        source: "direct",
        note: NOTE,
        created_by_id: director.id,
        reviewed_by_id: null,
        reviewed_at: null,
        cancelled_by_id: null,
        cancelled_at: null,
        deleted_at: null,
      });
    });

    it("lets a coordinator and a superadmin assign (201)", async () => {
      const byCoordinator = await postAssignment(
        lessonId,
        coordinator,
        assignmentBody({ personId: ana.id }),
      ).expect(201);
      const bySuperadmin = await postAssignment(
        lessonId,
        superadmin,
        assignmentBody({ personId: bruno.id }),
      ).expect(201);

      expect(byCoordinator.body.createdById).toBe(coordinator.id);
      expect(bySuperadmin.body.createdById).toBe(superadmin.id);
    });

    it("answers 403 FORBIDDEN to a member on POST /lessons/:id/assignments", async () => {
      const res = await postAssignment(
        lessonId,
        member,
        assignmentBody({ personId: ana.id }),
      ).expect(403);

      expect(res.body).toMatchObject({ statusCode: 403, error: "FORBIDDEN" });
      expect(await countAssignments()).toBe(0);
    });

    it("answers 403 to a member before looking at the lesson or the body", async () => {
      await postAssignment("not-a-uuid", member, {}).expect(403);
      await postAssignment(UNKNOWN_ID, member, {}).expect(403);

      expect(await countAssignments()).toBe(0);
    });

    it("answers 401 without a session", async () => {
      await request(app.getHttpServer())
        .post(`/lessons/${lessonId}/assignments`)
        .send(assignmentBody({ personId: ana.id }))
        .expect(401);
    });

    it("creates a confirmed assignment with reviewedById and reviewedAt set", async () => {
      const res = await postAssignment(
        lessonId,
        coordinator,
        assignmentBody({ personId: ana.id, status: "confirmed" }),
      ).expect(201);

      expect(res.body).toMatchObject({
        status: "confirmed",
        source: "direct",
        createdById: coordinator.id,
        reviewedById: coordinator.id,
        reviewedAt: expect.any(String),
        cancelledAt: null,
      });
      const stored = await storedAssignment(res.body.id);
      expect(stored).toMatchObject({ status: "confirmed", reviewed_by_id: coordinator.id });
      expect(stored.reviewed_at).toBeInstanceOf(Date);
      // Who made it confirmed is who decided it, in the same instant.
      expect(Math.abs(new Date(res.body.reviewedAt).getTime() - Date.now())).toBeLessThan(60_000);
    });

    it("creates a pending assignment with reviewedAt null", async () => {
      const res = await postAssignment(
        lessonId,
        coordinator,
        assignmentBody({ personId: ana.id, status: "pending" }),
      ).expect(201);

      expect(res.body).toMatchObject({
        status: "pending",
        reviewedById: null,
        reviewedAt: null,
      });
      expect(await storedAssignment(res.body.id)).toMatchObject({
        status: "pending",
        reviewed_by_id: null,
        reviewed_at: null,
      });
    });

    it("creates a teacher and a monitor, each with the role it was asked", async () => {
      const teacher = await assign(ana, { role: "teacher" });
      const monitor = await assign(bruno, { role: "monitor" });

      expect(teacher.role).toBe("teacher");
      expect(monitor.role).toBe("monitor");
    });

    it("trims the note, and stores null for a blank or a missing one", async () => {
      const trimmed = await assign(ana, { note: "  Cobre a segunda hora.  " });
      const blank = await assign(bruno, { note: "   " });
      const missing = await assign(carla);

      expect(trimmed.note).toBe("Cobre a segunda hora.");
      expect(blank.note).toBeNull();
      expect(missing.note).toBeNull();
    });

    it("ignores a source in the body: an assignment made here is always direct", async () => {
      const res = await postAssignment(
        lessonId,
        director,
        assignmentBody({ personId: ana.id, source: "application" }),
      ).expect(201);

      expect(res.body.source).toBe("direct");
      expect(await storedAssignment(res.body.id)).toMatchObject({ source: "direct" });
    });

    it("assigns a member with no member profile (the accounts that predate the registration) and one with an approved profile", async () => {
      await assign(diego);
      await assign(ana);

      expect(await countAssignments()).toBe(2);
    });

    it("lists it in GET /lessons/:id/assignments with the person name", async () => {
      const created = await assign(ana, { role: "teacher", status: "confirmed" });

      const res = await getLessonAssignments(lessonId, director).expect(200);

      expect(res.body).toEqual([created]);
      expect(res.body[0].person).toEqual({ id: ana.id, name: "Ana Torres" });
    });

    describe("validation", () => {
      it.each(["declined", "cancelled"])(
        "answers 400 VALIDATION_FAILED on status for %s: it only comes from a decision about an assignment",
        async (status) => {
          const res = await postAssignment(
            lessonId,
            director,
            assignmentBody({ personId: ana.id, status }),
          ).expect(400);

          expect(res.body.error).toBe("VALIDATION_FAILED");
          expect(fieldsOf(res.body)).toEqual(["status"]);
          expect(await countAssignments()).toBe(0);
        },
      );

      it("answers 400 VALIDATION_FAILED without a status: there is no default", async () => {
        const res = await postAssignment(lessonId, director, {
          personId: ana.id,
          role: "monitor",
        }).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["status"]);
      });

      it("answers 400 VALIDATION_FAILED for an empty body, naming every field", async () => {
        const res = await postAssignment(lessonId, director, {}).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["personId", "role", "status"]);
      });

      it("answers 400 VALIDATION_FAILED for a personId that is not a UUID and a role that is not teacher or monitor", async () => {
        const badId = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: "not-a-uuid" }),
        ).expect(400);
        const badRole = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: ana.id, role: "student" }),
        ).expect(400);

        expect(fieldsOf(badId.body)).toEqual(["personId"]);
        expect(fieldsOf(badRole.body)).toEqual(["role"]);
      });

      it("answers 400 VALIDATION_FAILED for a note over 500 characters, and accepts exactly 500", async () => {
        const over = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: ana.id, note: "x".repeat(501) }),
        ).expect(400);
        const exact = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: ana.id, note: "x".repeat(500) }),
        ).expect(201);

        expect(fieldsOf(over.body)).toEqual(["note"]);
        expect(exact.body.note).toHaveLength(500);
      });
    });

    describe("the lesson", () => {
      it("answers 404 LESSON_NOT_FOUND for an unknown or malformed lesson id", async () => {
        for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
          const res = await postAssignment(
            id,
            director,
            assignmentBody({ personId: ana.id }),
          ).expect(404);

          expect(res.body).toEqual({
            statusCode: 404,
            error: "LESSON_NOT_FOUND",
            message: "Lesson not found.",
          });
        }
        expect(await countAssignments()).toBe(0);
      });

      it("answers 409 LESSON_CANCELLED on a cancelled lesson", async () => {
        await lessonsService.cancel(lessonId, { reason: "Feriado." }, director.id);

        const res = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: ana.id }),
        ).expect(409);

        expect(res.body).toEqual({
          statusCode: 409,
          error: "LESSON_CANCELLED",
          message: "Cancelled lessons cannot receive assignments.",
        });
        expect(await countAssignments()).toBe(0);
      });

      it("assigns a member to a confirmed lesson and to a done one: only a cancelled lesson is refused", async () => {
        const confirmedLesson = await createLesson({ date: "2026-03-17" });
        await lessonsService.update(
          confirmedLesson,
          { status: LessonStatus.CONFIRMED },
          director.id,
        );
        const doneLesson = await createLesson({ date: "2026-03-03" });
        await lessonsService.update(doneLesson, { status: LessonStatus.DONE }, director.id);

        await assign(ana, {}, { lesson: confirmedLesson });
        await assign(ana, {}, { lesson: doneLesson });

        expect(await countAssignments()).toBe(2);
      });
    });

    describe("the member", () => {
      it("answers 400 MEMBER_NOT_FOUND with details.field personId for a personId that is not a member", async () => {
        const student = await peopleService.save({ name: "Aluno Qualquer" });

        for (const personId of [UNKNOWN_ID, student.id]) {
          const res = await postAssignment(lessonId, director, assignmentBody({ personId })).expect(
            400,
          );

          expect(res.body).toMatchObject({
            statusCode: 400,
            error: "MEMBER_NOT_FOUND",
            message: "Member not found.",
            details: [{ field: "personId", message: "personId does not match any member" }],
          });
        }
        expect(await countAssignments()).toBe(0);
      });

      it("answers 409 MEMBER_INACTIVE for a person with access disabled", async () => {
        const disabled = await peopleService.save({
          name: "Sem Acesso",
          role: Role.MEMBER,
          accessEnabled: false,
        });

        const res = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: disabled.id }),
        ).expect(409);

        expect(res.body).toEqual({
          statusCode: 409,
          error: "MEMBER_INACTIVE",
          message: "Inactive members cannot receive assignments.",
        });
        expect(await countAssignments()).toBe(0);
      });

      it("answers 409 MEMBER_INACTIVE for a pending registration, and for a rejected one", async () => {
        for (const status of ["pending", "rejected"] as const) {
          const applicant = await peopleService.save({
            name: `Cadastro ${status}`,
            role: null,
            accessEnabled: false,
          });
          await insertMemberProfile(dataSource, { personId: applicant.id, status });

          const res = await postAssignment(
            lessonId,
            director,
            assignmentBody({ personId: applicant.id }),
          ).expect(409);

          expect(res.body.error).toBe("MEMBER_INACTIVE");
        }
        expect(await countAssignments()).toBe(0);
      });

      it("answers 409 MEMBER_INACTIVE, not MEMBER_NOT_FOUND, for a member whose access was disabled after the approval", async () => {
        await dataSource.query(`UPDATE people SET access_enabled = false WHERE id = $1`, [ana.id]);

        const res = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: ana.id }),
        ).expect(409);

        expect(res.body.error).toBe("MEMBER_INACTIVE");
      });
    });

    describe("one place per member (RN-01)", () => {
      it("answers 409 DUPLICATE_ROLE_IN_LESSON for a second role of the same member in the lesson", async () => {
        await assign(ana, { role: "monitor" });

        const res = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: ana.id, role: "teacher" }),
        ).expect(409);

        expect(res.body).toEqual({
          statusCode: 409,
          error: "DUPLICATE_ROLE_IN_LESSON",
          message: "The member already has an active assignment in this lesson.",
        });
        expect(await countAssignments()).toBe(1);
      });

      it("answers 409 DUPLICATE_ROLE_IN_LESSON for the same role twice", async () => {
        await assign(ana, { role: "monitor" });

        const res = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: ana.id, role: "monitor" }),
        ).expect(409);

        expect(res.body.error).toBe("DUPLICATE_ROLE_IN_LESSON");
      });

      it("answers 409 DUPLICATE_ROLE_IN_LESSON whether the first one is pending or confirmed", async () => {
        await assign(ana, { role: "monitor", status: "confirmed" });
        const confirmed = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: ana.id, role: "teacher", status: "pending" }),
        ).expect(409);

        await assign(bruno, { role: "monitor", status: "pending" });
        const pending = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: bruno.id, role: "teacher", status: "confirmed" }),
        ).expect(409);

        expect(confirmed.body.error).toBe("DUPLICATE_ROLE_IN_LESSON");
        expect(pending.body.error).toBe("DUPLICATE_ROLE_IN_LESSON");
      });

      it("lets the same member hold a place in two different lessons", async () => {
        const otherLesson = await createLesson({ date: "2026-03-17" });

        await assign(ana);
        await assign(ana, {}, { lesson: otherLesson });

        expect(await countAssignments()).toBe(2);
      });

      it("lets the member be assigned again after the assignment is cancelled", async () => {
        const first = await assign(ana, { role: "monitor" });
        await cancelAssignment(first.id, director).expect(200);

        const second = await assign(ana, { role: "teacher" });

        expect(second.id).not.toBe(first.id);
        expect(await countAssignments()).toBe(2);
        expect(await storedAssignment(first.id)).toMatchObject({ status: "cancelled" });
        expect(await storedAssignment(second.id)).toMatchObject({
          status: "pending",
          role: "teacher",
        });
      });

      it("lets the member be assigned again after a declined application", async () => {
        await insertAssignment(dataSource, {
          lessonId,
          personId: ana.id,
          createdById: ana.id,
          status: "declined",
          source: "application",
          reviewedById: coordinator.id,
          reviewedAt: new Date(),
        });

        await assign(ana);

        expect(await countAssignments()).toBe(2);
      });

      it("keeps one assignment when the same member is assigned twice at the same time", async () => {
        const [first, second] = await Promise.all([
          postAssignment(lessonId, director, assignmentBody({ personId: ana.id, role: "monitor" })),
          postAssignment(
            lessonId,
            coordinator,
            assignmentBody({ personId: ana.id, role: "teacher" }),
          ),
        ]);

        expect([first.status, second.status].sort()).toEqual([201, 409]);
        const refused = first.status === 409 ? first : second;
        expect(refused.body.error).toBe("DUPLICATE_ROLE_IN_LESSON");
        expect(await countAssignments()).toBe(1);
      });
    });

    describe("one confirmed teacher per lesson (RN-02)", () => {
      it("answers 409 LESSON_TEACHER_TAKEN for a second confirmed teacher", async () => {
        await assign(ana, { role: "teacher", status: "confirmed" });

        const res = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: bruno.id, role: "teacher", status: "confirmed" }),
        ).expect(409);

        expect(res.body).toEqual({
          statusCode: 409,
          error: "LESSON_TEACHER_TAKEN",
          message: "The lesson already has a confirmed teacher.",
        });
        expect(await countAssignments()).toBe(1);
      });

      it("accepts a second pending teacher: it is a candidate, not the teacher", async () => {
        await assign(ana, { role: "teacher", status: "confirmed" });

        const second = await assign(bruno, { role: "teacher", status: "pending" });
        const third = await assign(carla, { role: "teacher", status: "pending" });

        expect(second.status).toBe("pending");
        expect(third.status).toBe("pending");
        expect(await countConfirmedTeachers(lessonId)).toBe(1);
      });

      it("accepts confirmed monitors next to the confirmed teacher, and a confirmed teacher in another lesson", async () => {
        const otherLesson = await createLesson({ date: "2026-03-17" });
        await assign(ana, { role: "teacher", status: "confirmed" });

        await assign(bruno, { role: "monitor", status: "confirmed" });
        await assign(carla, { role: "monitor", status: "confirmed" });
        await assign(diego, { role: "teacher", status: "confirmed" }, { lesson: otherLesson });

        expect(await countAssignments()).toBe(4);
      });

      it("accepts a confirmed teacher after the previous one was cancelled", async () => {
        const first = await assign(ana, { role: "teacher", status: "confirmed" });
        await cancelAssignment(first.id, director).expect(200);

        const second = await assign(bruno, { role: "teacher", status: "confirmed" });

        expect(second.status).toBe("confirmed");
        expect(await countConfirmedTeachers(lessonId)).toBe(1);
      });

      it("keeps one confirmed teacher when two are created at the same time", async () => {
        const [first, second] = await Promise.all([
          postAssignment(
            lessonId,
            director,
            assignmentBody({ personId: ana.id, role: "teacher", status: "confirmed" }),
          ),
          postAssignment(
            lessonId,
            coordinator,
            assignmentBody({ personId: bruno.id, role: "teacher", status: "confirmed" }),
          ),
        ]);

        expect([first.status, second.status].sort()).toEqual([201, 409]);
        const refused = first.status === 409 ? first : second;
        expect(refused.body.error).toBe("LESSON_TEACHER_TAKEN");
        expect(await countConfirmedTeachers(lessonId)).toBe(1);
        expect(await countAssignments()).toBe(1);
      });
    });

    describe("events", () => {
      it("emits LESSON_ASSIGNMENT_CREATED once, after the commit, without the note", async () => {
        const events = collectEvents();

        const res = await postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: ana.id, note: NOTE }),
        ).expect(201);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          actorId: director.id,
          action: AuditableAction.LESSON_ASSIGNMENT_CREATED,
          targetType: "lesson_assignment",
          targetId: res.body.id,
          before: null,
          after: {
            lessonId,
            personId: ana.id,
            role: "monitor",
            status: "pending",
            source: "direct",
          },
        });
        expect(JSON.stringify(events[0])).not.toContain(NOTE);
      });

      it("emits nothing for a request that is refused", async () => {
        await assign(ana);
        const events = collectEvents();

        await postAssignment(lessonId, member, assignmentBody({ personId: bruno.id })).expect(403);
        await postAssignment(lessonId, director, assignmentBody({ personId: ana.id })).expect(409);
        await postAssignment(lessonId, director, assignmentBody({ personId: UNKNOWN_ID })).expect(
          400,
        );
        await postAssignment(UNKNOWN_ID, director, assignmentBody({ personId: bruno.id })).expect(
          404,
        );
        await postAssignment(lessonId, director, {}).expect(400);

        expect(events).toHaveLength(0);
      });
    });

    describe("locks", () => {
      it("does not wait for another assignment being made in the same lesson: shared locks do not conflict", async () => {
        // Another assignment holds the lesson FOR SHARE, as POST does for the whole transaction.
        const holder = await holdRow("lessons", lessonId, "FOR SHARE");

        try {
          // If this one asked for FOR UPDATE it would wait for the holder, and never answer.
          const res = await postAssignment(
            lessonId,
            director,
            assignmentBody({ personId: ana.id }),
          ).expect(201);
          expect(res.body.lessonId).toBe(lessonId);
        } finally {
          await holder.release();
        }
      });

      it("waits for a cancellation of the lesson that is in flight, and then answers 409 LESSON_CANCELLED", async () => {
        // A cancellation (or an edit) holds the lesson FOR UPDATE until it commits.
        const cancellation = await holdRow("lessons", lessonId, "FOR UPDATE");

        const pending = postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: ana.id }),
        ).then((res) => res);

        try {
          expect(await blockedStatement()).toMatch(/"Lesson"/);
          // It is not made while the lesson can still change under it.
          expect(await countAssignments()).toBe(0);
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
        expect(await countAssignments()).toBe(0);
      });

      it("waits for a change of access of the member that is in flight, and then answers 409 MEMBER_INACTIVE", async () => {
        // Disabling the access (AccessService) holds the person FOR UPDATE until it commits.
        const change = await holdRow("people", ana.id, "FOR UPDATE");

        const pending = postAssignment(
          lessonId,
          director,
          assignmentBody({ personId: ana.id }),
        ).then((res) => res);

        try {
          expect(await blockedStatement()).toMatch(/"Person"/);
          expect(await countAssignments()).toBe(0);
          await change.run(`UPDATE people SET access_enabled = false WHERE id = $1`, [ana.id]);
        } finally {
          await change.release();
        }

        const res = await pending;
        expect(res.status).toBe(409);
        expect(res.body.error).toBe("MEMBER_INACTIVE");
        expect(await countAssignments()).toBe(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /lessons/:id/assignments
  // ---------------------------------------------------------------------------

  describe("GET /lessons/:id/assignments (listLessonAssignments)", () => {
    it("answers an empty list for a lesson with nobody assigned", async () => {
      const res = await getLessonAssignments(lessonId, director).expect(200);

      expect(res.body).toEqual([]);
    });

    it("lets every profile read it: member, director, coordinator and superadmin", async () => {
      const created = await assign(ana);

      for (const actor of [member, director, coordinator, superadmin]) {
        const res = await getLessonAssignments(lessonId, actor).expect(200);

        expect(res.body).toEqual([created]);
      }
    });

    it("answers 401 without a session", async () => {
      await request(app.getHttpServer()).get(`/lessons/${lessonId}/assignments`).expect(401);
    });

    it("answers 404 LESSON_NOT_FOUND for an unknown or malformed lesson id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await getLessonAssignments(id, director).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "LESSON_NOT_FOUND",
          message: "Lesson not found.",
        });
      }
    });

    it("lists every status, ordered by role (the teacher first), then status in the order of the enum", async () => {
      // Created in an order that is not the order they come back in.
      await assign(ana, { role: "monitor", status: "pending" });
      const monitorToCancel = await assign(bruno, { role: "monitor", status: "confirmed" });
      await cancelAssignment(monitorToCancel.id, director).expect(200);
      await assign(carla, { role: "monitor", status: "confirmed" });
      await assign(diego, { role: "teacher", status: "confirmed" });
      const declined = await createMember("Eva Prado", null);
      await insertAssignment(dataSource, {
        lessonId,
        personId: declined.id,
        createdById: declined.id,
        role: "teacher",
        status: "declined",
        source: "application",
        reviewedById: coordinator.id,
        reviewedAt: new Date(),
      });

      const res = await getLessonAssignments(lessonId, director).expect(200);

      expect(
        (res.body as AssignmentBody[]).map((item) => [item.person?.name, item.role, item.status]),
      ).toEqual([
        ["Diego Rocha", "teacher", "confirmed"],
        ["Eva Prado", "teacher", "declined"],
        ["Ana Torres", "monitor", "pending"],
        ["Carla Menezes", "monitor", "confirmed"],
        ["Bruno Lima", "monitor", "cancelled"],
      ]);
    });

    it("lists only the assignments of this lesson", async () => {
      const otherLesson = await createLesson({ date: "2026-03-17" });
      await assign(ana);
      await assign(bruno, {}, { lesson: otherLesson });

      const res = await getLessonAssignments(lessonId, director).expect(200);

      expect((res.body as AssignmentBody[]).map((item) => item.person?.name)).toEqual([
        "Ana Torres",
      ]);
    });

    it("shows the note of each assignment, and null for the ones without", async () => {
      await assign(ana, { note: NOTE });
      await assign(bruno);

      const res = await getLessonAssignments(lessonId, member).expect(200);

      expect(
        (res.body as AssignmentBody[]).map((item) => [item.person?.name, item.note]).sort(),
      ).toEqual([
        ["Ana Torres", NOTE],
        ["Bruno Lima", null],
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /assignments/:id/confirm
  // ---------------------------------------------------------------------------

  describe("PATCH /assignments/:id/confirm (confirmAssignment)", () => {
    it("confirms a pending assignment (200, status confirmed, reviewedById and reviewedAt set)", async () => {
      const created = await assign(ana, { note: NOTE });
      expect(created.reviewedAt).toBeNull();

      const res = await confirmAssignment(created.id, coordinator).expect(200);

      expect(res.body).toEqual({
        ...created,
        status: "confirmed",
        reviewedById: coordinator.id,
        reviewedAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      // The instant of the confirmation is the one of the update.
      expect(res.body.reviewedAt).toBe(res.body.updatedAt);
      expect(await storedAssignment(created.id)).toMatchObject({
        status: "confirmed",
        reviewed_by_id: coordinator.id,
        // What the confirmation does not touch stays as it was.
        note: NOTE,
        created_by_id: director.id,
        cancelled_at: null,
      });
    });

    it("lets a director and a superadmin confirm, and answers 403 FORBIDDEN to a member", async () => {
      const first = await assign(ana);
      const second = await assign(bruno);

      await confirmAssignment(first.id, director).expect(200);
      await confirmAssignment(second.id, superadmin).expect(200);
      const forbidden = await confirmAssignment(first.id, member).expect(403);

      expect(forbidden.body).toMatchObject({ statusCode: 403, error: "FORBIDDEN" });
    });

    it("answers 200 without writing when the assignment is already confirmed, and keeps who confirmed it first", async () => {
      const created = await assign(ana, { status: "confirmed" });
      const before = await storedAssignment(created.id);
      const events = collectEvents();

      const res = await confirmAssignment(created.id, coordinator).expect(200);

      expect(res.body.status).toBe("confirmed");
      expect(res.body.reviewedById).toBe(director.id);
      expect(res.body.reviewedAt).toBe(created.reviewedAt);
      expect(await storedAssignment(created.id)).toEqual(before);
      expect(events).toHaveLength(0);
    });

    it("answers 404 ASSIGNMENT_NOT_FOUND for an unknown or malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await confirmAssignment(id, director).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "ASSIGNMENT_NOT_FOUND",
          message: "Assignment not found.",
        });
      }
    });

    it("answers 409 ASSIGNMENT_NOT_PENDING for a declined assignment and for a cancelled one", async () => {
      const declinedId = await insertAssignment(dataSource, {
        lessonId,
        personId: ana.id,
        createdById: ana.id,
        status: "declined",
        source: "application",
        reviewedById: coordinator.id,
        reviewedAt: new Date(),
      });
      const cancelled = await assign(bruno);
      await cancelAssignment(cancelled.id, director).expect(200);

      for (const id of [declinedId, cancelled.id]) {
        const res = await confirmAssignment(id, director).expect(409);

        expect(res.body).toEqual({
          statusCode: 409,
          error: "ASSIGNMENT_NOT_PENDING",
          message: "Only a pending assignment can be confirmed.",
        });
      }
    });

    it("answers 409 LESSON_CANCELLED when the lesson was cancelled while the assignment waited", async () => {
      const created = await assign(ana);
      await lessonsService.cancel(lessonId, { reason: "Feriado." }, director.id);

      const res = await confirmAssignment(created.id, director).expect(409);

      expect(res.body.error).toBe("LESSON_CANCELLED");
      expect(await storedAssignment(created.id)).toMatchObject({ status: "pending" });
    });

    it("answers 409 MEMBER_INACTIVE when the member lost her access while the assignment waited", async () => {
      const created = await assign(ana);
      await dataSource.query(`UPDATE people SET access_enabled = false WHERE id = $1`, [ana.id]);

      const res = await confirmAssignment(created.id, director).expect(409);

      expect(res.body.error).toBe("MEMBER_INACTIVE");
      expect(await storedAssignment(created.id)).toMatchObject({ status: "pending" });
    });

    it("answers 409 LESSON_TEACHER_TAKEN when confirming a pending teacher while another is confirmed", async () => {
      await assign(ana, { role: "teacher", status: "confirmed" });
      const candidate = await assign(bruno, { role: "teacher", status: "pending" });

      const res = await confirmAssignment(candidate.id, director).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        error: "LESSON_TEACHER_TAKEN",
        message: "The lesson already has a confirmed teacher.",
      });
      expect(await storedAssignment(candidate.id)).toMatchObject({ status: "pending" });
      expect(await countConfirmedTeachers(lessonId)).toBe(1);
    });

    it("confirms a pending teacher once the confirmed one was cancelled", async () => {
      const teacher = await assign(ana, { role: "teacher", status: "confirmed" });
      const candidate = await assign(bruno, { role: "teacher", status: "pending" });
      await cancelAssignment(teacher.id, director).expect(200);

      const res = await confirmAssignment(candidate.id, director).expect(200);

      expect(res.body.status).toBe("confirmed");
      expect(await countConfirmedTeachers(lessonId)).toBe(1);
    });

    it("confirms a pending monitor whatever the teacher", async () => {
      await assign(ana, { role: "teacher", status: "confirmed" });
      const monitor = await assign(bruno, { role: "monitor", status: "pending" });

      await confirmAssignment(monitor.id, director).expect(200);
    });

    it("keeps one confirmed teacher when two pending teachers are confirmed at the same time", async () => {
      const first = await assign(ana, { role: "teacher", status: "pending" });
      const second = await assign(bruno, { role: "teacher", status: "pending" });

      const [one, other] = await Promise.all([
        confirmAssignment(first.id, director),
        confirmAssignment(second.id, coordinator),
      ]);

      expect([one.status, other.status].sort()).toEqual([200, 409]);
      const refused = one.status === 409 ? one : other;
      expect(refused.body.error).toBe("LESSON_TEACHER_TAKEN");
      expect(await countConfirmedTeachers(lessonId)).toBe(1);
    });

    it("confirms once when two requests confirm at the same time: both answer 200 and one event goes out", async () => {
      const created = await assign(ana);
      const events = collectEvents();

      const [one, other] = await Promise.all([
        confirmAssignment(created.id, director),
        confirmAssignment(created.id, coordinator),
      ]);

      expect([one.status, other.status]).toEqual([200, 200]);
      const stored = await storedAssignment(created.id);
      // Whoever came second finds it confirmed and answers what the first one wrote.
      expect(one.body.reviewedById).toBe(stored.reviewed_by_id);
      expect(other.body.reviewedById).toBe(stored.reviewed_by_id);
      expect(
        events.filter((event) => event.action === AuditableAction.LESSON_ASSIGNMENT_CONFIRMED),
      ).toHaveLength(1);
    });

    it("emits LESSON_ASSIGNMENT_CONFIRMED once, after the commit, without the note", async () => {
      const created = await assign(ana, { note: NOTE });
      const events = collectEvents();

      await confirmAssignment(created.id, coordinator).expect(200);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: coordinator.id,
        action: AuditableAction.LESSON_ASSIGNMENT_CONFIRMED,
        targetType: "lesson_assignment",
        targetId: created.id,
        before: { status: "pending" },
        after: { status: "confirmed", lessonId, personId: ana.id, role: "monitor" },
      });
      expect(JSON.stringify(events[0])).not.toContain(NOTE);
    });

    it("emits nothing for a request that is refused", async () => {
      const created = await assign(ana);
      await cancelAssignment(created.id, director).expect(200);
      const events = collectEvents();

      // It is cancelled now, so it cannot be confirmed (409), and the others are 404 and 403.
      await confirmAssignment(created.id, director).expect(409);
      await confirmAssignment(UNKNOWN_ID, director).expect(404);
      await confirmAssignment(created.id, member).expect(403);

      expect(events).toHaveLength(0);
    });

    it("waits for a cancellation of the lesson that is in flight, and then answers 409 LESSON_CANCELLED", async () => {
      const created = await assign(ana);
      const cancellation = await holdRow("lessons", lessonId, "FOR UPDATE");

      const pending = confirmAssignment(created.id, director).then((res) => res);

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
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /assignments/:id/cancel
  // ---------------------------------------------------------------------------

  describe("PATCH /assignments/:id/cancel (cancelAssignment)", () => {
    it("cancels an assignment (200, status cancelled, cancelledAt and cancelledById set)", async () => {
      const created = await assign(ana, { note: NOTE });

      const res = await cancelAssignment(created.id, coordinator).expect(200);

      expect(res.body).toEqual({
        ...created,
        status: "cancelled",
        cancelledById: coordinator.id,
        cancelledAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      // The instant of the cancellation is the one of the update.
      expect(res.body.cancelledAt).toBe(res.body.updatedAt);
      // The row stays: nothing is deleted.
      expect(await countAssignments()).toBe(1);
      expect(await storedAssignment(created.id)).toMatchObject({
        status: "cancelled",
        cancelled_by_id: coordinator.id,
        note: NOTE,
        deleted_at: null,
      });
    });

    it("cancels a confirmed assignment and keeps who confirmed it next to who cancelled it", async () => {
      const created = await assign(ana, { role: "teacher", status: "confirmed" });

      const res = await cancelAssignment(created.id, coordinator).expect(200);

      expect(res.body).toMatchObject({
        status: "cancelled",
        reviewedById: director.id,
        reviewedAt: created.reviewedAt,
        cancelledById: coordinator.id,
      });
    });

    it("lets a director and a superadmin cancel, and answers 403 FORBIDDEN to a member", async () => {
      const first = await assign(ana);
      const second = await assign(bruno);

      await cancelAssignment(first.id, director).expect(200);
      await cancelAssignment(second.id, superadmin).expect(200);
      const third = await assign(carla);
      const forbidden = await cancelAssignment(third.id, member).expect(403);

      expect(forbidden.body).toMatchObject({ statusCode: 403, error: "FORBIDDEN" });
      expect(await storedAssignment(third.id)).toMatchObject({ status: "pending" });
    });

    it("answers 200 without writing when the assignment is already cancelled, and keeps the first instant", async () => {
      const created = await assign(ana);
      const first = await cancelAssignment(created.id, director).expect(200);
      const before = await storedAssignment(created.id);
      const events = collectEvents();

      const res = await cancelAssignment(created.id, coordinator).expect(200);

      expect(res.body.status).toBe("cancelled");
      expect(res.body.cancelledById).toBe(director.id);
      expect(res.body.cancelledAt).toBe(first.body.cancelledAt);
      expect(await storedAssignment(created.id)).toEqual(before);
      expect(events).toHaveLength(0);
    });

    it("answers 404 ASSIGNMENT_NOT_FOUND for an unknown or malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await cancelAssignment(id, director).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "ASSIGNMENT_NOT_FOUND",
          message: "Assignment not found.",
        });
      }
    });

    it("answers 409 ASSIGNMENT_NOT_ACTIVE for a declined assignment", async () => {
      const declinedId = await insertAssignment(dataSource, {
        lessonId,
        personId: ana.id,
        createdById: ana.id,
        status: "declined",
        source: "application",
        reviewedById: coordinator.id,
        reviewedAt: new Date(),
      });

      const res = await cancelAssignment(declinedId, director).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        error: "ASSIGNMENT_NOT_ACTIVE",
        message: "Only a pending or confirmed assignment can be cancelled.",
      });
      expect(await storedAssignment(declinedId)).toMatchObject({ status: "declined" });
    });

    it("cancels an assignment of a cancelled lesson: cancelling a lesson does not cancel its assignments", async () => {
      const created = await assign(ana, { status: "confirmed" });
      await lessonsService.cancel(lessonId, { reason: "Feriado." }, director.id);
      expect(await storedAssignment(created.id)).toMatchObject({ status: "confirmed" });

      const res = await cancelAssignment(created.id, director).expect(200);

      expect(res.body.status).toBe("cancelled");
    });

    it("cancels an assignment of a member whose access was disabled", async () => {
      const created = await assign(ana, { status: "confirmed" });
      await dataSource.query(`UPDATE people SET access_enabled = false WHERE id = $1`, [ana.id]);

      const res = await cancelAssignment(created.id, director).expect(200);

      expect(res.body.status).toBe("cancelled");
    });

    it("cancels once when two requests cancel at the same time: both answer 200 and one event goes out", async () => {
      const created = await assign(ana);
      const events = collectEvents();

      const [one, other] = await Promise.all([
        cancelAssignment(created.id, director),
        cancelAssignment(created.id, coordinator),
      ]);

      expect([one.status, other.status]).toEqual([200, 200]);
      const stored = await storedAssignment(created.id);
      // Whoever came second finds it cancelled and answers what the first one wrote.
      expect(one.body.cancelledById).toBe(stored.cancelled_by_id);
      expect(other.body.cancelledById).toBe(stored.cancelled_by_id);
      expect(
        events.filter((event) => event.action === AuditableAction.LESSON_ASSIGNMENT_CANCELLED),
      ).toHaveLength(1);
    });

    it("waits for whoever holds the row of the assignment and then cancels it", async () => {
      const created = await assign(ana);
      const holder = await holdRow("lesson_assignments", created.id, "FOR UPDATE");

      const pending = cancelAssignment(created.id, director).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/"LessonAssignment"/);
      } finally {
        await holder.release();
      }

      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("cancelled");
    });

    it("emits LESSON_ASSIGNMENT_CANCELLED once, after the commit, without the note", async () => {
      const created = await assign(ana, { note: NOTE, status: "confirmed" });
      const events = collectEvents();

      await cancelAssignment(created.id, coordinator).expect(200);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: coordinator.id,
        action: AuditableAction.LESSON_ASSIGNMENT_CANCELLED,
        targetType: "lesson_assignment",
        targetId: created.id,
        before: { status: "confirmed" },
        after: { status: "cancelled", lessonId, personId: ana.id, role: "monitor" },
      });
      expect(JSON.stringify(events[0])).not.toContain(NOTE);
    });

    it("emits nothing for a request that is refused", async () => {
      const created = await assign(ana);
      const events = collectEvents();

      await cancelAssignment(UNKNOWN_ID, director).expect(404);
      await cancelAssignment(created.id, member).expect(403);

      expect(events).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /members/:id/assignments
  // ---------------------------------------------------------------------------

  describe("GET /members/:id/assignments (listMemberAssignments)", () => {
    it("lists the assignments of a member with the lesson, the latest lesson first", async () => {
      const early = await createLesson({ title: "Primeira", date: "2026-03-10" });
      const late = await createLesson({ title: "Terceira", date: "2026-03-24" });
      const middle = await createLesson({ title: "Segunda", date: "2026-03-17" });
      const first = await assign(ana, { role: "monitor" }, { lesson: early });
      const third = await assign(ana, { role: "teacher", status: "confirmed" }, { lesson: late });
      const second = await assign(ana, { role: "monitor" }, { lesson: middle });

      const res = await getMemberAssignments(ana.id, coordinator).expect(200);

      expect(res.body).toEqual([
        {
          id: third.id,
          lesson: {
            id: late,
            title: "Terceira",
            date: "2026-03-24",
            startTime: "14:00",
            endTime: "15:30",
            status: "planned",
          },
          role: "teacher",
          status: "confirmed",
          source: "direct",
          createdAt: expect.any(String),
        },
        expect.objectContaining({
          id: second.id,
          lesson: expect.objectContaining({ title: "Segunda" }),
        }),
        expect.objectContaining({
          id: first.id,
          lesson: expect.objectContaining({ title: "Primeira" }),
        }),
      ]);
    });

    it("orders the lessons of the same day by start time, latest first", async () => {
      const morning = await createLesson({ title: "Manhã", startTime: "08:00", endTime: "09:30" });
      const afternoon = await createLesson({
        title: "Tarde",
        startTime: "14:00",
        endTime: "15:30",
      });
      const evening = await createLesson({ title: "Noite", startTime: "19:00", endTime: "20:30" });
      await assign(ana, {}, { lesson: morning });
      await assign(ana, {}, { lesson: evening });
      await assign(ana, {}, { lesson: afternoon });

      const res = await getMemberAssignments(ana.id, coordinator).expect(200);

      expect((res.body as MemberAssignmentBody[]).map((item) => item.lesson.title)).toEqual([
        "Noite",
        "Tarde",
        "Manhã",
      ]);
    });

    it("lists every status of the member, the cancelled and the declined ones too, and only hers", async () => {
      const cancelledLesson = await createLesson({
        title: "Cancelada pela alocação",
        date: "2026-03-17",
      });
      const declinedLesson = await createLesson({ title: "Recusada", date: "2026-03-24" });
      const cancelled = await assign(ana, {}, { lesson: cancelledLesson });
      await cancelAssignment(cancelled.id, director).expect(200);
      await insertAssignment(dataSource, {
        lessonId: declinedLesson,
        personId: ana.id,
        createdById: ana.id,
        status: "declined",
        source: "application",
        reviewedById: coordinator.id,
        reviewedAt: new Date(),
      });
      await assign(ana, { status: "confirmed" });
      await assign(bruno);

      const res = await getMemberAssignments(ana.id, coordinator).expect(200);

      expect((res.body as MemberAssignmentBody[]).map((item) => item.status)).toEqual([
        "declined",
        "cancelled",
        "confirmed",
      ]);
      expect(
        (res.body as MemberAssignmentBody[]).find((item) => item.status === "declined")?.source,
      ).toBe("application");
    });

    it("shows a lesson that was cancelled afterwards with its status", async () => {
      await assign(ana, { status: "confirmed" });
      await lessonsService.cancel(lessonId, { reason: "Feriado." }, director.id);

      const res = await getMemberAssignments(ana.id, coordinator).expect(200);

      expect((res.body as MemberAssignmentBody[])[0].lesson.status).toBe("cancelled");
    });

    it("answers an empty list for a member with no assignment", async () => {
      const res = await getMemberAssignments(ana.id, coordinator).expect(200);

      expect(res.body).toEqual([]);
    });

    it("answers 200 for a pending registration, with an empty list: it is a member row of GET /members", async () => {
      const applicant = await peopleService.save({
        name: "Cadastro pendente",
        role: null,
        accessEnabled: false,
      });
      await insertMemberProfile(dataSource, { personId: applicant.id, status: "pending" });

      const res = await getMemberAssignments(applicant.id, coordinator).expect(200);

      expect(res.body).toEqual([]);
    });

    it("answers 404 MEMBER_NOT_FOUND for an unknown id, a malformed id and a person that is not a member", async () => {
      const student = await peopleService.save({ name: "Aluno Qualquer" });

      for (const id of [UNKNOWN_ID, "not-a-uuid", student.id]) {
        const res = await getMemberAssignments(id, coordinator).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "MEMBER_NOT_FOUND",
          message: "Member not found.",
        });
      }
    });

    it("answers 404 before the scope: a director asking for an unknown member gets 404, not 403", async () => {
      await getMemberAssignments(UNKNOWN_ID, directorTech).expect(404);
    });

    it("answers 401 without a session", async () => {
      await request(app.getHttpServer()).get(`/members/${ana.id}/assignments`).expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe("permissions", () => {
    const FORBIDDEN_SCOPE_BODY = {
      statusCode: 403,
      error: "FORBIDDEN_SCOPE",
      message: "You do not have access to this resource.",
    };

    it("answers 403 FORBIDDEN to a member on the three routes that write and on GET /members/:id/assignments", async () => {
      const created = await assign(ana);
      const responses = [
        await postAssignment(lessonId, member, assignmentBody({ personId: bruno.id })),
        await confirmAssignment(created.id, member),
        await cancelAssignment(created.id, member),
        await getMemberAssignments(ana.id, member),
      ];

      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ statusCode: 403, error: "FORBIDDEN" });
      }
      // Nothing was written, and the assignment is as it was.
      expect(await countAssignments()).toBe(1);
      expect(await storedAssignment(created.id)).toMatchObject({ status: "pending" });
    });

    it("answers 200 to a member on GET /lessons/:id/assignments: every profile reads who is assigned", async () => {
      await assign(ana);

      const res = await getLessonAssignments(lessonId, member).expect(200);

      expect(res.body).toHaveLength(1);
    });

    it("lets the director, the coordinator and the superadmin write: assignments.create is theirs", async () => {
      for (const [actor, who] of [
        [director, ana],
        [coordinator, bruno],
        [superadmin, carla],
      ] as const) {
        const created = await assign(who, {}, { actor });
        await confirmAssignment(created.id, actor).expect(200);
        await cancelAssignment(created.id, actor).expect(200);
      }
    });

    it("lets coordination and the superadmin read the assignments of a member of any department", async () => {
      for (const who of [ana, carla, diego]) {
        await getMemberAssignments(who.id, coordinator).expect(200);
        await getMemberAssignments(who.id, superadmin).expect(200);
      }
    });

    it("lets a director read the assignments of a member of the own department", async () => {
      await assign(ana);

      const res = await getMemberAssignments(ana.id, directorTech).expect(200);

      expect(res.body).toHaveLength(1);
      await getMemberAssignments(carla.id, directorComms).expect(200);
    });

    it("answers 403 FORBIDDEN_SCOPE to a director on a member of another department", async () => {
      await assign(ana);

      const res = await getMemberAssignments(ana.id, directorComms).expect(403);

      expect(res.body).toEqual(FORBIDDEN_SCOPE_BODY);
      await getMemberAssignments(carla.id, directorTech).expect(403);
    });

    it("answers 403 FORBIDDEN_SCOPE to a director on a member without a department", async () => {
      const res = await getMemberAssignments(diego.id, directorTech).expect(403);

      expect(res.body).toEqual(FORBIDDEN_SCOPE_BODY);
    });

    it("answers 403 FORBIDDEN_SCOPE to a director without a department, even on the own assignments", async () => {
      // The department scope of a director without a department is empty: it covers nobody, herself
      // included (the own data of a member is another route, GUS-160).
      const others = await getMemberAssignments(ana.id, director).expect(403);
      const own = await getMemberAssignments(director.id, director).expect(403);

      expect(others.body).toEqual(FORBIDDEN_SCOPE_BODY);
      expect(own.body).toEqual(FORBIDDEN_SCOPE_BODY);
    });

    it("lets a director with a department assign, confirm and cancel too: assignments.create has scope all for a director", async () => {
      const created = await assign(carla, {}, { actor: directorTech });

      await confirmAssignment(created.id, directorTech).expect(200);
      await cancelAssignment(created.id, directorTech).expect(200);
    });
  });
});
