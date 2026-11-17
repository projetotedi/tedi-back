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
import { EnrollmentStatus } from "@modules/classes/services/enrollment-roster.service";
import { HoursModule } from "@modules/hours/hours.module";
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
import { AttendanceModule } from "../attendance.module";
import {
  CLASS_PERIOD,
  FIRST_ENROLLED_AT,
  insertAssignment,
  insertEnrollment,
  insertStudent,
  insertStudentAttendance,
  lessonBody,
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

process.env.JWT_SECRET = "e2e-student-attendance-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

/**
 * 20:00 of 2026-03-10 in America/Sao_Paulo: the lesson of the scenery (09:00 to 11:00 that day) is
 * over, and a lesson of 2026-03-11 is in the future.
 */
const NOW = new Date("2026-03-10T23:00:00.000Z");

/** The temporary trigger of the test of the rollback: dropped in `finally` and in `afterEach`. */
const REFUSE_TRIGGER = "trg_test_refuse_student_attendance";
const REFUSE_FUNCTION = "test_refuse_student_attendance";

type CreateCourseInput = Parameters<CoursesService["create"]>[0];
type CreateLessonInput = Parameters<LessonsService["create"]>[0];

interface Actor {
  id: string;
  cookie: string;
}

interface Student {
  id: string;
  name: string;
  enrollmentId: string;
}

interface PersonRef {
  id: string;
  name: string;
}

interface CorrectionBody {
  id: string;
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  correctedBy: PersonRef | null;
  correctedAt: string;
}

interface AttendanceBody {
  id: string;
  lessonId: string;
  enrollmentId: string;
  status: string;
  signedBy: PersonRef | null;
  signedAt: string;
  justified: boolean;
  justification: {
    reason: string;
    note: string | null;
    justifiedBy: PersonRef | null;
    justifiedAt: string;
  } | null;
  corrections: CorrectionBody[];
}

interface RollCallItemBody {
  enrollment: { id: string; status: string; statusChangedAt: string };
  student: PersonRef | null;
  attendance: AttendanceBody | null;
}

interface AttendanceRow {
  enrollment_id: string;
  status: string;
  signed_by_id: string;
  signed_at: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * The roll call of the students (GUS-166), through HTTP to Postgres. The scenery is a lesson of
 * 2026-03-10 from 09:00 to 11:00 in a class with three students enrolled on 2026-03-03, a confirmed
 * teacher and a confirmed monitor; the clock of the app is fixed at 20:00 of that day in São Paulo.
 * Everything else comes from the services and the fixtures the other modules export. Two requests
 * run at the same time in some tests, so the app listens on a port of its own.
 */
describe("student attendance routes (e2e)", () => {
  let module: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonsService: LessonsService;

  let coordinator: Actor;
  let director: Actor;
  let teacher: Actor;
  let monitor: Actor;
  let outsider: Actor;
  let pendingMonitor: Actor;

  let courseId: string;
  let classId: string;
  let lessonId: string;
  let ana: Student;
  let bruno: Student;
  let carla: Student;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          // Every entity: the foreign keys of StudentAttendance point to other modules' tables by name.
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
    })
      // Every module that provides a Clock gets this one: "today" is 2026-03-10 in São Paulo.
      .overrideProvider(Clock)
      .useValue({ now: () => new Date(NOW) })
      .compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    // init() only, once: it runs onModuleInit, where the ports register their implementation (a
    // second registration throws).
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
      `TRUNCATE TABLE attendance_corrections, student_attendance, member_attendance,
                      hour_entry_events, hour_entries, lesson_assignments, enrollments, lessons,
                      classes, editions, course_lesson_plans, lesson_plan_contents, lesson_plans,
                      course_prerequisites, courses, student_profiles, invites, departments, people
       RESTART IDENTITY CASCADE`,
    );

    coordinator = await createActor("Carla Coordenadora", Role.COORDINATOR);
    director = await createActor("Diretor", Role.DIRECTOR);
    teacher = await createActor("Professora", Role.MEMBER);
    monitor = await createActor("Beatriz Nunes", Role.MEMBER);
    outsider = await createActor("Membro de fora", Role.MEMBER);
    pendingMonitor = await createActor("Monitor pendente", Role.MEMBER);

    const course = await coursesService.create(
      {
        name: "Informática Básica",
        description: "Fundamentos do uso do computador.",
        category: "basic",
      } as unknown as CreateCourseInput,
      coordinator.id,
    );
    courseId = course.id;
    classId = await createClass("INFO-A");
    lessonId = await createLesson();
    await assignment(lessonId, teacher, "teacher", "confirmed");
    await assignment(lessonId, monitor, "monitor", "confirmed");
    await assignment(lessonId, pendingMonitor, "monitor", "pending");

    ana = await enroll("Ana Souza");
    bruno = await enroll("Bruno Lima");
    carla = await enroll("Carla Dias");
  });

  afterEach(async () => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
    await dropRefuseTrigger();
  });

  // ---------------------------------------------------------------------------
  // Scenery
  // ---------------------------------------------------------------------------

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  async function createClass(code: string): Promise<string> {
    const schoolClass = await classesService.create(
      { courseId, code, editionName: "2026.1", ...CLASS_PERIOD, capacity: 15 },
      coordinator.id,
    );
    return schoolClass.id;
  }

  /** A lesson of the class from 09:00 to 11:00, on 2026-03-10 unless `overrides` says otherwise. */
  async function createLesson(overrides: Record<string, unknown> = {}): Promise<string> {
    const lesson = await lessonsService.create(
      lessonBody({
        classId,
        startTime: "09:00",
        endTime: "11:00",
        ...overrides,
      }) as unknown as CreateLessonInput,
      coordinator.id,
    );
    return lesson.id;
  }

  function assignment(
    forLessonId: string,
    who: Actor,
    role: "teacher" | "monitor",
    status: "pending" | "confirmed",
  ): Promise<string> {
    return insertAssignment(dataSource, {
      lessonId: forLessonId,
      personId: who.id,
      createdById: coordinator.id,
      role,
      status,
      ...(status === "confirmed"
        ? { reviewedById: coordinator.id, reviewedAt: new Date("2026-03-09T12:00:00.000Z") }
        : {}),
    });
  }

  /** A student enrolled in the class on 2026-03-03 (before every lesson), unless `values` says otherwise. */
  async function enroll(
    name: string,
    values: {
      forClassId?: string;
      enrolledAt?: Date;
      status?: EnrollmentStatus;
      statusChangedAt?: string;
      deletedAt?: Date;
    } = {},
  ): Promise<Student> {
    const studentId = await insertStudent(dataSource, {
      name,
      createdById: coordinator.id,
      phone: "43999990000",
      accessibilityNeed: "visual",
    });
    const enrollmentId = await insertEnrollment(dataSource, {
      classId: values.forClassId ?? classId,
      studentId,
      createdById: coordinator.id,
      enrolledAt: values.enrolledAt ?? FIRST_ENROLLED_AT,
      status: values.status,
      statusChangedAt: values.statusChangedAt,
      deletedAt: values.deletedAt,
    });
    return { id: studentId, name, enrollmentId };
  }

  // ---------------------------------------------------------------------------
  // HTTP and database helpers
  // ---------------------------------------------------------------------------

  function putRollCall(
    actor: Actor,
    entries: Array<{ enrollmentId: string; status: string }>,
    forLessonId = lessonId,
  ) {
    return request(app.getHttpServer())
      .put(`/lessons/${forLessonId}/attendance/students`)
      .set("Cookie", actor.cookie)
      .send({ entries });
  }

  function getRollCall(actor: Actor, forLessonId = lessonId) {
    return request(app.getHttpServer())
      .get(`/lessons/${forLessonId}/attendance/students`)
      .set("Cookie", actor.cookie);
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  function studentEvents(events: readonly AuditableActionEvent[]): AuditableActionEvent[] {
    return events.filter((event) => event.targetType === "student_attendance");
  }

  async function attendanceRows(forLessonId = lessonId): Promise<AttendanceRow[]> {
    return dataSource.query(
      `SELECT enrollment_id, status, signed_by_id, signed_at, created_at, updated_at
         FROM student_attendance WHERE lesson_id = $1 ORDER BY enrollment_id`,
      [forLessonId],
    );
  }

  async function countRows(): Promise<number> {
    const rows: Array<{ total: number }> = await dataSource.query(
      `SELECT COUNT(*)::int AS total FROM student_attendance`,
    );
    return rows[0].total;
  }

  function itemOf(items: readonly RollCallItemBody[], student: Student): RollCallItemBody {
    const item = items.find((candidate) => candidate.enrollment.id === student.enrollmentId);
    if (item === undefined) throw new Error(`${student.name} is not in the roll call.`);
    return item;
  }

  /** A correction of an attendance straight in the table: the scenery of the list. */
  async function insertCorrection(
    studentAttendanceId: string,
    reason: string,
    correctedById: string,
  ): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO attendance_corrections (id, student_attendance_id, from_status, to_status,
                                           reason, corrected_by_id)
       VALUES (gen_random_uuid(), $1, 'present', 'absent', $2, $3)
       RETURNING id`,
      [studentAttendanceId, reason, correctedById],
    );
    return rows[0].id;
  }

  async function dropRefuseTrigger(): Promise<void> {
    await dataSource.query(`DROP TRIGGER IF EXISTS ${REFUSE_TRIGGER} ON student_attendance`);
    await dataSource.query(`DROP FUNCTION IF EXISTS ${REFUSE_FUNCTION}()`);
  }

  /**
   * The text of a statement that is waiting for a lock, or undefined after 3 seconds. Postgres cuts
   * the text at 1024 bytes (track_activity_query_size); a plain SELECT is never blocked by a row lock
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
   * concurrent write of another module (or another request) would. `run` runs a statement inside
   * that transaction; `release` commits it.
   */
  async function holdRow(table: "lessons" | "classes", id: string, lock: string) {
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
  // PUT /lessons/:id/attendance/students
  // ---------------------------------------------------------------------------

  describe("PUT /lessons/:id/attendance/students (signStudentAttendance)", () => {
    it("CA1: the confirmed monitor of the lesson signs the roll call (200); a member not allocated gets 403 FORBIDDEN_SCOPE and nothing is written", async () => {
      const refused = await putRollCall(outsider, [
        { enrollmentId: ana.enrollmentId, status: "present" },
      ]).expect(403);
      expect(refused.body.error).toBe("FORBIDDEN_SCOPE");
      expect(refused.body).not.toHaveProperty("details");
      expect(await countRows()).toBe(0);

      const res = await putRollCall(monitor, [
        { enrollmentId: ana.enrollmentId, status: "present" },
      ]).expect(200);
      expect(itemOf(res.body as RollCallItemBody[], ana).attendance).toMatchObject({
        status: "present",
        signedBy: { id: monitor.id, name: "Beatriz Nunes" },
      });
      expect(await countRows()).toBe(1);
    });

    it("lets the confirmed teacher, a director and a coordinator sign; a pending monitor gets 403 FORBIDDEN_SCOPE", async () => {
      await putRollCall(teacher, [{ enrollmentId: ana.enrollmentId, status: "present" }]).expect(
        200,
      );
      await putRollCall(director, [{ enrollmentId: bruno.enrollmentId, status: "absent" }]).expect(
        200,
      );
      await putRollCall(coordinator, [
        { enrollmentId: carla.enrollmentId, status: "present" },
      ]).expect(200);

      const refused = await putRollCall(pendingMonitor, [
        { enrollmentId: ana.enrollmentId, status: "present" },
      ]).expect(403);
      expect(refused.body.error).toBe("FORBIDDEN_SCOPE");
      expect((await attendanceRows()).map((row) => row.signed_by_id).sort()).toEqual(
        [teacher.id, director.id, coordinator.id].sort(),
      );
    });

    it("CA2: signs present and absent for the selected students in one batch, every row with the actor and the same signedAt", async () => {
      const res = await putRollCall(monitor, [
        { enrollmentId: ana.enrollmentId, status: "present" },
        { enrollmentId: bruno.enrollmentId, status: "absent" },
        { enrollmentId: carla.enrollmentId, status: "present" },
      ]).expect(200);

      const rows = await attendanceRows();
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.signed_by_id).toBe(monitor.id);
        expect(row.signed_at).toEqual(NOW);
        expect(row.created_at).toEqual(NOW);
        expect(row.updated_at).toEqual(NOW);
      }
      const items = res.body as RollCallItemBody[];
      expect(items.map((item) => [item.student?.name, item.attendance?.status])).toEqual([
        ["Ana Souza", "present"],
        ["Bruno Lima", "absent"],
        ["Carla Dias", "present"],
      ]);
      expect(items.every((item) => item.attendance?.signedAt === NOW.toISOString())).toBe(true);
    });

    it("CA2: rolls back the whole batch when the database refuses one row: nothing written and no event", async () => {
      const events = collectEvents();
      try {
        // The id is a uuid read from the database: safe inside the body of the function.
        await dataSource.query(`
          CREATE FUNCTION ${REFUSE_FUNCTION}() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.enrollment_id = '${carla.enrollmentId}'::uuid THEN
              RAISE EXCEPTION 'refused by the test';
            END IF;
            RETURN NEW;
          END
          $$
        `);
        await dataSource.query(
          `CREATE TRIGGER ${REFUSE_TRIGGER} BEFORE INSERT ON student_attendance
             FOR EACH ROW EXECUTE FUNCTION ${REFUSE_FUNCTION}()`,
        );

        await putRollCall(monitor, [
          { enrollmentId: ana.enrollmentId, status: "present" },
          { enrollmentId: bruno.enrollmentId, status: "absent" },
          { enrollmentId: carla.enrollmentId, status: "present" },
        ]).expect(500);
      } finally {
        await dropRefuseTrigger();
      }

      expect(await countRows()).toBe(0);
      expect(studentEvents(events)).toEqual([]);
    });

    it("answers 400 ENROLLMENT_NOT_IN_ROLL_CALL for an enrollment of another class, a removed one, one enrolled after the day of the lesson and one dropped before it, with the positions, and writes nothing", async () => {
      const otherClass = await createClass("INFO-B");
      const elsewhere = await enroll("Em outra turma", { forClassId: otherClass });
      const removed = await enroll("Removida", { deletedAt: new Date("2026-03-04T12:00:00Z") });
      const late = await enroll("Matriculada depois", {
        enrolledAt: new Date("2026-03-11T13:00:00.000Z"),
      });
      const dropped = await enroll("Desistente", {
        status: EnrollmentStatus.DROPPED,
        statusChangedAt: "2026-03-05",
      });

      const res = await putRollCall(coordinator, [
        { enrollmentId: ana.enrollmentId, status: "present" },
        { enrollmentId: elsewhere.enrollmentId, status: "present" },
        { enrollmentId: removed.enrollmentId, status: "present" },
        { enrollmentId: late.enrollmentId, status: "present" },
        { enrollmentId: dropped.enrollmentId, status: "absent" },
        { enrollmentId: UNKNOWN_ID, status: "absent" },
      ]).expect(400);

      expect(res.body.error).toBe("ENROLLMENT_NOT_IN_ROLL_CALL");
      expect(res.body.details.map((detail: { field: string }) => detail.field)).toEqual([
        "entries.1.enrollmentId",
        "entries.2.enrollmentId",
        "entries.3.enrollmentId",
        "entries.4.enrollmentId",
        "entries.5.enrollmentId",
      ]);
      expect(await countRows()).toBe(0);
    });

    it("a reactivated enrollment is not expected in the lessons before its reactivation", async () => {
      // Enrolled on 2026-03-03, dropped, and active again "from 2026-03-12": the status it has now
      // only holds from that day on.
      const back = await enroll("Voltou depois", { statusChangedAt: "2026-03-12" });
      const afterReactivation = await createLesson({ date: "2026-03-12" });
      const idsOf = (body: unknown) =>
        (body as RollCallItemBody[]).map((item) => item.enrollment.id);

      const before = await getRollCall(coordinator).expect(200);
      expect(idsOf(before.body)).not.toContain(back.enrollmentId);
      const refused = await putRollCall(coordinator, [
        { enrollmentId: back.enrollmentId, status: "absent" },
      ]).expect(400);
      expect(refused.body.error).toBe("ENROLLMENT_NOT_IN_ROLL_CALL");
      expect(await countRows()).toBe(0);

      const after = await getRollCall(coordinator, afterReactivation).expect(200);
      expect(idsOf(after.body)).toContain(back.enrollmentId);

      // A signature made in the lesson keeps the enrollment in that roll call.
      await insertStudentAttendance(dataSource, {
        lessonId,
        enrollmentId: back.enrollmentId,
        status: "present",
        signedById: monitor.id,
      });
      const signed = await getRollCall(coordinator).expect(200);
      expect(idsOf(signed.body)).toContain(back.enrollmentId);
    });

    it("signs a student who dropped after the day of the lesson, and leaves out of the roll call the lessons from the drop on", async () => {
      const leaving = await enroll("Saiu depois", {
        status: EnrollmentStatus.DROPPED,
        statusChangedAt: "2026-03-11",
      });
      const fromTheDrop = await createLesson({ date: "2026-03-11" });

      const res = await putRollCall(monitor, [
        { enrollmentId: leaving.enrollmentId, status: "present" },
      ]).expect(200);
      expect(itemOf(res.body as RollCallItemBody[], leaving)).toMatchObject({
        enrollment: { id: leaving.enrollmentId, status: "dropped", statusChangedAt: "2026-03-11" },
        attendance: { status: "present" },
      });

      const later = await getRollCall(coordinator, fromTheDrop).expect(200);
      expect((later.body as RollCallItemBody[]).map((item) => item.enrollment.id)).not.toContain(
        leaving.enrollmentId,
      );
    });

    it("the same status again is a no-op (200, no event); another status answers 409 STUDENT_ATTENDANCE_ALREADY_SIGNED", async () => {
      await putRollCall(monitor, [{ enrollmentId: ana.enrollmentId, status: "present" }]).expect(
        200,
      );
      const before = await attendanceRows();
      const events = collectEvents();

      await putRollCall(teacher, [{ enrollmentId: ana.enrollmentId, status: "present" }]).expect(
        200,
      );
      expect(await attendanceRows()).toEqual(before);
      expect(studentEvents(events)).toEqual([]);

      const conflict = await putRollCall(coordinator, [
        { enrollmentId: bruno.enrollmentId, status: "absent" },
        { enrollmentId: ana.enrollmentId, status: "absent" },
      ]).expect(409);
      expect(conflict.body).toEqual({
        error: "STUDENT_ATTENDANCE_ALREADY_SIGNED",
        message:
          "One or more attendances are already signed with another status; use the correction.",
        details: [
          {
            field: "entries.1.enrollmentId",
            message: "attendance already signed with another status",
          },
        ],
      });
      expect(await attendanceRows()).toEqual(before);
    });

    it("two PUT at the same time end with 200 and 200 and one row per enrollment", async () => {
      const entries = [
        { enrollmentId: ana.enrollmentId, status: "present" },
        { enrollmentId: bruno.enrollmentId, status: "absent" },
      ];

      const [first, second] = await Promise.all([
        putRollCall(monitor, entries),
        putRollCall(teacher, entries),
      ]);

      expect([first.status, second.status]).toEqual([200, 200]);
      expect((await attendanceRows()).map((row) => row.enrollment_id).sort()).toEqual(
        [ana.enrollmentId, bruno.enrollmentId].sort(),
      );
    });

    it("answers 409 LESSON_IN_FUTURE, 409 LESSON_CANCELLED and 409 CLASS_ARCHIVED, and signs a lesson of today", async () => {
      const tomorrow = await createLesson({ date: "2026-03-11" });
      const future = await putRollCall(
        coordinator,
        [{ enrollmentId: ana.enrollmentId, status: "present" }],
        tomorrow,
      ).expect(409);
      expect(future.body.error).toBe("LESSON_IN_FUTURE");

      const cancelledLesson = await createLesson({ date: "2026-03-09" });
      await lessonsService.cancel(cancelledLesson, { reason: "Feriado." }, coordinator.id);
      const cancelled = await putRollCall(
        coordinator,
        [{ enrollmentId: ana.enrollmentId, status: "present" }],
        cancelledLesson,
      ).expect(409);
      expect(cancelled.body.error).toBe("LESSON_CANCELLED");
      expect(await countRows()).toBe(0);

      // Today, after the end of the lesson.
      await putRollCall(coordinator, [
        { enrollmentId: ana.enrollmentId, status: "present" },
      ]).expect(200);

      // An archived class is read-only (scenery by SQL: the archive refuses a class with students).
      await dataSource.query(
        `UPDATE classes SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
        [classId, coordinator.id],
      );
      const archived = await putRollCall(coordinator, [
        { enrollmentId: bruno.enrollmentId, status: "present" },
      ]).expect(409);
      expect(archived.body).toEqual({
        error: "CLASS_ARCHIVED",
        message: "Archived classes are read-only.",
      });
      expect(await countRows()).toBe(1);
    });

    it("answers 400 DUPLICATE_ENROLLMENT and 400 VALIDATION_FAILED, and 404 LESSON_NOT_FOUND for an unknown and a malformed id", async () => {
      const duplicate = await putRollCall(monitor, [
        { enrollmentId: ana.enrollmentId, status: "present" },
        { enrollmentId: ana.enrollmentId.toUpperCase(), status: "absent" },
      ]).expect(400);
      expect(duplicate.body).toEqual({
        error: "DUPLICATE_ENROLLMENT",
        message: "The same enrollment appears more than once.",
        details: [
          { field: "entries.1.enrollmentId", message: "enrollment appears more than once" },
        ],
      });

      const invalid = await putRollCall(monitor, [
        { enrollmentId: "not-a-uuid", status: "late" },
      ]).expect(400);
      expect(invalid.body.error).toBe("VALIDATION_FAILED");
      const empty = await putRollCall(monitor, []).expect(400);
      expect(empty.body.error).toBe("VALIDATION_FAILED");

      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const missing = await putRollCall(
          coordinator,
          [{ enrollmentId: ana.enrollmentId, status: "present" }],
          id,
        ).expect(404);
        expect(missing.body.error).toBe("LESSON_NOT_FOUND");
      }
      expect(await countRows()).toBe(0);
    });

    it("emits one STUDENT_ATTENDANCE_SIGNED per new signature after the commit, with no personal data", async () => {
      await putRollCall(monitor, [{ enrollmentId: ana.enrollmentId, status: "present" }]).expect(
        200,
      );
      const events = collectEvents();

      await putRollCall(monitor, [
        { enrollmentId: ana.enrollmentId, status: "present" },
        { enrollmentId: carla.enrollmentId, status: "absent" },
        { enrollmentId: bruno.enrollmentId, status: "present" },
      ]).expect(200);

      const signed = studentEvents(events);
      expect(signed.map((event) => event.action)).toEqual([
        AuditableAction.STUDENT_ATTENDANCE_SIGNED,
        AuditableAction.STUDENT_ATTENDANCE_SIGNED,
      ]);
      expect(signed.map((event) => event.after.enrollmentId)).toEqual([
        carla.enrollmentId,
        bruno.enrollmentId,
      ]);
      for (const event of signed) {
        expect(event.actorId).toBe(monitor.id);
        expect(event.before).toBeNull();
        expect(Object.keys(event.after).sort()).toEqual(
          ["enrollmentId", "lessonId", "signedAt", "signedById", "status"].sort(),
        );
        expect(JSON.stringify(event)).not.toMatch(/Carla Dias|Bruno Lima|43999990000/);
      }
    });

    it("race: a signature waits for the cancellation of the lesson and answers 409 LESSON_CANCELLED", async () => {
      // A cancellation holds the lesson FOR UPDATE until it commits.
      const cancellation = await holdRow("lessons", lessonId, "FOR UPDATE");

      const pending = putRollCall(monitor, [
        { enrollmentId: ana.enrollmentId, status: "present" },
      ]).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/"Lesson"/);
        expect(await countRows()).toBe(0);
        await cancellation.run(
          `UPDATE lessons SET status = 'cancelled', cancel_reason = 'Feriado.', cancelled_at = now(), cancelled_by_id = $2 WHERE id = $1`,
          [lessonId, coordinator.id],
        );
      } finally {
        await cancellation.release();
      }

      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("LESSON_CANCELLED");
      expect(await countRows()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /lessons/:id/attendance/students
  // ---------------------------------------------------------------------------

  describe("GET /lessons/:id/attendance/students (listStudentAttendance)", () => {
    it("lists the students expected at the lesson ordered by name, with the enrollment situation, the attendance, who signed and when; an unsigned one has attendance null", async () => {
      await putRollCall(monitor, [{ enrollmentId: bruno.enrollmentId, status: "absent" }]).expect(
        200,
      );
      // Enrolled after the day of the lesson: not in its roll call.
      await enroll("Aaron Tardio", { enrolledAt: new Date("2026-03-12T13:00:00.000Z") });

      const res = await getRollCall(coordinator).expect(200);
      const items = res.body as RollCallItemBody[];

      expect(items.map((item) => item.student?.name)).toEqual([
        "Ana Souza",
        "Bruno Lima",
        "Carla Dias",
      ]);
      expect(itemOf(items, ana)).toEqual({
        enrollment: { id: ana.enrollmentId, status: "active", statusChangedAt: "2026-03-03" },
        student: { id: ana.id, name: "Ana Souza" },
        attendance: null,
      });
      expect(itemOf(items, bruno).attendance).toEqual({
        id: expect.any(String),
        lessonId,
        enrollmentId: bruno.enrollmentId,
        status: "absent",
        signedBy: { id: monitor.id, name: "Beatriz Nunes" },
        signedAt: NOW.toISOString(),
        justified: false,
        justification: null,
        corrections: [],
      });
    });

    it("lets every profile read it, and hides the justification and the reasons of the corrections from a member not allocated, with justified true", async () => {
      const signed = await insertStudentAttendance(dataSource, {
        lessonId,
        enrollmentId: ana.enrollmentId,
        status: "absent",
        signedById: monitor.id,
        justification: {
          reason: "health",
          note: "Consulta médica marcada.",
          justifiedById: monitor.id,
        },
      });
      await insertCorrection(signed, "Saiu antes por causa da saúde.", coordinator.id);

      for (const [actor, sees] of [
        [monitor, true],
        [teacher, true],
        [director, true],
        [coordinator, true],
        [pendingMonitor, false],
        [outsider, false],
      ] as const) {
        const res = await getRollCall(actor).expect(200);
        const attendance = itemOf(res.body as RollCallItemBody[], ana).attendance;

        expect(attendance?.justified).toBe(true);
        expect(attendance?.justification?.note ?? null).toBe(
          sees ? "Consulta médica marcada." : null,
        );
        expect(attendance?.justification?.reason ?? null).toBe(sees ? "health" : null);
        expect(attendance?.corrections.map((correction) => correction.reason)).toEqual([
          sees ? "Saiu antes por causa da saúde." : null,
        ]);
        expect(attendance?.corrections[0].correctedBy).toEqual({
          id: coordinator.id,
          name: "Carla Coordenadora",
        });
      }
    });

    it("brings no phone, accessibility need or age of the student", async () => {
      const res = await getRollCall(coordinator).expect(200);
      const [first] = res.body as RollCallItemBody[];

      expect(Object.keys(first).sort()).toEqual(["attendance", "enrollment", "student"]);
      expect(Object.keys(first.student ?? {}).sort()).toEqual(["id", "name"]);
      expect(Object.keys(first.enrollment).sort()).toEqual(["id", "status", "statusChangedAt"]);
      expect(JSON.stringify(res.body)).not.toMatch(/43999990000|visual/);
    });

    it("reads a cancelled lesson; answers 404 LESSON_NOT_FOUND for an unknown lesson", async () => {
      await putRollCall(monitor, [{ enrollmentId: ana.enrollmentId, status: "present" }]).expect(
        200,
      );
      await lessonsService.cancel(lessonId, { reason: "Feriado." }, coordinator.id);

      const res = await getRollCall(outsider).expect(200);
      expect(
        (res.body as RollCallItemBody[]).map((item) => item.attendance?.status ?? null),
      ).toEqual(["present", null, null]);

      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const missing = await getRollCall(coordinator, id).expect(404);
        expect(missing.body.error).toBe("LESSON_NOT_FOUND");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /student-attendance/:id/justify
  // ---------------------------------------------------------------------------

  describe("PATCH /student-attendance/:id/justify (justifyAbsence)", () => {
    function justify(actor: Actor, id: string, body: Record<string, unknown>) {
      return request(app.getHttpServer())
        .patch(`/student-attendance/${id}/justify`)
        .set("Cookie", actor.cookie)
        .send(body);
    }

    async function absenceOf(student: Student): Promise<string> {
      return insertStudentAttendance(dataSource, {
        lessonId,
        enrollmentId: student.enrollmentId,
        status: "absent",
        signedById: monitor.id,
        signedAt: new Date("2026-03-10T14:05:00.000Z"),
      });
    }

    async function justificationRow(id: string): Promise<Record<string, unknown>> {
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT status, justification_reason, justification_note, justified_by_id, justified_at,
                signed_by_id, signed_at
           FROM student_attendance WHERE id = $1`,
        [id],
      );
      return rows[0];
    }

    it("the allocated monitor justifies an absence with reason, note, who and when; the attendance stays absent", async () => {
      const id = await absenceOf(ana);

      const res = await justify(monitor, id, {
        reason: "health",
        note: "  Consulta médica marcada.  ",
      }).expect(200);

      expect(res.body).toMatchObject({
        id,
        status: "absent",
        justified: true,
        justification: {
          reason: "health",
          note: "Consulta médica marcada.",
          justifiedBy: { id: monitor.id, name: "Beatriz Nunes" },
          justifiedAt: NOW.toISOString(),
        },
        corrections: [],
      });
      expect(await justificationRow(id)).toMatchObject({
        status: "absent",
        justification_reason: "health",
        justification_note: "Consulta médica marcada.",
        justified_by_id: monitor.id,
        justified_at: NOW,
        signed_by_id: monitor.id,
        signed_at: new Date("2026-03-10T14:05:00.000Z"),
      });
    });

    it("justifying again replaces it; the same reason and note is a no-op", async () => {
      const id = await absenceOf(ana);
      await justify(monitor, id, { reason: "health", note: "Consulta." }).expect(200);

      await justify(coordinator, id, { reason: "other" }).expect(200);
      expect(await justificationRow(id)).toMatchObject({
        justification_reason: "other",
        justification_note: null,
        justified_by_id: coordinator.id,
      });

      const events = collectEvents();
      const before = await justificationRow(id);
      await justify(teacher, id, { reason: "other", note: "" }).expect(200);
      expect(await justificationRow(id)).toEqual(before);
      expect(studentEvents(events)).toEqual([]);
    });

    it("answers 409 STUDENT_ATTENDANCE_NOT_ABSENT for a presence, 403 FORBIDDEN_SCOPE to a member not allocated and 404 STUDENT_ATTENDANCE_NOT_FOUND for an unknown or malformed id", async () => {
      const presence = await insertStudentAttendance(dataSource, {
        lessonId,
        enrollmentId: bruno.enrollmentId,
        status: "present",
        signedById: monitor.id,
      });
      const notAbsent = await justify(monitor, presence, { reason: "health" }).expect(409);
      expect(notAbsent.body).toEqual({
        error: "STUDENT_ATTENDANCE_NOT_ABSENT",
        message: "Only an absence can be justified.",
      });

      const id = await absenceOf(ana);
      for (const actor of [outsider, pendingMonitor]) {
        const forbidden = await justify(actor, id, { reason: "health" }).expect(403);
        expect(forbidden.body.error).toBe("FORBIDDEN_SCOPE");
      }
      expect((await justificationRow(id)).justification_reason).toBeNull();

      for (const unknown of [UNKNOWN_ID, "not-a-uuid"]) {
        const missing = await justify(coordinator, unknown, { reason: "health" }).expect(404);
        expect(missing.body.error).toBe("STUDENT_ATTENDANCE_NOT_FOUND");
      }
      const invalid = await justify(coordinator, id, { reason: "travel" }).expect(400);
      expect(invalid.body.error).toBe("VALIDATION_FAILED");
    });

    it("emits STUDENT_ABSENCE_JUSTIFIED without the reason and the note", async () => {
      const id = await absenceOf(ana);
      const events = collectEvents();

      await justify(monitor, id, { reason: "health", note: "Consulta médica marcada." }).expect(
        200,
      );

      const [event] = studentEvents(events);
      expect(event.action).toBe(AuditableAction.STUDENT_ABSENCE_JUSTIFIED);
      expect(event.targetId).toBe(id);
      expect(event.actorId).toBe(monitor.id);
      expect(event.before).toEqual({ justified: false });
      expect(event.after).toEqual({
        justified: true,
        justifiedAt: NOW,
        changedFields: ["justificationReason", "justificationNote"],
      });
      expect(JSON.stringify(event)).not.toMatch(/health|Consulta/);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /student-attendance/:id/correct
  // ---------------------------------------------------------------------------

  describe("PATCH /student-attendance/:id/correct (correctStudentAttendance)", () => {
    function correct(actor: Actor, id: string, body: Record<string, unknown>) {
      return request(app.getHttpServer())
        .patch(`/student-attendance/${id}/correct`)
        .set("Cookie", actor.cookie)
        .send(body);
    }

    async function presenceOf(student: Student): Promise<string> {
      return insertStudentAttendance(dataSource, {
        lessonId,
        enrollmentId: student.enrollmentId,
        status: "present",
        signedById: monitor.id,
        signedAt: new Date("2026-03-10T14:05:00.000Z"),
      });
    }

    async function correctionRows(id: string): Promise<Array<Record<string, unknown>>> {
      return dataSource.query(
        `SELECT from_status, to_status, reason, corrected_by_id, created_at
           FROM attendance_corrections WHERE student_attendance_id = $1 ORDER BY created_at, id`,
        [id],
      );
    }

    it("CA3: without a reason (missing, empty or blank) answers 400 VALIDATION_FAILED and writes nothing", async () => {
      const id = await presenceOf(ana);

      for (const body of [
        { status: "absent" },
        { status: "absent", reason: "" },
        { status: "absent", reason: "   " },
      ]) {
        const res = await correct(coordinator, id, body).expect(400);
        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(res.body.details.map((detail: { field: string }) => detail.field)).toContain(
          "reason",
        );
      }
      expect(await correctionRows(id)).toEqual([]);
      const rows: Array<{ status: string }> = await dataSource.query(
        `SELECT status FROM student_attendance WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([{ status: "present" }]);
    });

    it("CA3: with a reason the coordination corrects present to absent: one row in attendance_corrections with from, to, reason, who and when, and the history shows in the attendance and in the list", async () => {
      const id = await presenceOf(ana);

      const res = await correct(coordinator, id, {
        status: "absent",
        reason: "  Marcado por engano: saiu antes do início.  ",
      }).expect(200);

      expect(await correctionRows(id)).toEqual([
        {
          from_status: "present",
          to_status: "absent",
          reason: "Marcado por engano: saiu antes do início.",
          corrected_by_id: coordinator.id,
          created_at: NOW,
        },
      ]);
      expect(res.body).toMatchObject({
        id,
        status: "absent",
        // The first signature stays.
        signedBy: { id: monitor.id, name: "Beatriz Nunes" },
        signedAt: "2026-03-10T14:05:00.000Z",
        corrections: [
          {
            fromStatus: "present",
            toStatus: "absent",
            reason: "Marcado por engano: saiu antes do início.",
            correctedBy: { id: coordinator.id, name: "Carla Coordenadora" },
            correctedAt: NOW.toISOString(),
          },
        ],
      });

      const list = await getRollCall(monitor).expect(200);
      expect(itemOf(list.body as RollCallItemBody[], ana).attendance?.corrections).toEqual(
        res.body.corrections,
      );
    });

    it("correcting an absence to present clears its justification", async () => {
      const id = await insertStudentAttendance(dataSource, {
        lessonId,
        enrollmentId: ana.enrollmentId,
        status: "absent",
        signedById: monitor.id,
        justification: { reason: "health", note: "Consulta.", justifiedById: monitor.id },
      });

      const res = await correct(director, id, {
        status: "present",
        reason: "Chegou depois da chamada.",
      }).expect(200);

      expect(res.body).toMatchObject({ status: "present", justified: false, justification: null });
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT justification_reason, justification_note, justified_by_id, justified_at
           FROM student_attendance WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([
        {
          justification_reason: null,
          justification_note: null,
          justified_by_id: null,
          justified_at: null,
        },
      ]);
    });

    it("answers 400 STUDENT_ATTENDANCE_STATUS_UNCHANGED for the same status, 403 FORBIDDEN to a member (allocated or not) and 409 LESSON_CANCELLED", async () => {
      const id = await presenceOf(ana);

      const unchanged = await correct(coordinator, id, {
        status: "present",
        reason: "Nada muda.",
      }).expect(400);
      expect(unchanged.body).toEqual({
        error: "STUDENT_ATTENDANCE_STATUS_UNCHANGED",
        message: "The attendance already has this status.",
        details: [{ field: "status", message: "must differ from the current status" }],
      });

      for (const actor of [monitor, teacher, outsider]) {
        const forbidden = await correct(actor, id, { status: "absent", reason: "Engano." }).expect(
          403,
        );
        expect(forbidden.body.error).toBe("FORBIDDEN");
      }

      await lessonsService.cancel(lessonId, { reason: "Feriado." }, coordinator.id);
      const cancelled = await correct(coordinator, id, {
        status: "absent",
        reason: "Engano.",
      }).expect(409);
      expect(cancelled.body.error).toBe("LESSON_CANCELLED");
      expect(await correctionRows(id)).toEqual([]);
    });

    it("emits STUDENT_ATTENDANCE_CORRECTED without the reason", async () => {
      const id = await presenceOf(ana);
      const events = collectEvents();

      await correct(coordinator, id, { status: "absent", reason: "Problema de saúde." }).expect(
        200,
      );

      const [event] = studentEvents(events);
      expect(event.action).toBe(AuditableAction.STUDENT_ATTENDANCE_CORRECTED);
      expect(event.targetId).toBe(id);
      expect(event.before).toEqual({ status: "present", justified: false });
      expect(event.after).toEqual({
        status: "absent",
        justified: false,
        correctionId: expect.any(String),
        correctedAt: NOW,
      });
      expect(JSON.stringify(event)).not.toContain("saúde");
    });
  });
});
