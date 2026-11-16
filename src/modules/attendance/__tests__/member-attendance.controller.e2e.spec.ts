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
import { AssignmentsModule } from "@modules/assignments/assignments.module";
import { AuthModule } from "@modules/auth/auth.module";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { CoursesService } from "@modules/catalog/services/courses.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
import { HoursModule } from "@modules/hours/hours.module";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { LessonsService } from "@modules/lessons/services/lessons.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { AttendanceModule } from "../attendance.module";
import {
  CLASS_PERIOD,
  insertAssignment,
  insertDepartment,
  insertLesson,
  insertMemberProfile,
  lessonBody,
  waitFor,
} from "./fixtures/attendance.fixture";

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

process.env.JWT_SECRET = "e2e-attendance-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

type CreateCourseInput = Parameters<CoursesService["create"]>[0];
type CreateLessonInput = Parameters<LessonsService["create"]>[0];

interface Actor {
  id: string;
  cookie: string;
}

interface MemberAttendanceBody {
  assignmentId: string;
  person: { id: string; name: string } | null;
  role: string;
  status: string | null;
  confirmedBy: { id: string; name: string } | null;
  confirmedAt: string | null;
  hourEntryId: string | null;
}

interface HourEntryRow {
  id: string;
  person_id: string;
  created_by_id: string;
  origin: string;
  activity: string;
  category: string;
  date: string;
  declared_minutes: number;
  validated_minutes: number | null;
  notes: string | null;
  status: string;
  review_note: string | null;
  reviewed_by_id: string | null;
  reviewed_at: Date | null;
  class_id: string | null;
  lesson_id: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

/**
 * The routes of the attendance of the members (GUS-168), through HTTP to Postgres: the scenery is a
 * lesson of 2026-03-10 from 14:00 to 15:30 (90 minutes) with a confirmed teacher and two confirmed
 * monitors, all members of the department Tecnologia, made through the services and the fixtures
 * the other modules export. The cookies are signed by the JwtService (no login). Two requests run
 * at the same time in one test, so the app listens on a port of its own.
 */
describe("member attendance routes (e2e)", () => {
  let module: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonsService: LessonsService;

  let tech: string;
  let coordinator: Actor;
  let director: Actor;
  let teacher: Actor;
  let monitor: Actor;
  let otherMonitor: Actor;

  let classId: string;
  let lessonId: string;
  let teacherAssignment: string;
  let monitorAssignment: string;
  let otherMonitorAssignment: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          // Every entity: the foreign keys of MemberAttendance point to other modules' tables by name.
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
        HoursModule,
        AttendanceModule,
      ],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
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
      `TRUNCATE TABLE member_attendance, hour_entry_events, hour_entries, lesson_assignments,
                      lessons, classes, editions, course_lesson_plans, lesson_plan_contents,
                      lesson_plans, course_prerequisites, courses, invites, departments, people
       RESTART IDENTITY CASCADE`,
    );

    tech = await insertDepartment(dataSource, "Tecnologia");

    coordinator = await createActor("Coordinator", Role.COORDINATOR, null);
    director = await createActor("Director Tech", Role.DIRECTOR, tech);
    teacher = await createActor("Teacher", Role.MEMBER, tech);
    monitor = await createActor("Monitor", Role.MEMBER, tech);
    otherMonitor = await createActor("Other Monitor", Role.MEMBER, tech);

    const course = await coursesService.create(
      {
        name: "Informática Básica",
        description: "Fundamentos do uso do computador.",
        category: "basic",
      } as unknown as CreateCourseInput,
      coordinator.id,
    );
    const schoolClass = await classesService.create(
      {
        courseId: course.id,
        code: "INFO-A",
        editionName: "2026.1",
        ...CLASS_PERIOD,
        capacity: 15,
      },
      coordinator.id,
    );
    classId = schoolClass.id;
    lessonId = await createLesson();

