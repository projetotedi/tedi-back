/**
 * E2e spec for the cancellation of a lesson and its assignments — GUS-179.
 *
 * CA1: cancelling the lesson leaves every assignment of it cancelled
 * CA2: its pending applications become expired and leave the queue
 * CA3: the coverage of the cancelled lesson no longer counts those members
 *
 * The flow crosses two modules: `PATCH /lessons/:id/cancel` is a route of `lessons`, and what it does
 * to the assignments is `assignments`, through the port of the cancellation
 * (`LessonCancellationRegistry`), in the same transaction. So the test lives here, in the module
 * that reacts (docs/ARCHITECTURE.md section 5), and boots both.
 *
 * The clock of the app is fixed at 2026-03-09 12:00 in São Paulo, so the lesson of the scenery
 * (2026-03-10) is still ahead and its applications are pending until the lesson is cancelled. The
 * scenery comes from the services that the other modules export. Sessions are cookies signed with
 * the JwtService (no login).
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
import { assignmentBody, CLASS_PERIOD, lessonBody } from "./fixtures/assignments.fixture";

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

process.env.JWT_SECRET = "e2e-lesson-cancelled-assignments-secret";

const SESSION_COOKIE_NAME = "tedi_session";

/** 12:00 in São Paulo on 2026-03-09: the "now" of every service of the app. */
const NOW = new Date("2026-03-09T15:00:00.000Z");

const NOTE = "Saio mais cedo por causa do tratamento.";

type CreateCourseInput = Parameters<CoursesService["create"]>[0];
type CreateLessonInput = Parameters<LessonsService["create"]>[0];

interface Actor {
  id: string;
  cookie: string;
}

interface AssignmentBody {
  id: string;
  status: string;
  statusReason: string | null;
}

interface StoredAssignment {
  status: string;
  status_reason: string | null;
  cancelled_by_id: string | null;
  cancelled_at: Date | null;
  reviewed_by_id: string | null;
  reviewed_at: Date | null;
  updated_at: Date;
}

