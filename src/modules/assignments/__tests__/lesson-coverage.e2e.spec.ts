/**
 * E2e spec for the coverage of the lessons (F5.4) — GUS-158.
 *
 * CA3: the coverage of `GET /lessons/:id` changes when an assignment is confirmed or cancelled
 * R4:  the counter counts the confirmed staff of several lessons in ONE call, for the listing and
 *      the calendar of the GUS-153, and leaves out the lessons without staff
 *
 * The coverage lives in the answer of the lessons, but what it counts is in the assignments, so the
 * test is here, in the module that implements the port: it boots `lessons` and `assignments`
 * together, and the counter plugs itself in the `LessonCoverageRegistry` when the app starts.
 *
 * The scenery comes from the services that the other modules export. Sessions are cookies signed
 * with the JwtService (no login).
 */
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
import { AuthModule } from "@modules/auth/auth.module";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { CoursesService } from "@modules/catalog/services/courses.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { LessonCoverageRegistry } from "@modules/lessons/services/lesson-coverage.registry";
import { LessonsService } from "@modules/lessons/services/lessons.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { AssignmentsModule } from "../assignments.module";
import {
  assignmentBody,
  CLASS_PERIOD,
  insertAssignment,
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

process.env.JWT_SECRET = "e2e-lesson-coverage-secret";

const SESSION_COOKIE_NAME = "tedi_session";

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

interface Coverage {
  teacher: { confirmed: number; expected: number };
  monitors: { confirmed: number; expected: number | null };
}

interface AssignmentBody {
  id: string;
  status: string;
}

describe("coverage of the lessons (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonsService: LessonsService;
  let registry: LessonCoverageRegistry;

  let director: Actor;
  let coordinator: Actor;
  let member: Actor;

  let ana: Member;
  let bruno: Member;
  let carla: Member;
  let diego: Member;
  let classId: string;
  /** A lesson that expects two monitors. */
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
    // init() is what runs onModuleInit: the counter registers itself in the registry here.
    await app.init();

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    jwtService = module.get(JwtService);
    coursesService = module.get(CoursesService);
    classesService = module.get(ClassesService);
    lessonsService = module.get(LessonsService);
    registry = module.get(LessonCoverageRegistry);
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
    member = await createActor("Member", Role.MEMBER);

    ana = await createMember("Ana Torres");
    bruno = await createMember("Bruno Lima");
    carla = await createMember("Carla Menezes");
    diego = await createMember("Diego Rocha");

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
    lessonId = await createLesson({ expectedMonitors: 2 });
  });

  // ---------------------------------------------------------------------------
  // Scenery and helpers
  // ---------------------------------------------------------------------------

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  async function createMember(name: string): Promise<Member> {
    const person = await peopleService.save({ name, role: Role.MEMBER, accessEnabled: true });
    return { id: person.id, name };
  }

  async function createLesson(overrides: Record<string, unknown> = {}): Promise<string> {
    const lesson = await lessonsService.create(
      lessonBody({ classId, ...overrides }) as unknown as CreateLessonInput,
      director.id,
    );
    return lesson.id;
  }

  async function assign(
    who: Member,
    role: "teacher" | "monitor",
    status: "pending" | "confirmed",
    forLessonId: string = lessonId,
  ): Promise<AssignmentBody> {
    const res = await request(app.getHttpServer())
      .post(`/lessons/${forLessonId}/assignments`)
      .set("Cookie", director.cookie)
      .send(assignmentBody({ personId: who.id, role, status }))
      .expect(201);
    return res.body as AssignmentBody;
  }

  function confirm(id: string) {
    return request(app.getHttpServer())
      .patch(`/assignments/${id}/confirm`)
      .set("Cookie", coordinator.cookie)
      .expect(200);
  }

  function cancel(id: string) {
    return request(app.getHttpServer())
      .patch(`/assignments/${id}/cancel`)
      .set("Cookie", coordinator.cookie)
      .expect(200);
  }

  /** What `GET /lessons/:id` answers about the staff, read by a member: every profile sees it. */
  async function coverageOf(
    forLessonId: string = lessonId,
  ): Promise<{ coverage: Coverage; belowExpectedMonitors: boolean }> {
    const res = await request(app.getHttpServer())
      .get(`/lessons/${forLessonId}`)
      .set("Cookie", member.cookie)
      .expect(200);
    const body = res.body as { coverage: Coverage; belowExpectedMonitors: boolean };
    return { coverage: body.coverage, belowExpectedMonitors: body.belowExpectedMonitors };
  }

  function coverage(
    teacherConfirmed: number,
    monitorsConfirmed: number,
    expectedMonitors: number | null,
  ): Coverage {
    return {
      teacher: { confirmed: teacherConfirmed, expected: 1 },
      monitors: { confirmed: monitorsConfirmed, expected: expectedMonitors },
    };
  }

  // ---------------------------------------------------------------------------
  // CA3
  // ---------------------------------------------------------------------------

  describe("GET /lessons/:id", () => {
    it("answers zero confirmed staff for a lesson without assignments", async () => {
      expect(await coverageOf()).toEqual({
        coverage: coverage(0, 0, 2),
        belowExpectedMonitors: true,
      });
    });

    it("raises coverage of GET /lessons/:id when a pending assignment is confirmed", async () => {
      const teacher = await assign(ana, "teacher", "pending");
      const monitor = await assign(bruno, "monitor", "pending");
      // Pending is not staff yet: nothing changes in the coverage.
      expect(await coverageOf()).toEqual({
        coverage: coverage(0, 0, 2),
        belowExpectedMonitors: true,
      });

      await confirm(teacher.id);
      expect(await coverageOf()).toEqual({
        coverage: coverage(1, 0, 2),
        belowExpectedMonitors: true,
      });

      await confirm(monitor.id);
      expect(await coverageOf()).toEqual({
        coverage: coverage(1, 1, 2),
        belowExpectedMonitors: true,
      });
    });

    it("lowers it when a confirmed assignment is cancelled", async () => {
      await assign(ana, "teacher", "confirmed");
      const first = await assign(bruno, "monitor", "confirmed");
      await assign(carla, "monitor", "confirmed");
      expect(await coverageOf()).toEqual({
        coverage: coverage(1, 2, 2),
        belowExpectedMonitors: false,
      });

      await cancel(first.id);

      expect(await coverageOf()).toEqual({
        coverage: coverage(1, 1, 2),
        belowExpectedMonitors: true,
      });
    });

    it("lowers the teacher side when the confirmed teacher is cancelled, and a new one raises it again", async () => {
      const teacher = await assign(ana, "teacher", "confirmed");
      expect((await coverageOf()).coverage.teacher).toEqual({ confirmed: 1, expected: 1 });

      await cancel(teacher.id);
      expect((await coverageOf()).coverage.teacher).toEqual({ confirmed: 0, expected: 1 });

      await assign(bruno, "teacher", "confirmed");
      expect((await coverageOf()).coverage.teacher).toEqual({ confirmed: 1, expected: 1 });
    });

    it("counts a teacher and the monitors apart and sets belowExpectedMonitors", async () => {
      // A teacher alone does not make up for a monitor that is missing.
      await assign(ana, "teacher", "confirmed");
      expect(await coverageOf()).toEqual({
        coverage: coverage(1, 0, 2),
        belowExpectedMonitors: true,
      });

      await assign(bruno, "monitor", "confirmed");
      expect(await coverageOf()).toEqual({
        coverage: coverage(1, 1, 2),
        belowExpectedMonitors: true,
      });

      await assign(carla, "monitor", "confirmed");
      expect(await coverageOf()).toEqual({
        coverage: coverage(1, 2, 2),
        belowExpectedMonitors: false,
      });

      // More monitors than expected is not below it either.
      await assign(diego, "monitor", "confirmed");
      expect(await coverageOf()).toEqual({
        coverage: coverage(1, 3, 2),
        belowExpectedMonitors: false,
      });
    });

    it("counts only confirmed assignments: a pending, a cancelled and a declined one do not count", async () => {
      await assign(ana, "monitor", "pending");
      const cancelled = await assign(bruno, "monitor", "confirmed");
      await cancel(cancelled.id);
      await insertAssignment(dataSource, {
        lessonId,
        personId: carla.id,
        createdById: carla.id,
        status: "declined",
        source: "application",
        reviewedById: coordinator.id,
        reviewedAt: new Date(),
      });
      await assign(diego, "monitor", "confirmed");

      expect(await coverageOf()).toEqual({
        coverage: coverage(0, 1, 2),
        belowExpectedMonitors: true,
      });
    });

    it("does not count a soft-deleted assignment", async () => {
      const monitor = await assign(ana, "monitor", "confirmed");
      expect((await coverageOf()).coverage.monitors.confirmed).toBe(1);

      await dataSource.query(`UPDATE lesson_assignments SET deleted_at = now() WHERE id = $1`, [
        monitor.id,
      ]);

      expect((await coverageOf()).coverage.monitors.confirmed).toBe(0);
    });

    it("counts the staff of each lesson apart", async () => {
      const otherLesson = await createLesson({ date: "2026-03-17", expectedMonitors: 1 });
      await assign(ana, "teacher", "confirmed");
      await assign(bruno, "monitor", "confirmed", otherLesson);

      expect(await coverageOf(lessonId)).toEqual({
        coverage: coverage(1, 0, 2),
        belowExpectedMonitors: true,
      });
      expect(await coverageOf(otherLesson)).toEqual({
        coverage: coverage(0, 1, 1),
        belowExpectedMonitors: false,
      });
    });

    it("is never below the expectation for a lesson that does not say how many monitors it expects", async () => {
      const open = await createLesson({ date: "2026-03-17" });

      expect(await coverageOf(open)).toEqual({
        coverage: coverage(0, 0, null),
        belowExpectedMonitors: false,
      });

      await assign(ana, "monitor", "confirmed", open);
      expect(await coverageOf(open)).toEqual({
        coverage: coverage(0, 1, null),
        belowExpectedMonitors: false,
      });
    });

    it("is not below the expectation for a lesson that expects zero monitors", async () => {
      const none = await createLesson({ date: "2026-03-17", expectedMonitors: 0 });

      expect(await coverageOf(none)).toEqual({
        coverage: coverage(0, 0, 0),
        belowExpectedMonitors: false,
      });
    });

    it("keeps belowExpectedMonitors false for a cancelled lesson, though it shows who was confirmed", async () => {
      await assign(ana, "teacher", "confirmed");
      await assign(bruno, "monitor", "confirmed");
      expect((await coverageOf()).belowExpectedMonitors).toBe(true);

      await lessonsService.cancel(lessonId, { reason: "Feriado." }, director.id);

      // Cancelling the lesson does not cancel its assignments: the coverage shows them, and does
      // not report a shortage in a lesson that does not happen.
      expect(await coverageOf()).toEqual({
        coverage: coverage(1, 1, 2),
        belowExpectedMonitors: false,
      });
    });

    it("follows an edit of expectedMonitors: the expectation is the one of the lesson now", async () => {
      await assign(ana, "monitor", "confirmed");
      expect((await coverageOf()).belowExpectedMonitors).toBe(true);

      await request(app.getHttpServer())
        .patch(`/lessons/${lessonId}`)
        .set("Cookie", director.cookie)
        .send({ expectedMonitors: 1 })
        .expect(200);

      expect(await coverageOf()).toEqual({
        coverage: coverage(0, 1, 1),
        belowExpectedMonitors: false,
      });
    });
  });

  describe("the other routes of the lessons", () => {
    it("shows the coverage in the answer of every route of the lessons, from the creation to the cancellation", async () => {
      // Creation: nobody is assigned to a lesson that was just created.
      const created = await request(app.getHttpServer())
        .post("/lessons")
        .set("Cookie", director.cookie)
        .send(lessonBody({ classId, date: "2026-03-17", expectedMonitors: 1 }))
        .expect(201);
      const id = (created.body as { id: string }).id;
      expect(created.body).toMatchObject({
        coverage: coverage(0, 0, 1),
        belowExpectedMonitors: true,
      });

      await assign(ana, "teacher", "confirmed", id);
      await assign(bruno, "monitor", "confirmed", id);

      const edited = await request(app.getHttpServer())
        .patch(`/lessons/${id}`)
        .set("Cookie", director.cookie)
        .send({ subject: "Primeiro contato" })
        .expect(200);
      expect(edited.body).toMatchObject({
        coverage: coverage(1, 1, 1),
        belowExpectedMonitors: false,
      });

      const rescheduled = await request(app.getHttpServer())
        .patch(`/lessons/${id}/reschedule`)
        .set("Cookie", director.cookie)
        .send({ date: "2026-03-24", startTime: "09:00", endTime: "10:30" })
        .expect(200);
      // The staff goes with the lesson to its new day.
      expect(rescheduled.body).toMatchObject({
        date: "2026-03-24",
        coverage: coverage(1, 1, 1),
        belowExpectedMonitors: false,
      });

      const cancelled = await request(app.getHttpServer())
        .patch(`/lessons/${id}/cancel`)
        .set("Cookie", director.cookie)
        .send({ reason: "Feriado municipal." })
        .expect(200);
      expect(cancelled.body).toMatchObject({
        status: "cancelled",
        coverage: coverage(1, 1, 1),
        belowExpectedMonitors: false,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // R4: the batch, for the listing and the calendar of the GUS-153
  // ---------------------------------------------------------------------------

  describe("LessonCoverageRegistry.countConfirmedStaff", () => {
    it("counts the confirmed staff of several lessons in one call and leaves out lessons without staff", async () => {
      const second = await createLesson({ date: "2026-03-17" });
      const third = await createLesson({ date: "2026-03-24" });
      await assign(ana, "teacher", "confirmed");
      await assign(bruno, "monitor", "confirmed");
      await assign(carla, "monitor", "confirmed");
      await assign(diego, "monitor", "pending");
      await assign(bruno, "monitor", "confirmed", second);

      const queries: string[] = [];
      const logQuery = jest
        .spyOn(dataSource.logger, "logQuery")
        .mockImplementation((query: string) => {
          queries.push(query);
        });
      let counts: Map<string, { teachers: number; monitors: number }>;
      try {
        counts = await registry.countConfirmedStaff([lessonId, second, third]);
      } finally {
        logQuery.mockRestore();
      }

      expect(counts.get(lessonId)).toEqual({ teachers: 1, monitors: 2 });
      expect(counts.get(second)).toEqual({ teachers: 0, monitors: 1 });
      // The lesson with nobody confirmed is not in the map: the caller reads it as no staff.
      expect(counts.has(third)).toBe(false);
      expect(counts.size).toBe(2);
      // One aggregated query for the three lessons, not one per lesson.
      expect(queries.filter((query) => query.includes('"lesson_assignments"'))).toHaveLength(1);
    });

    it("answers an empty map for no lesson at all, and does not query", async () => {
      const queries: string[] = [];
      const logQuery = jest
        .spyOn(dataSource.logger, "logQuery")
        .mockImplementation((query: string) => {
          queries.push(query);
        });
      try {
        expect((await registry.countConfirmedStaff([])).size).toBe(0);
        expect((await registry.countConfirmedStaff(["not-a-uuid"])).size).toBe(0);
      } finally {
        logQuery.mockRestore();
      }

      expect(queries).toHaveLength(0);
    });

    it("counts a repeated lesson once, and ignores an id that is not a lesson", async () => {
      await assign(ana, "teacher", "confirmed");

      const counts = await registry.countConfirmedStaff([
        lessonId,
        lessonId,
        "01999a3e-0000-7000-8000-000000000000",
      ]);

      expect(counts.size).toBe(1);
      expect(counts.get(lessonId)).toEqual({ teachers: 1, monitors: 0 });
    });

    it("counts inside the transaction it is given: what was written there and not committed yet is seen only there", async () => {
      await dataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO lesson_assignments
             (id, lesson_id, person_id, role, status, created_by_id, reviewed_by_id, reviewed_at)
           VALUES (gen_random_uuid(), $1, $2, 'monitor', 'confirmed', $3, $3, now())`,
          [lessonId, ana.id, director.id],
        );

        const inside = await registry.countConfirmedStaff([lessonId], manager);
        const outside = await registry.countConfirmedStaff([lessonId]);

        expect(inside.get(lessonId)).toEqual({ teachers: 0, monitors: 1 });
        expect(outside.has(lessonId)).toBe(false);
      });

      expect((await registry.countConfirmedStaff([lessonId])).get(lessonId)).toEqual({
        teachers: 0,
        monitors: 1,
      });
    });
  });
});