    teacherAssignment = await confirmedAssignment(lessonId, teacher, "teacher");
    monitorAssignment = await confirmedAssignment(lessonId, monitor, "monitor");
    otherMonitorAssignment = await confirmedAssignment(lessonId, otherMonitor, "monitor");
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
  });

  // ---------------------------------------------------------------------------
  // Scenery
  // ---------------------------------------------------------------------------

  /** A person with an access role and, with a department, an approved member profile in it. */
  async function createActor(
    name: string,
    role: Role,
    departmentId: string | null,
  ): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    if (departmentId !== null) {
      await insertMemberProfile(dataSource, {
        personId: person.id,
        status: "approved",
        departmentId,
      });
    }
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /** "Teclado, mouse e janelas" on 2026-03-10, from 14:00 to 15:30, unless `overrides` says otherwise. */
  async function createLesson(overrides: Record<string, unknown> = {}): Promise<string> {
    const lesson = await lessonsService.create(
      lessonBody({ classId, ...overrides }) as unknown as CreateLessonInput,
      coordinator.id,
    );
    return lesson.id;
  }

  function confirmedAssignment(
    forLessonId: string,
    who: Actor,
    role: "teacher" | "monitor",
  ): Promise<string> {
    return insertAssignment(dataSource, {
      lessonId: forLessonId,
      personId: who.id,
      createdById: coordinator.id,
      role,
      status: "confirmed",
      reviewedById: coordinator.id,
      reviewedAt: new Date("2026-03-09T12:00:00.000Z"),
    });
  }

  // ---------------------------------------------------------------------------
  // HTTP and database helpers
  // ---------------------------------------------------------------------------

  function putAttendance(
    actor: Actor,
    entries: Array<{ assignmentId: string; status: string }>,
    forLessonId = lessonId,
  ) {
    return request(app.getHttpServer())
      .put(`/lessons/${forLessonId}/attendance/members`)
      .set("Cookie", actor.cookie)
      .send({ entries });
  }

  function getAttendance(actor: Actor, forLessonId = lessonId) {
    return request(app.getHttpServer())
      .get(`/lessons/${forLessonId}/attendance/members`)
      .set("Cookie", actor.cookie);
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  /** Every hour entry of a lesson, removed included, in the order of the ids. */
  function entriesOf(forLessonId: string): Promise<HourEntryRow[]> {
    return dataSource.query(
      `SELECT id, person_id, created_by_id, origin, activity, category, date::text AS date,
              declared_minutes, validated_minutes, notes, status, review_note, reviewed_by_id,
              reviewed_at, class_id, lesson_id, created_at, deleted_at
         FROM hour_entries WHERE lesson_id = $1 ORDER BY id`,
      [forLessonId],
    );
  }

  async function activeEntriesOf(forLessonId: string): Promise<HourEntryRow[]> {
    return (await entriesOf(forLessonId)).filter((row) => row.deleted_at === null);
  }

  async function historyOf(hourEntryId: string): Promise<Array<Record<string, unknown>>> {
    return dataSource.query(
      `SELECT type, actor_id, from_status, to_status, from_minutes, to_minutes
         FROM hour_entry_events WHERE hour_entry_id = $1 ORDER BY created_at, id`,
      [hourEntryId],
    );
  }

  async function attendanceRows(): Promise<Array<Record<string, unknown>>> {
    return dataSource.query(
      `SELECT assignment_id, person_id, status, confirmed_by_id, hour_entry_id
         FROM member_attendance ORDER BY person_id`,
    );
  }

  function itemOf(body: MemberAttendanceBody[], assignmentId: string): MemberAttendanceBody {
    const item = body.find((candidate) => candidate.assignmentId === assignmentId);
    if (item === undefined) throw new Error(`The assignment ${assignmentId} is not in the list.`);
    return item;
  }

  // ---------------------------------------------------------------------------
  // PUT /lessons/:id/attendance/members
  // ---------------------------------------------------------------------------

  describe("PUT /lessons/:id/attendance/members", () => {
    it("lets the teacher of the lesson confirm a monitor present, and the monitor gets 90 approved minutes of lesson hours from the attendance", async () => {
      const res = await putAttendance(teacher, [
        { assignmentId: monitorAssignment, status: "present" },
      ]).expect(200);

      const entries = await entriesOf(lessonId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        person_id: monitor.id,
        created_by_id: teacher.id,
        origin: "attendance",
        activity: "Teclado, mouse e janelas",
        category: "lesson",
        date: "2026-03-10",
        declared_minutes: 90,
        validated_minutes: 90,
        notes: null,
        status: "approved",
        review_note: null,
        reviewed_by_id: teacher.id,
        class_id: classId,
        lesson_id: lessonId,
        deleted_at: null,
      });
      expect(entries[0].reviewed_at).toEqual(entries[0].created_at);

      const item = itemOf(res.body as MemberAttendanceBody[], monitorAssignment);
      expect(item).toMatchObject({
        person: { id: monitor.id, name: "Monitor" },
        role: "monitor",
        status: "present",
        confirmedBy: { id: teacher.id, name: "Teacher" },
        hourEntryId: entries[0].id,
      });
    });

    it("records created and approved in the history of the entry and emits MEMBER_ATTENDANCE_CONFIRMED, HOUR_ENTRY_CREATED and HOUR_ENTRY_APPROVED", async () => {
      const events = collectEvents();

      await putAttendance(teacher, [{ assignmentId: monitorAssignment, status: "present" }]).expect(
        200,
      );

      const [entry] = await entriesOf(lessonId);
      expect(await historyOf(entry.id)).toEqual([
        {
          type: "created",
          actor_id: teacher.id,
          from_status: null,
          to_status: "pending",
          from_minutes: null,
          to_minutes: 90,
        },
        {
          type: "approved",
          actor_id: teacher.id,
          from_status: "pending",
          to_status: "approved",
          from_minutes: 90,
          to_minutes: 90,
        },
      ]);
      expect(events.map((event) => event.action)).toEqual([
        AuditableAction.HOUR_ENTRY_CREATED,
        AuditableAction.HOUR_ENTRY_APPROVED,
        AuditableAction.MEMBER_ATTENDANCE_CONFIRMED,
      ]);
      expect(events[2]).toMatchObject({
        actorId: teacher.id,
        targetType: "member_attendance",
        after: { personId: monitor.id, status: "present", hourEntryId: entry.id },
      });
    });

    it("answers 403 SELF_ATTENDANCE_NOT_ALLOWED to the teacher confirming himself and to a coordinator assigned as monitor confirming herself, writing nothing", async () => {
      const own = await putAttendance(teacher, [
        { assignmentId: monitorAssignment, status: "present" },
        { assignmentId: teacherAssignment, status: "present" },
      ]).expect(403);
      expect(own.body).toMatchObject({ error: "SELF_ATTENDANCE_NOT_ALLOWED" });

      const coordinatorAssignment = await confirmedAssignment(lessonId, coordinator, "monitor");
      const coordination = await putAttendance(coordinator, [
        { assignmentId: coordinatorAssignment, status: "present" },
      ]).expect(403);
      expect(coordination.body).toMatchObject({ error: "SELF_ATTENDANCE_NOT_ALLOWED" });

      expect(await attendanceRows()).toEqual([]);
      expect(await entriesOf(lessonId)).toEqual([]);
    });

    it("answers 403 FORBIDDEN_SCOPE to a monitor confirming another monitor", async () => {
      const res = await putAttendance(monitor, [
        { assignmentId: otherMonitorAssignment, status: "present" },
      ]).expect(403);

      expect(res.body).toMatchObject({ error: "FORBIDDEN_SCOPE" });
      expect(await attendanceRows()).toEqual([]);
    });

    it("lets a director confirm the teacher", async () => {
      const res = await putAttendance(director, [
        { assignmentId: teacherAssignment, status: "present" },
      ]).expect(200);

      expect(itemOf(res.body as MemberAttendanceBody[], teacherAssignment)).toMatchObject({
        status: "present",
        confirmedBy: { id: director.id },
      });
      expect(await activeEntriesOf(lessonId)).toEqual([
        expect.objectContaining({ person_id: teacher.id, reviewed_by_id: director.id }),
      ]);
    });

    it("lets coordination correct a presence to absent: the hours are reversed, with a reversed row in their history, and leave the bank of the member", async () => {
      await putAttendance(teacher, [{ assignmentId: monitorAssignment, status: "present" }]).expect(
        200,
      );
      const [entry] = await entriesOf(lessonId);

      const res = await putAttendance(coordinator, [
        { assignmentId: monitorAssignment, status: "absent" },
      ]).expect(200);

      expect(itemOf(res.body as MemberAttendanceBody[], monitorAssignment)).toMatchObject({
        status: "absent",
        confirmedBy: { id: coordinator.id },
        hourEntryId: null,
      });
      expect((await entriesOf(lessonId))[0].deleted_at).toBeInstanceOf(Date);
      expect((await historyOf(entry.id)).at(-1)).toEqual({
        type: "reversed",
        actor_id: coordinator.id,
        from_status: "approved",
        to_status: null,
        from_minutes: 90,
        to_minutes: null,
      });
      const summary = await request(app.getHttpServer())
        .get("/me/hours/summary")
        .set("Cookie", monitor.cookie)
        .expect(200);
      expect(summary.body).toMatchObject({ bankMinutes: 0 });
    });

    it("answers 403 FORBIDDEN to the teacher who tries to correct a signed presence", async () => {
      await putAttendance(teacher, [{ assignmentId: monitorAssignment, status: "present" }]).expect(
        200,
      );

      const res = await putAttendance(teacher, [
        { assignmentId: monitorAssignment, status: "absent" },
      ]).expect(403);

      expect(res.body).toMatchObject({ error: "FORBIDDEN" });
      expect(await activeEntriesOf(lessonId)).toHaveLength(1);
      expect(await attendanceRows()).toEqual([
        expect.objectContaining({ status: "present", confirmed_by_id: teacher.id }),
      ]);
    });

    it("PUT present twice writes one presence and one hour entry, and the second call emits nothing", async () => {
      const body = [{ assignmentId: monitorAssignment, status: "present" }];
      await putAttendance(teacher, body).expect(200);
      const events = collectEvents();

      await putAttendance(teacher, body).expect(200);

      expect(await attendanceRows()).toHaveLength(1);
      expect(await entriesOf(lessonId)).toHaveLength(1);
      expect(events).toEqual([]);
    });

    it("present, absent and present again leave one active hour entry, and the reversed one keeps its history", async () => {
      const set = (status: string) =>
        putAttendance(coordinator, [{ assignmentId: monitorAssignment, status }]).expect(200);
      await set("present");
      await set("absent");
      const res = await set("present");

      const entries = await entriesOf(lessonId);
      expect(entries).toHaveLength(2);
      const [reversed, active] = entries;
      expect(reversed.deleted_at).toBeInstanceOf(Date);
      expect(active.deleted_at).toBeNull();
      expect((await historyOf(reversed.id)).map((row) => row.type)).toEqual([
        "created",
        "approved",
        "reversed",
      ]);
      expect(itemOf(res.body as MemberAttendanceBody[], monitorAssignment).hourEntryId).toBe(
        active.id,
      );
    });

    it("two PUT present at the same time end with one presence and one hour entry", async () => {
      const body = [{ assignmentId: monitorAssignment, status: "present" }];

      const [first, second] = await Promise.all([
        putAttendance(teacher, body),
        putAttendance(coordinator, body),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);
      expect(await attendanceRows()).toHaveLength(1);
      expect(await entriesOf(lessonId)).toHaveLength(1);
    });

    it("answers 400 ASSIGNMENT_NOT_CONFIRMED with the positions of a pending, a cancelled and another lesson's assignment, and writes nothing of the batch", async () => {
      const outsider = await createActor("Outsider", Role.MEMBER, tech);
      const pending = await insertAssignment(dataSource, {
        lessonId,
        personId: outsider.id,
        createdById: coordinator.id,
      });
      const cancelled = await insertAssignment(dataSource, {
        lessonId,
        personId: outsider.id,
        createdById: coordinator.id,
        status: "cancelled",
        cancelledById: coordinator.id,
        cancelledAt: new Date("2026-03-09T13:00:00.000Z"),
      });
      const otherLesson = await createLesson({ date: "2026-03-17" });
      const ofAnotherLesson = await confirmedAssignment(otherLesson, outsider, "monitor");

      const res = await putAttendance(coordinator, [
        { assignmentId: monitorAssignment, status: "present" },
        { assignmentId: pending, status: "present" },
        { assignmentId: cancelled, status: "present" },
        { assignmentId: ofAnotherLesson, status: "present" },
      ]).expect(400);

      expect(res.body).toMatchObject({ error: "ASSIGNMENT_NOT_CONFIRMED" });
      expect(
        (res.body as { details: Array<{ field: string }> }).details.map((d) => d.field),
      ).toEqual(["entries.1.assignmentId", "entries.2.assignmentId", "entries.3.assignmentId"]);
      expect(await attendanceRows()).toEqual([]);
      expect(await entriesOf(lessonId)).toEqual([]);
    });

    it("answers 400 DUPLICATE_ASSIGNMENT for the same assignment twice, in any letter case", async () => {
      const res = await putAttendance(coordinator, [
        { assignmentId: monitorAssignment, status: "present" },
        { assignmentId: monitorAssignment.toUpperCase(), status: "absent" },
      ]).expect(400);

      expect(res.body).toMatchObject({
        error: "DUPLICATE_ASSIGNMENT",
        details: [{ field: "entries.1.assignmentId" }],
      });
      expect(await attendanceRows()).toEqual([]);
    });

    it("answers 409 LESSON_IN_FUTURE for a lesson after today", async () => {
      const tomorrow = todayInAppTimeZone(new Date(Date.now() + 86_400_000));
      const future = await insertLesson(dataSource, {
        classId,
        createdById: coordinator.id,
        date: tomorrow,
      });
      const assignment = await confirmedAssignment(future.id, monitor, "monitor");

      const res = await putAttendance(
        coordinator,
        [{ assignmentId: assignment, status: "absent" }],
        future.id,
      ).expect(409);

      expect(res.body).toMatchObject({ error: "LESSON_IN_FUTURE" });
      expect(await attendanceRows()).toEqual([]);
    });

    it("after the lesson is cancelled answers 409 LESSON_CANCELLED and still lists the signed presences", async () => {
      await putAttendance(teacher, [
        { assignmentId: monitorAssignment, status: "present" },
        { assignmentId: otherMonitorAssignment, status: "absent" },
      ]).expect(200);

      await request(app.getHttpServer())
        .patch(`/lessons/${lessonId}/cancel`)
        .set("Cookie", coordinator.cookie)
        .send({ reason: "Feriado municipal." })
        .expect(200);
      // The listener of lesson.cancelled runs after the response: wait for the reversal.
      await waitFor(async () => (await activeEntriesOf(lessonId)).length === 0);

      const res = await putAttendance(coordinator, [
        { assignmentId: teacherAssignment, status: "present" },
      ]).expect(409);
      expect(res.body).toMatchObject({ error: "LESSON_CANCELLED" });

      const list = (await getAttendance(coordinator).expect(200)).body as MemberAttendanceBody[];
      expect(itemOf(list, monitorAssignment).status).toBe("present");
      expect(itemOf(list, otherMonitorAssignment).status).toBe("absent");
      const [entry] = await entriesOf(lessonId);
      expect(itemOf(list, monitorAssignment).hourEntryId).toBe(entry.id);
      expect((await historyOf(entry.id)).at(-1)).toMatchObject({
        type: "reversed",
        actor_id: coordinator.id,
      });
    });

    it("answers 404 LESSON_NOT_FOUND for an unknown and a malformed lesson id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const put = await putAttendance(
          coordinator,
          [{ assignmentId: monitorAssignment, status: "present" }],
          id,
        ).expect(404);
        expect(put.body).toMatchObject({ error: "LESSON_NOT_FOUND" });

        const get = await getAttendance(coordinator, id).expect(404);
        expect(get.body).toMatchObject({ error: "LESSON_NOT_FOUND" });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // GET /lessons/:id/attendance/members
  // ---------------------------------------------------------------------------

  describe("GET /lessons/:id/attendance/members", () => {
    it("lists the confirmed staff of the lesson, the teacher first, an unsigned one as null, to every profile", async () => {
      await putAttendance(teacher, [{ assignmentId: monitorAssignment, status: "present" }]).expect(
        200,
      );

      for (const actor of [monitor, teacher, director, coordinator]) {
        const list = (await getAttendance(actor).expect(200)).body as MemberAttendanceBody[];

        expect(list.map((item) => item.assignmentId)).toEqual([
          teacherAssignment,
          monitorAssignment,
          otherMonitorAssignment,
        ]);
        expect(list[0]).toEqual({
          assignmentId: teacherAssignment,
          person: { id: teacher.id, name: "Teacher" },
          role: "teacher",
          status: null,
          confirmedBy: null,
          confirmedAt: null,
          hourEntryId: null,
        });
        expect(list[1]).toMatchObject({ status: "present", confirmedBy: { id: teacher.id } });
      }
    });
  });
});