describe("cancelling a lesson ends its assignments (e2e)", () => {
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

  let ana: Actor;
  let bruno: Actor;
  let carla: Actor;
  let diego: Actor;
  let elisa: Actor;
  let classId: string;
  /** The lesson of the scenery: 2026-03-10, two monitors expected. */
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
      .overrideProvider(Clock)
      .useValue({ now: () => new Date(NOW) })
      .compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    // init() runs onModuleInit: the handler of the cancellation registers itself here.
    await app.init();
    // One server for the suite: a test below runs a request while another transaction holds a row.
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
    await dataSource.query(
      `TRUNCATE TABLE lesson_assignments, lessons, classes, editions, course_lesson_plans,
                      lesson_plan_contents, lesson_plans, course_prerequisites, courses, people
       RESTART IDENTITY CASCADE`,
    );

    director = await createActor("Director", Role.DIRECTOR);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);

    ana = await createActor("Ana Torres", Role.MEMBER);
    bruno = await createActor("Bruno Lima", Role.MEMBER);
    carla = await createActor("Carla Menezes", Role.MEMBER);
    diego = await createActor("Diego Rocha", Role.MEMBER);
    elisa = await createActor("Elisa Prado", Role.MEMBER);

    const course = await coursesService.create(
      {
        name: "Informática Básica",
        description: "Fundamentos do uso do computador.",
        category: "basic",
      } as unknown as CreateCourseInput,
      director.id,
    );
    const schoolClass = await classesService.create(
      {
        courseId: course.id,
        code: "INFO-A",
        editionName: "2026.1",
        ...CLASS_PERIOD,
        capacity: 15,
      },
      director.id,
    );
    classId = schoolClass.id;
    const lesson = await lessonsService.create(
      lessonBody({
        classId,
        date: "2026-03-10",
        expectedMonitors: 2,
      }) as unknown as CreateLessonInput,
      director.id,
    );
    lessonId = lesson.id;
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
  });

  // ---------------------------------------------------------------------------
  // Scenery and helpers
  // ---------------------------------------------------------------------------

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /** A direct assignment of the GUS-158, made by the director. */
  async function assign(
    who: Actor,
    role: "teacher" | "monitor",
    status: "pending" | "confirmed",
  ): Promise<AssignmentBody> {
    const res = await request(app.getHttpServer())
      .post(`/lessons/${lessonId}/assignments`)
      .set("Cookie", director.cookie)
      .send(assignmentBody({ personId: who.id, role, status, note: NOTE }))
      .expect(201);
    return res.body as AssignmentBody;
  }

  /** The member applies through the route of the GUS-160. */
  async function apply(who: Actor, role: "teacher" | "monitor"): Promise<AssignmentBody> {
    const res = await request(app.getHttpServer())
      .post(`/lessons/${lessonId}/applications`)
      .set("Cookie", who.cookie)
      .send({ role, note: NOTE })
      .expect(201);
    return res.body as AssignmentBody;
  }

  /** The scenery of the card: every kind of assignment a lesson can have. */
  async function staffTheLesson() {
    const teacher = await assign(ana, "teacher", "confirmed");
    const pendingDirect = await assign(bruno, "monitor", "pending");
    const application = await apply(carla, "monitor");
    const approved = await apply(diego, "monitor");
    await request(app.getHttpServer())
      .patch(`/applications/${approved.id}/approve`)
      .set("Cookie", coordinator.cookie)
      .expect(200);
    const declined = await apply(elisa, "monitor");
    await request(app.getHttpServer())
      .patch(`/applications/${declined.id}/reject`)
      .set("Cookie", coordinator.cookie)
      .expect(200);

    return { teacher, pendingDirect, application, approved, declined };
  }

  function cancelLesson(actor: Actor = coordinator) {
    return request(app.getHttpServer())
      .patch(`/lessons/${lessonId}/cancel`)
      .set("Cookie", actor.cookie)
      .send({ reason: "Feriado municipal." });
  }

  function getPending() {
    return request(app.getHttpServer())
      .get("/applications")
      .query({ status: "pending" })
      .set("Cookie", coordinator.cookie)
      .expect(200);
  }

  async function stored(id: string): Promise<StoredAssignment> {
    const rows: StoredAssignment[] = await dataSource.query(
      `SELECT status, status_reason, cancelled_by_id, cancelled_at, reviewed_by_id, reviewed_at,
              updated_at
         FROM lesson_assignments WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  async function cancelledAtOfLesson(): Promise<Date> {
    const rows: Array<{ cancelled_at: Date }> = await dataSource.query(
      `SELECT cancelled_at FROM lessons WHERE id = $1`,
      [lessonId],
    );
    return rows[0].cancelled_at;
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  /** The text of a statement that is waiting for a lock, or undefined after 3 seconds. */
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

  // ---------------------------------------------------------------------------
  // The card
  // ---------------------------------------------------------------------------

  it("cancels the confirmed and the pending assignments and expires the pending applications, with the reason (CA1, CA2)", async () => {
    const { teacher, pendingDirect, application, approved, declined } = await staffTheLesson();

    await cancelLesson().expect(200);

    const cancelledAt = await cancelledAtOfLesson();
    for (const { id } of [teacher, pendingDirect, approved]) {
      expect(await stored(id)).toMatchObject({
        status: "cancelled",
        status_reason: "lesson_cancelled",
        cancelled_by_id: coordinator.id,
        cancelled_at: cancelledAt,
        updated_at: cancelledAt,
      });
    }
    // Nobody decided it: no reviewer, and none of the cancelled_* that the CHECK ties to cancelled.
    expect(await stored(application.id)).toMatchObject({
      status: "expired",
      status_reason: "lesson_cancelled",
      cancelled_by_id: null,
      cancelled_at: null,
      reviewed_by_id: null,
      reviewed_at: null,
      updated_at: cancelledAt,
    });
    // An approved application keeps who approved it, next to who cancelled it.
    expect(await stored(approved.id)).toMatchObject({ reviewed_by_id: coordinator.id });
    // What had already ended stays as it was.
    expect(await stored(declined.id)).toMatchObject({ status: "declined", status_reason: null });
  });

  it("takes the pending applications of the lesson out of the queue (CA2)", async () => {
    await staffTheLesson();
    expect((await getPending()).body.total).toBe(1);

    await cancelLesson().expect(200);

    expect((await getPending()).body).toEqual({ total: 0, lessons: [] });
  });

  it("answers the cancelled lesson with nobody in its coverage, and the detail, the list and the calendar agree (CA3)", async () => {
    await staffTheLesson();

    const res = await cancelLesson().expect(200);

    const nobody = {
      teacher: { confirmed: 0, expected: 1 },
      monitors: { confirmed: 0, expected: 2 },
    };
    expect(res.body).toMatchObject({
      status: "cancelled",
      coverage: nobody,
      belowExpectedMonitors: false,
    });
    const detail = await request(app.getHttpServer())
      .get(`/lessons/${lessonId}`)
      .set("Cookie", coordinator.cookie)
      .expect(200);
    expect(detail.body.coverage).toEqual(nobody);
    const list = await request(app.getHttpServer())
      .get("/lessons")
      .query({ limit: 100 })
      .set("Cookie", coordinator.cookie)
      .expect(200);
    const calendar = await request(app.getHttpServer())
      .get("/lessons/calendar")
      .query({ from: "2026-03-01", to: "2026-04-11" })
      .set("Cookie", coordinator.cookie)
      .expect(200);
    for (const items of [list.body.data, calendar.body] as Array<
      Array<{ id: string; teacher: unknown }>
    >) {
      expect(items.find((item) => item.id === lessonId)?.teacher).toBeNull();
    }
  });

  it("shows every assignment of the lesson and of the member with the reason (the history of the member)", async () => {
    const { teacher, application } = await staffTheLesson();

    await cancelLesson().expect(200);

    const ofLesson = await request(app.getHttpServer())
      .get(`/lessons/${lessonId}/assignments`)
      .set("Cookie", coordinator.cookie)
      .expect(200);
    expect(
      (ofLesson.body as AssignmentBody[]).find((item) => item.id === application.id),
    ).toMatchObject({ status: "expired", statusReason: "lesson_cancelled" });
    expect(
      (ofLesson.body as AssignmentBody[]).find((item) => item.id === teacher.id),
    ).toMatchObject({ status: "cancelled", statusReason: "lesson_cancelled" });

    const history = await request(app.getHttpServer())
      .get(`/members/${carla.id}/assignments`)
      .set("Cookie", coordinator.cookie)
      .expect(200);
    expect(history.body).toEqual([
      expect.objectContaining({
        id: application.id,
        lesson: expect.objectContaining({ status: "cancelled" }),
        status: "expired",
        statusReason: "lesson_cancelled",
      }),
    ]);
  });

  it("emits LESSON_CANCELLED and then one event per assignment it ended, with who cancelled and without the note", async () => {
    const { teacher, pendingDirect, application, approved } = await staffTheLesson();
    const events = collectEvents();

    await cancelLesson().expect(200);

    expect(events.map((event) => [event.action, event.targetId])).toEqual([
      [AuditableAction.LESSON_CANCELLED, lessonId],
      ...[teacher, pendingDirect, application, approved].map((assignment) => [
        assignment.id === application.id
          ? AuditableAction.LESSON_ASSIGNMENT_EXPIRED
          : AuditableAction.LESSON_ASSIGNMENT_CANCELLED,
        assignment.id,
      ]),
    ]);
    expect(events.every((event) => event.actorId === coordinator.id)).toBe(true);
    expect(events.find((event) => event.targetId === application.id)).toMatchObject({
      targetType: "lesson_assignment",
      before: { status: "pending" },
      after: {
        status: "expired",
        lessonId,
        personId: carla.id,
        role: "monitor",
        statusReason: "lesson_cancelled",
      },
    });
    expect(JSON.stringify(events)).not.toContain("tratamento");
  });

  it("ends nothing and emits nothing more when the lesson is cancelled again", async () => {
    const { teacher } = await staffTheLesson();
    await cancelLesson().expect(200);
    const before = await stored(teacher.id);
    const events = collectEvents();

    await cancelLesson(director).expect(200);

    expect(await stored(teacher.id)).toEqual(before);
    expect(events).toEqual([]);
  });

  it("ends the assignments of a lesson cancelled before GUS-179 when it is cancelled again", async () => {
    const teacher = await assign(ana, "teacher", "confirmed");
    const application = await apply(carla, "monitor");
    // Cancelled straight in the table, as before this card: the assignments were left as they were.
    await dataSource.query(
      `UPDATE lessons SET status = 'cancelled', cancel_reason = 'Feriado.', cancelled_at = now(),
              cancelled_by_id = $2
        WHERE id = $1`,
      [lessonId, director.id],
    );
    const events = collectEvents();

    const res = await cancelLesson().expect(200);

    expect(res.body.coverage.teacher.confirmed).toBe(0);
    expect(await stored(teacher.id)).toMatchObject({
      status: "cancelled",
      status_reason: "lesson_cancelled",
      cancelled_by_id: coordinator.id,
    });
    expect(await stored(application.id)).toMatchObject({ status: "expired" });
    // The lesson was already cancelled: only the assignments are new in the audit trail.
    expect(events.map((event) => event.action)).toEqual([
      AuditableAction.LESSON_ASSIGNMENT_CANCELLED,
      AuditableAction.LESSON_ASSIGNMENT_EXPIRED,
    ]);
  });

  it("changes no assignment when the cancellation is refused: the class is archived", async () => {
    const { teacher, application } = await staffTheLesson();
    await dataSource.query(`UPDATE classes SET archived_at = now() WHERE id = $1`, [classId]);
    const events = collectEvents();

    const res = await cancelLesson().expect(409);

    expect(res.body.error).toBe("CLASS_ARCHIVED");
    expect(await stored(teacher.id)).toMatchObject({ status: "confirmed", status_reason: null });
    expect(await stored(application.id)).toMatchObject({ status: "pending", status_reason: null });
    expect(events).toEqual([]);
  });

  it("holds the assignments before the lesson: it waits for an assignment locked FOR UPDATE with the lesson still free", async () => {
    const application = await apply(carla, "monitor");
    // What an approval in flight holds before it asks for the lesson.
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(`SELECT id FROM lesson_assignments WHERE id = $1 FOR UPDATE`, [
      application.id,
    ]);

    const cancelling = cancelLesson().then((res) => res);
    try {
      expect(await blockedStatement()).toMatch(/LessonAssignment/);
      // The cancellation has not locked the lesson yet, so the approval could take it FOR SHARE.
      await holder.query(`SELECT id FROM lessons WHERE id = $1 FOR SHARE NOWAIT`, [lessonId]);
    } finally {
      await holder.commitTransaction();
      await holder.release();
    }

    expect((await cancelling).status).toBe(200);
    expect(await stored(application.id)).toMatchObject({ status: "expired" });
  });
});
