import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
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
import { Clock } from "@shared/dates/clock";
import { Role } from "@shared/enums/role.enum";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { AttendanceModule } from "../attendance.module";
import {
  CLASS_PERIOD,
  FIRST_ENROLLED_AT,
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

process.env.JWT_SECRET = "e2e-enrollment-attendance-secret";

const SESSION_COOKIE_NAME = "tedi_session";

/** 20:00 of 2026-03-10 in America/Sao_Paulo: the lessons of the scenery are over. */
const NOW = new Date("2026-03-10T23:00:00.000Z");

type CreateCourseInput = Parameters<CoursesService["create"]>[0];
type CreateLessonInput = Parameters<LessonsService["create"]>[0];

interface Actor {
  id: string;
  cookie: string;
}

interface Student {
  id: string;
  enrollmentId: string;
}

interface ClassEnrollmentItem {
  id: string;
  attendanceRate: number | null;
}

interface HistoryItem {
  id: string;
  class: { id: string };
  attendanceRate: number | null;
}

/**
 * The attendance seen from the enrollments (GUS-166): the attendance rate of the list of a class and
 * of the history of a student, and the removal of an enrollment with attendance, which `classes`
 * gets through the port the attendance module implements (`EnrollmentAttendanceRegistry`). The flow
 * between the two modules is tested here, in the module that implements the port. The app listens
 * on a port of its own: the races hold a transaction while a request runs.
 */
describe("enrollment attendance (e2e)", () => {
  let module: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonsService: LessonsService;

  let coordinator: Actor;
  let courseId: string;
  let classId: string;
  let firstLesson: string;
  let secondLesson: string;
  let thirdLesson: string;
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
      .overrideProvider(Clock)
      .useValue({ now: () => new Date(NOW) })
      .compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    // init() only, once: the reader of the attendance registers itself in the registry here.
    await app.init();
    await app.listen(0);

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    jwtService = module.get(JwtService);
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

    const person = await peopleService.save({
      name: "Coordenadora",
      role: Role.COORDINATOR,
      accessEnabled: true,
    });
    coordinator = {
      id: person.id,
      cookie: `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: person.id })}`,
    };
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
    firstLesson = await createLesson(classId, "2026-03-03");
    secondLesson = await createLesson(classId, "2026-03-05");
    thirdLesson = await createLesson(classId, "2026-03-10");
    ana = await enroll(classId, "Ana Souza");
    bruno = await enroll(classId, "Bruno Lima");
    carla = await enroll(classId, "Carla Dias");
  });

  // ---------------------------------------------------------------------------
  // Scenery and helpers
  // ---------------------------------------------------------------------------

  async function createClass(code: string): Promise<string> {
    const schoolClass = await classesService.create(
      { courseId, code, editionName: "2026.1", ...CLASS_PERIOD, capacity: 15 },
      coordinator.id,
    );
    return schoolClass.id;
  }

  async function createLesson(forClassId: string, date: string): Promise<string> {
    const lesson = await lessonsService.create(
      lessonBody({
        classId: forClassId,
        date,
        startTime: "09:00",
        endTime: "11:00",
      }) as unknown as CreateLessonInput,
      coordinator.id,
    );
    return lesson.id;
  }

  async function enroll(forClassId: string, name: string, studentId?: string): Promise<Student> {
    const id =
      studentId ?? (await insertStudent(dataSource, { name, createdById: coordinator.id }));
    const enrollmentId = await insertEnrollment(dataSource, {
      classId: forClassId,
      studentId: id,
      createdById: coordinator.id,
      enrolledAt: FIRST_ENROLLED_AT,
    });
    return { id, enrollmentId };
  }

  function signed(
    lessonId: string,
    student: Student,
    status: "present" | "absent",
    justified = false,
  ): Promise<string> {
    return insertStudentAttendance(dataSource, {
      lessonId,
      enrollmentId: student.enrollmentId,
      status,
      signedById: coordinator.id,
      ...(justified
        ? { justification: { reason: "health" as const, justifiedById: coordinator.id } }
        : {}),
    });
  }

  async function ratesOfClass(forClassId = classId): Promise<Map<string, number | null>> {
    const res = await request(app.getHttpServer())
      .get(`/classes/${forClassId}/enrollments`)
      .query({ limit: 100 })
      .set("Cookie", coordinator.cookie)
      .expect(200);
    const items = (res.body as { data: ClassEnrollmentItem[] }).data;
    return new Map(items.map((item) => [item.id, item.attendanceRate]));
  }

  function removeEnrollment(enrollmentId: string) {
    return request(app.getHttpServer())
      .delete(`/enrollments/${enrollmentId}`)
      .set("Cookie", coordinator.cookie);
  }

  async function isRemoved(enrollmentId: string): Promise<boolean> {
    const rows: Array<{ deleted_at: Date | null }> = await dataSource.query(
      `SELECT deleted_at FROM enrollments WHERE id = $1`,
      [enrollmentId],
    );
    return rows[0].deleted_at !== null;
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

  /** Holds the class in a transaction of its own, with the lock that is asked; `release` commits. */
  async function holdClass(lock: string) {
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(`SELECT id FROM classes WHERE id = $1 ${lock}`, [classId]);

    return {
      run: (sql: string, parameters: unknown[]) => holder.query(sql, parameters),
      release: async () => {
        await holder.commitTransaction();
        await holder.release();
      },
    };
  }

  // ---------------------------------------------------------------------------
  // The tests
  // ---------------------------------------------------------------------------

  it("GET /classes/:id/enrollments answers attendanceRate as presences over the recorded roll calls, a justified absence counting as an absence, and null without any", async () => {
    await signed(firstLesson, ana, "present");
    await signed(secondLesson, ana, "absent", true);
    await signed(firstLesson, bruno, "present");
    await signed(secondLesson, bruno, "present");
    await signed(thirdLesson, bruno, "absent");

    const rates = await ratesOfClass();

    expect(rates.get(ana.enrollmentId)).toBe(0.5);
    expect(rates.get(bruno.enrollmentId)).toBe(0.67);
    expect(rates.get(carla.enrollmentId)).toBeNull();
  });

  it("leaves the roll calls of a lesson cancelled afterwards out of attendanceRate", async () => {
    await signed(firstLesson, ana, "present");
    await signed(secondLesson, ana, "absent");
    await signed(secondLesson, bruno, "present");
    expect((await ratesOfClass()).get(ana.enrollmentId)).toBe(0.5);

    await lessonsService.cancel(secondLesson, { reason: "Feriado." }, coordinator.id);

    const rates = await ratesOfClass();
    expect(rates.get(ana.enrollmentId)).toBe(1);
    // Bruno's only roll call was in the cancelled lesson: no rate at all.
    expect(rates.get(bruno.enrollmentId)).toBeNull();
  });

  it("GET /students/:id/enrollments answers attendanceRate per enrollment", async () => {
    const otherClass = await createClass("INFO-B");
    const otherLesson = await createLesson(otherClass, "2026-03-04");
    const anaElsewhere = await enroll(otherClass, "Ana Souza", ana.id);
    await signed(firstLesson, ana, "present");
    await signed(secondLesson, ana, "absent");
    await signed(otherLesson, anaElsewhere, "present");

    const res = await request(app.getHttpServer())
      .get(`/students/${ana.id}/enrollments`)
      .set("Cookie", coordinator.cookie)
      .expect(200);

    const items = (res.body as { enrollments: HistoryItem[] }).enrollments;
    expect(new Map(items.map((item) => [item.class.id, item.attendanceRate]))).toEqual(
      new Map([
        [classId, 0.5],
        [otherClass, 1],
      ]),
    );

    const brunoRes = await request(app.getHttpServer())
      .get(`/students/${bruno.id}/enrollments`)
      .set("Cookie", coordinator.cookie)
      .expect(200);
    expect(
      (brunoRes.body as { enrollments: HistoryItem[] }).enrollments.map(
        (item) => item.attendanceRate,
      ),
    ).toEqual([null]);
  });

  it("DELETE /enrollments/:id of an active enrollment with attendance answers 409 ENROLLMENT_NOT_REMOVABLE and keeps it; one without attendance is removed (204)", async () => {
    await signed(firstLesson, ana, "absent");

    const refused = await removeEnrollment(ana.enrollmentId).expect(409);
    expect(refused.body).toEqual({
      statusCode: 409,
      error: "ENROLLMENT_NOT_REMOVABLE",
      message: "An enrollment with attendance cannot be removed; change its status instead.",
    });
    expect(await isRemoved(ana.enrollmentId)).toBe(false);

    await removeEnrollment(carla.enrollmentId).expect(204);
    expect(await isRemoved(carla.enrollmentId)).toBe(true);
  });

  it("race: the removal waits for a signature in progress and answers 409 ENROLLMENT_NOT_REMOVABLE", async () => {
    // A roll call holds the class FOR SHARE and inserts the attendance before it commits.
    const rollCall = await holdClass("FOR SHARE");
    await rollCall.run(
      `INSERT INTO student_attendance (id, lesson_id, enrollment_id, status, signed_by_id, signed_at)
       VALUES (gen_random_uuid(), $1, $2, 'present', $3, now())`,
      [thirdLesson, ana.enrollmentId, coordinator.id],
    );

    const pending = removeEnrollment(ana.enrollmentId).then((res) => res);

    try {
      // The removal locks the class FOR UPDATE first, and waits for the roll call.
      expect(await blockedStatement()).toMatch(/"SchoolClass"/);
      expect(await isRemoved(ana.enrollmentId)).toBe(false);
    } finally {
      await rollCall.release();
    }

    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ENROLLMENT_NOT_REMOVABLE");
    expect(await isRemoved(ana.enrollmentId)).toBe(false);
  });

  it("race: a signature waits for the removal of the enrollment and answers 400 ENROLLMENT_NOT_IN_ROLL_CALL", async () => {
    // A removal holds the class FOR UPDATE and soft-deletes the enrollment before it commits.
    const removal = await holdClass("FOR UPDATE");
    await removal.run(
      `UPDATE enrollments SET deleted_at = now(), updated_at = now() WHERE id = $1`,
      [ana.enrollmentId],
    );

    const pending = request(app.getHttpServer())
      .put(`/lessons/${thirdLesson}/attendance/students`)
      .set("Cookie", coordinator.cookie)
      .send({ entries: [{ enrollmentId: ana.enrollmentId, status: "present" }] })
      .then((res) => res);

    try {
      // The roll call locks the lesson, then the class FOR SHARE, and waits for the removal.
      expect(await blockedStatement()).toMatch(/"SchoolClass"/);
    } finally {
      await removal.release();
    }

    const res = await pending;
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ENROLLMENT_NOT_IN_ROLL_CALL");
    const rows: Array<{ total: number }> = await dataSource.query(
      `SELECT COUNT(*)::int AS total FROM student_attendance`,
    );
    expect(rows[0].total).toBe(0);
  });
});
