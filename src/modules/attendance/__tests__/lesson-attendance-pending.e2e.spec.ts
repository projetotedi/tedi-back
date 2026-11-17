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
import { EnrollmentStatus } from "@modules/classes/services/enrollment-roster.service";
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

process.env.JWT_SECRET = "e2e-lesson-attendance-pending-secret";

const SESSION_COOKIE_NAME = "tedi_session";

/** 20:00 of 2026-03-10 in America/Sao_Paulo: the lesson of 09:00 to 11:00 that day is over. */
const EVENING = new Date("2026-03-10T23:00:00.000Z");

const ROUTES = ["/lessons", "/lessons/calendar"] as const;
type Route = (typeof ROUTES)[number];

/** The month grid of the scenery: 42 days, both ends counted. */
const GRID = { from: "2026-03-01", to: "2026-04-11" } as const;

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

interface Attendance {
  students: { total: number; signed: number };
  pending: boolean;
}

interface ItemBody {
  id: string;
  attendancePending: boolean;
}

/**
 * The roll call of the students seen from the lessons (GUS-166, CA4): `attendance` of every answer
 * of a lesson and `attendancePending` of the list and the calendar, which `lessons` gets through the
 * port the attendance module implements (`LessonRollCallRegistry`). The flow between the two
 * modules is tested here, in the module that implements the port. The clock of the app is fixed,
 * and each test moves it.
 */
describe("lesson attendance pending (e2e)", () => {
  let module: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonsService: LessonsService;
  let now: Date;

  let coordinator: Actor;
  let member: Actor;
  let courseId: string;
  let classId: string;
  let lessonId: string;
  let ana: Student;
  let bruno: Student;

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
      // Every module that provides a Clock gets this one, read at each call: a test moves `now`.
      .overrideProvider(Clock)
      .useValue({ now: () => new Date(now) })
      .compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    // init() only, once: the counter of the roll call registers itself in the registry here.
    await app.init();

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
    now = EVENING;
    await dataSource.query(
      `TRUNCATE TABLE attendance_corrections, student_attendance, member_attendance,
                      hour_entry_events, hour_entries, lesson_assignments, enrollments, lessons,
                      classes, editions, course_lesson_plans, lesson_plan_contents, lesson_plans,
                      course_prerequisites, courses, student_profiles, invites, departments, people
       RESTART IDENTITY CASCADE`,
    );

    coordinator = await createActor("Coordenadora", Role.COORDINATOR);
    member = await createActor("Membro", Role.MEMBER);
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
    ana = await enroll("Ana Souza");
    bruno = await enroll("Bruno Lima");
  });

  // ---------------------------------------------------------------------------
  // Scenery and helpers
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

  /** A lesson from 09:00 to 11:00 on 2026-03-10, unless `overrides` says otherwise. */
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

  /** A student enrolled in the class on 2026-03-03, unless `values` says otherwise. */
  async function enroll(
    name: string,
    values: { enrolledAt?: Date; status?: EnrollmentStatus; statusChangedAt?: string } = {},
  ): Promise<Student> {
    const studentId = await insertStudent(dataSource, { name, createdById: coordinator.id });
    const enrollmentId = await insertEnrollment(dataSource, {
      classId,
      studentId,
      createdById: coordinator.id,
      enrolledAt: values.enrolledAt ?? FIRST_ENROLLED_AT,
      status: values.status,
      statusChangedAt: values.statusChangedAt,
    });
    return { id: studentId, enrollmentId };
  }

  function sign(forLessonId: string, entries: Array<[Student, "present" | "absent"]>) {
    return request(app.getHttpServer())
      .put(`/lessons/${forLessonId}/attendance/students`)
      .set("Cookie", coordinator.cookie)
      .send({
        entries: entries.map(([student, status]) => ({
          enrollmentId: student.enrollmentId,
          status,
        })),
      })
      .expect(200);
  }

  /** `attendance` of `GET /lessons/:id`, read by a member: every profile reads a lesson. */
  async function attendanceOf(forLessonId: string = lessonId): Promise<Attendance> {
    const res = await request(app.getHttpServer())
      .get(`/lessons/${forLessonId}`)
      .set("Cookie", member.cookie)
      .expect(200);
    return (res.body as { attendance: Attendance }).attendance;
  }

  async function itemsOf(route: Route): Promise<ItemBody[]> {
    if (route === "/lessons") {
      const res = await request(app.getHttpServer())
        .get("/lessons")
        .query({ limit: 100, classId })
        .set("Cookie", member.cookie)
        .expect(200);
      return (res.body as { data: ItemBody[] }).data;
    }
    const res = await request(app.getHttpServer())
      .get("/lessons/calendar")
      .query({ ...GRID, classId })
      .set("Cookie", member.cookie)
      .expect(200);
    return res.body as ItemBody[];
  }

  // ---------------------------------------------------------------------------
  // The tests
  // ---------------------------------------------------------------------------

  it("CA4: an ended lesson with unsigned students answers attendance.pending true in GET /lessons/:id, and false once every student is signed", async () => {
    expect(await attendanceOf()).toEqual({ students: { total: 2, signed: 0 }, pending: true });

    await sign(lessonId, [[ana, "present"]]);
    expect(await attendanceOf()).toEqual({ students: { total: 2, signed: 1 }, pending: true });

    await sign(lessonId, [[bruno, "absent"]]);
    expect(await attendanceOf()).toEqual({ students: { total: 2, signed: 2 }, pending: false });
  });

  it("answers students.total and signed of the roll call: a student enrolled after the day is out; a retroactive drop with a signature counts in both", async () => {
    await enroll("Carla Tardia", { enrolledAt: new Date("2026-03-12T13:00:00.000Z") });
    expect((await attendanceOf()).students).toEqual({ total: 2, signed: 0 });

    // Signed in the lesson, then dropped "from 2026-03-05": no longer expected on 2026-03-10, but
    // the signature keeps her in the roll call of the lesson.
    const diego = await enroll("Diego Rocha", {
      status: EnrollmentStatus.DROPPED,
      statusChangedAt: "2026-03-05",
    });
    await insertStudentAttendance(dataSource, {
      lessonId,
      enrollmentId: diego.enrollmentId,
      status: "present",
      signedById: coordinator.id,
    });
    expect(await attendanceOf()).toEqual({ students: { total: 3, signed: 1 }, pending: true });

    await sign(lessonId, [
      [ana, "present"],
      [bruno, "present"],
    ]);
    expect(await attendanceOf()).toEqual({ students: { total: 3, signed: 3 }, pending: false });
  });

  it("is not pending for a cancelled lesson, a lesson of today before its endTime, a lesson after today and a lesson without students", async () => {
    const cancelled = await createLesson({ date: "2026-03-09" });
    await lessonsService.cancel(cancelled, { reason: "Feriado." }, coordinator.id);
    const tonight = await createLesson({ startTime: "21:00", endTime: "22:00" });
    const tomorrow = await createLesson({ date: "2026-03-11" });
    const emptyClass = await createClass("INFO-B");
    const empty = await createLesson({ classId: emptyClass, date: "2026-03-09" });

    expect(await attendanceOf(cancelled)).toEqual({
      students: { total: 2, signed: 0 },
      pending: false,
    });
    expect(await attendanceOf(tonight)).toEqual({
      students: { total: 2, signed: 0 },
      pending: false,
    });
    expect(await attendanceOf(tomorrow)).toEqual({
      students: { total: 2, signed: 0 },
      pending: false,
    });
    expect(await attendanceOf(empty)).toEqual({
      students: { total: 0, signed: 0 },
      pending: false,
    });
  });

  it("turns pending at endTime of the day of the lesson in America/Sao_Paulo", async () => {
    // 10:59 in São Paulo: the lesson of 09:00 to 11:00 is still under way.
    now = new Date("2026-03-10T13:59:00.000Z");
    expect((await attendanceOf()).pending).toBe(false);

    // 11:00 in São Paulo, 14:00 in UTC: it ended.
    now = new Date("2026-03-10T14:00:00.000Z");
    expect((await attendanceOf()).pending).toBe(true);
  });

  it.each(ROUTES)("%s answers attendancePending lesson by lesson", async (route) => {
    const tomorrow = await createLesson({ date: "2026-03-11" });
    const complete = await createLesson({ date: "2026-03-09" });
    await sign(complete, [
      [ana, "present"],
      [bruno, "absent"],
    ]);

    const items = await itemsOf(route);

    expect(items.map((item) => [item.id, item.attendancePending])).toEqual([
      [complete, false],
      [lessonId, true],
      [tomorrow, false],
    ]);
  });

  it("the writes of a lesson answer attendance too: PATCH /lessons/:id and POST /lessons of a past date in a class with students", async () => {
    const patched = await request(app.getHttpServer())
      .patch(`/lessons/${lessonId}`)
      .set("Cookie", coordinator.cookie)
      .send({ title: "Novo título" })
      .expect(200);
    expect(patched.body.attendance).toEqual({ students: { total: 2, signed: 0 }, pending: true });

    const created = await request(app.getHttpServer())
      .post("/lessons")
      .set("Cookie", coordinator.cookie)
      .send(lessonBody({ classId, date: "2026-03-09", startTime: "09:00", endTime: "11:00" }))
      .expect(201);
    expect(created.body.attendance).toEqual({ students: { total: 2, signed: 0 }, pending: true });
  });
});
