import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import request from "supertest";
import { DataSource } from "typeorm";
import { AuthModule } from "@modules/auth/auth.module";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { CourseLessonPlansService } from "@modules/catalog/services/course-lesson-plans.service";
import { CourseCategory, CoursesService } from "@modules/catalog/services/courses.service";
import { LessonPlansService } from "@modules/catalog/services/lesson-plans.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { ClassesModule } from "../classes.module";
import { ClassStatus } from "../enums/class-status.enum";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import {
  ActiveEnrollmentPreviewRow,
  EnrollmentCountsService,
} from "../services/enrollment-counts.service";
import {
  archiveCourse,
  insertClass,
  insertEdition,
  insertEnrollment,
  insertEnrollments,
  insertStudent,
} from "./fixtures/classes.fixture";

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

process.env.JWT_SECRET = "e2e-class-detail-secret";

const SESSION_COOKIE_NAME = "tedi_session";

interface Actor {
  id: string;
  cookie: string;
}

interface PreviewItem {
  id: string;
  student: { id: string; name: string };
  enrolledAt: string;
}

interface ClassDetailBody {
  id: string;
  code: string;
  name: string | null;
  edition: { id: string; name: string };
  startDate: string;
  endDate: string;
  location: string | null;
  capacity: number;
  status: string;
  archivedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  course: {
    id: string;
    name: string;
    category: string;
    status: string;
    lessonPlanCount: number;
    plannedWorkloadMinutes: number;
  };
  summary: {
    enrolledCount: number;
    capacity: number;
    occupancyRate: number;
    lessonsDone: number | null;
    lessonsTotal: number | null;
    averageAttendance: number | null;
  };
  enrollmentsPreview: PreviewItem[];
  enrollmentsTotal: number;
}

describe("GET /classes/:id (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let coursesService: CoursesService;
  let lessonPlansService: LessonPlansService;
  let courseLessonPlansService: CourseLessonPlansService;

  let director: Actor;
  let member: Actor;
  let courseId: string;
  let planIds: string[];
  let editionId: string;
  /** INFO-A of Informática Básica in 2026.1, with 15 seats: the class of the card. */
  let classId: string;

  // The sheet reads real enrollments (GUS-108); the spies only record the calls of the real
  // provider.
  let countActive: jest.SpyInstance;
  let listActivePreview: jest.SpyInstance;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          // Every entity: the foreign keys of the class point to other modules' tables by name.
          entities: [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
        AuthModule,
        PeopleModule,
        CatalogModule,
        ClassesModule,
      ],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    jwtService = module.get(JwtService);
    coursesService = module.get(CoursesService);
    lessonPlansService = module.get(LessonPlansService);
    courseLessonPlansService = module.get(CourseLessonPlansService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    countActive.mockRestore();
    listActivePreview.mockRestore();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE enrollments, classes, editions, course_lesson_plans, course_prerequisites,
                      courses, lesson_plan_contents, lesson_plans, student_profiles, people
       RESTART IDENTITY CASCADE`,
    );
    const counts = module.get(EnrollmentCountsService);
    countActive = jest.spyOn(counts, "countActive");
    listActivePreview = jest.spyOn(counts, "listActivePreview");

    director = await createActor("Director", Role.DIRECTOR);
    member = await createActor("Member", Role.MEMBER);

    // The scenery comes from the services that CatalogModule exports, not from its tables: the
    // sequence of 6 plans of 90 minutes is what gives the course its 540 minutes.
    courseId = await createCourse("Informática Básica");
    planIds = await createPlans(6, 90);
    await courseLessonPlansService.replace(courseId, { lessonPlanIds: planIds }, director.id);

    editionId = await insertEdition(dataSource, "2026.1");
    classId = await insertClass(dataSource, {
      courseId,
      editionId,
      createdById: director.id,
      code: "INFO-A",
      capacity: 15,
    });
  });

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  async function createCourse(name: string): Promise<string> {
    const course = await coursesService.create(
      { name, description: "Fundamentos do uso do computador.", category: CourseCategory.BASIC },
      director.id,
    );
    return course.id;
  }

  async function createPlans(count: number, minutes: number): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 1; index <= count; index++) {
      const plan = await lessonPlansService.create(
        {
          title: `Aula ${String(index)}`,
          expectedDurationMinutes: minutes,
          contents: [`Conteúdo ${String(index)}`],
        },
        director.id,
      );
      ids.push(plan.id);
    }
    return ids;
  }

  /** A student with an active enrollment in `inClassId`, enrolled at `enrolledAt` (by SQL). */
  async function createStudentRow(
    name: string,
    enrolledAt: string,
    inClassId = classId,
  ): Promise<ActiveEnrollmentPreviewRow> {
    const studentId = await insertStudent(dataSource, { name, createdById: director.id });
    const enrollmentId = await insertEnrollment(dataSource, {
      classId: inClassId,
      studentId,
      createdById: director.id,
      enrolledAt: new Date(enrolledAt),
    });
    return { enrollmentId, studentId, enrolledAt: new Date(enrolledAt) };
  }

  /** `count` students with an active enrollment in the class, enrolled one second apart. */
  function enroll(count: number, inClassId = classId): Promise<string[]> {
    return insertEnrollments(dataSource, { classId: inClassId, createdById: director.id, count });
  }

  function getClass(actor: Actor | null, id: string) {
    const req = request(app.getHttpServer()).get(`/classes/${id}`);
    return actor === null ? req : req.set("Cookie", actor.cookie);
  }

  describe("the sheet of the class", () => {
    it("answers the whole sheet of INFO-A in one call", async () => {
      const students = await enroll(12);

      const res = await getClass(director, classId).expect(200);
      const body = res.body as ClassDetailBody;

      expect(body.summary).toEqual({
        enrolledCount: 12,
        capacity: 15,
        occupancyRate: 0.8,
        lessonsDone: null,
        lessonsTotal: null,
        averageAttendance: null,
      });
      expect(body.course).toEqual({
        id: courseId,
        name: "Informática Básica",
        category: "basic",
        status: "active",
        lessonPlanCount: 6,
        plannedWorkloadMinutes: 540,
      });
      expect(body.edition).toEqual({ id: editionId, name: "2026.1" });
      expect(body.edition.name).toBe("2026.1");
      expect(body.createdBy).toEqual({ id: director.id, name: "Director" });
      expect(body.enrollmentsTotal).toBe(12);
      // The 5 earliest, in the order enrolledAt, then id.
      expect(body.enrollmentsPreview.map((item) => item.student)).toEqual(
        students.slice(0, 5).map((id, index) => ({ id, name: `Student 0${String(index + 1)}` })),
      );
      expect(body).toMatchObject({
        id: classId,
        code: "INFO-A",
        name: null,
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        location: null,
        capacity: 15,
        status: "planned",
        archivedAt: null,
      });
      expect(typeof body.createdAt).toBe("string");
      expect(Object.keys(body).sort()).toEqual([
        "archivedAt",
        "capacity",
        "code",
        "course",
        "createdAt",
        "createdBy",
        "edition",
        "endDate",
        "enrollmentsPreview",
        "enrollmentsTotal",
        "id",
        "location",
        "name",
        "startDate",
        "status",
        "summary",
      ]);
    });

    it("asks the enrollments of the class that was found, with the preview limited to 5", async () => {
      await enroll(7);

      const res = await getClass(director, classId).expect(200);

      expect((res.body as ClassDetailBody).enrollmentsPreview).toHaveLength(5);
      expect((res.body as ClassDetailBody).enrollmentsTotal).toBe(7);
      expect(countActive).toHaveBeenCalledTimes(1);
      expect(countActive).toHaveBeenCalledWith(expect.anything(), classId);
      expect(listActivePreview).toHaveBeenCalledTimes(1);
      expect(listActivePreview).toHaveBeenCalledWith(expect.anything(), classId, 5);
    });

    it("answers the data of a class that has a name, a place and another status", async () => {
      const other = await insertClass(dataSource, {
        courseId,
        editionId,
        createdById: director.id,
        code: "INFO-B",
        name: "Informática Básica, turma B",
        startDate: "2026-12-31",
        endDate: "2027-01-01",
        capacity: 20,
        status: ClassStatus.IN_PROGRESS,
      });
      await dataSource.query(`UPDATE classes SET location = $2 WHERE id = $1`, [
        other,
        "Laboratório 3, bloco B",
      ]);

      const res = await getClass(director, other).expect(200);

      expect(res.body).toMatchObject({
        id: other,
        code: "INFO-B",
        name: "Informática Básica, turma B",
        startDate: "2026-12-31",
        endDate: "2027-01-01",
        location: "Laboratório 3, bloco B",
        capacity: 20,
        status: "in_progress",
      });
    });

    it("keeps the lessons and attendance fields as null, present in the answer", async () => {
      const res = await getClass(director, classId).expect(200);

      expect(res.body).toHaveProperty("summary.lessonsDone", null);
      expect(res.body).toHaveProperty("summary.lessonsTotal", null);
      expect(res.body).toHaveProperty("summary.averageAttendance", null);
    });

    it("shows the current category after the course changes it", async () => {
      const before = await getClass(director, classId).expect(200);
      expect((before.body as ClassDetailBody).course.category).toBe("basic");

      await coursesService.update(courseId, { category: CourseCategory.INTERMEDIATE }, director.id);

      const after = await getClass(director, classId).expect(200);
      expect((after.body as ClassDetailBody).course.category).toBe("intermediate");
    });

    it("answers an empty preview and zero for a class without enrollments", async () => {
      const res = await getClass(director, classId).expect(200);
      const body = res.body as ClassDetailBody;

      expect(body.enrollmentsPreview).toEqual([]);
      expect(body.enrollmentsTotal).toBe(0);
      expect(body.summary.enrolledCount).toBe(0);
      expect(body.summary.occupancyRate).toBe(0);
    });

    it("answers enrollmentsTotal equal to the total of GET /classes/:id/enrollments?status=active, with dropped and removed enrollments left out", async () => {
      await enroll(3);
      await insertEnrollments(dataSource, {
        classId,
        createdById: director.id,
        count: 2,
        status: EnrollmentStatus.DROPPED,
        namePrefix: "Dropped",
      });
      await insertEnrollment(dataSource, {
        classId,
        studentId: await insertStudent(dataSource, { name: "Removed", createdById: director.id }),
        createdById: director.id,
        deletedAt: new Date("2026-03-10T12:00:00.000Z"),
      });

      const sheet = await getClass(director, classId).expect(200);
      const list = await request(app.getHttpServer())
        .get(`/classes/${classId}/enrollments?status=active`)
        .set("Cookie", director.cookie)
        .expect(200);

      expect((sheet.body as ClassDetailBody).enrollmentsTotal).toBe(3);
      expect((list.body as { total: number }).total).toBe(3);
    });

    it("names the students of the preview from people", async () => {
      const rows = [
        await createStudentRow("Ana Souza", "2026-02-16T10:00:00.000Z"),
        await createStudentRow("Bruno Lima", "2026-02-17T10:00:00.000Z"),
        await createStudentRow("Carla Dias", "2026-02-18T10:00:00.000Z"),
        await createStudentRow("Davi Rocha", "2026-02-19T10:00:00.000Z"),
        await createStudentRow("Elisa Prado", "2026-02-20T10:00:00.000Z"),
      ];
      // 7 more, enrolled later (from 2026-03-03): they count, and stay out of the preview.
      await enroll(7);

      const res = await getClass(director, classId).expect(200);
      const body = res.body as ClassDetailBody;

      // The order of the rows is the order of the preview, and each item carries the name that
      // `people` has for its student.
      expect(body.enrollmentsPreview).toEqual(
        rows.map((row, index) => ({
          id: row.enrollmentId,
          student: {
            id: row.studentId,
            name: ["Ana Souza", "Bruno Lima", "Carla Dias", "Davi Rocha", "Elisa Prado"][index],
          },
          enrolledAt: row.enrolledAt.toISOString(),
        })),
      );
      expect(body.enrollmentsPreview).toHaveLength(5);
      // The preview is shorter than the class: the total is not the length of the preview.
      expect(body.enrollmentsTotal).toBe(12);
      expect(body.summary.enrolledCount).toBe(12);
      expect(listActivePreview).toHaveBeenCalledWith(expect.anything(), classId, 5);
    });

    it("leaves out a student of the preview that is not a person anymore, and keeps the total", async () => {
      // The case of an id that is not a person at all cannot happen with the foreign key: the unit
      // test of ClassDetailService covers it.
      await createStudentRow("Ana Souza", "2026-02-16T10:00:00.000Z");
      const removed = await createStudentRow("Bruno Lima", "2026-02-17T10:00:00.000Z");
      await createStudentRow("Carla Dias", "2026-02-18T10:00:00.000Z");
      await dataSource.query(`UPDATE people SET deleted_at = now() WHERE id = $1`, [
        removed.studentId,
      ]);

      const res = await getClass(director, classId).expect(200);
      const body = res.body as ClassDetailBody;

      expect(body.enrollmentsPreview.map((item) => item.student.name)).toEqual([
        "Ana Souza",
        "Carla Dias",
      ]);
      expect(body.enrollmentsTotal).toBe(3);
    });

    it("answers createdBy null when the person who created the class was removed", async () => {
      const creator = await peopleService.save({ name: "Creator", role: Role.COORDINATOR });
      const orphan = await insertClass(dataSource, {
        courseId,
        editionId,
        createdById: creator.id,
        code: "INFO-C",
      });
      await dataSource.query(`UPDATE people SET deleted_at = now() WHERE id = $1`, [creator.id]);

      const res = await getClass(director, orphan).expect(200);

      expect(res.body).toHaveProperty("createdBy", null);
      expect((res.body as ClassDetailBody).id).toBe(orphan);
    });

    it("answers the occupancy with two decimals, and above 1 for a class over capacity", async () => {
      const small = await insertClass(dataSource, {
        courseId,
        editionId,
        createdById: director.id,
        code: "INFO-D",
        capacity: 3,
      });

      await enroll(1, small);
      const third = await getClass(director, small).expect(200);
      expect((third.body as ClassDetailBody).summary.occupancyRate).toBe(0.33);

      await createStudentRow("Second", "2026-03-04T10:00:00.000Z", small);
      const twoThirds = await getClass(director, small).expect(200);
      expect((twoThirds.body as ClassDetailBody).summary.occupancyRate).toBe(0.67);

      // Over the capacity by SQL on purpose: the enrollment refuses it, so the state is forced.
      await createStudentRow("Third", "2026-03-05T10:00:00.000Z", small);
      await createStudentRow("Fourth", "2026-03-06T10:00:00.000Z", small);
      const over = await getClass(director, small).expect(200);
      expect((over.body as ClassDetailBody).summary.occupancyRate).toBe(1.33);
    });

    it("shows the same number of lesson plans and workload as GET /courses/:id, an archived plan included", async () => {
      await lessonPlansService.archive(planIds[0], undefined, director.id);

      const detail = await getClass(director, classId).expect(200);
      const course = await request(app.getHttpServer())
        .get(`/courses/${courseId}`)
        .set("Cookie", director.cookie)
        .expect(200);

      expect((detail.body as ClassDetailBody).course.lessonPlanCount).toBe(6);
      expect((detail.body as ClassDetailBody).course.plannedWorkloadMinutes).toBe(540);
      expect((detail.body as ClassDetailBody).course.lessonPlanCount).toBe(
        (course.body as { lessonPlanCount: number }).lessonPlanCount,
      );
      expect((detail.body as ClassDetailBody).course.plannedWorkloadMinutes).toBe(
        (course.body as { plannedWorkloadMinutes: number }).plannedWorkloadMinutes,
      );
    });

    it("answers 0 lesson plans and 0 minutes for a course whose sequence is empty", async () => {
      await courseLessonPlansService.replace(courseId, { lessonPlanIds: [] }, director.id);

      const res = await getClass(director, classId).expect(200);

      expect((res.body as ClassDetailBody).course).toMatchObject({
        lessonPlanCount: 0,
        plannedWorkloadMinutes: 0,
      });
    });

    it("reads the class of an archived course, with course.status archived", async () => {
      await archiveCourse(dataSource, courseId, director.id);

      const res = await getClass(director, classId).expect(200);

      expect((res.body as ClassDetailBody).course.status).toBe("archived");
      expect((res.body as ClassDetailBody).course.id).toBe(courseId);
    });

    it("reads an archived class, with archivedAt set", async () => {
      const archived = await insertClass(dataSource, {
        courseId,
        editionId,
        createdById: director.id,
        code: "OLD-A",
        archivedById: director.id,
        status: ClassStatus.COMPLETED,
      });

      const res = await getClass(director, archived).expect(200);
      const body = res.body as ClassDetailBody;

      expect(body.id).toBe(archived);
      expect(body.archivedAt).not.toBeNull();
      expect(typeof body.archivedAt).toBe("string");
      // Archiving does not touch the status (RF-034, RN-27).
      expect(body.status).toBe("completed");
      expect(body).not.toHaveProperty("archivedById");
      expect(body).not.toHaveProperty("archiveReason");
    });

    it("reads the id in upper case and answers the id of the database", async () => {
      const res = await getClass(director, classId.toUpperCase()).expect(200);

      expect((res.body as ClassDetailBody).id).toBe(classId);
      // The reads after the lookup use the id of the database, not the one that was asked.
      expect(countActive).toHaveBeenCalledWith(expect.anything(), classId);
      expect(listActivePreview).toHaveBeenCalledWith(expect.anything(), classId, 5);
    });
  });

  describe("a class that is not there", () => {
    it("answers 404 CLASS_NOT_FOUND for an unknown id, and asks nobody else", async () => {
      const res = await getClass(director, randomUUID()).expect(404);

      expect(res.body).toEqual({
        statusCode: 404,
        error: "CLASS_NOT_FOUND",
        message: "Class not found.",
      });
      expect(countActive).not.toHaveBeenCalled();
      expect(listActivePreview).not.toHaveBeenCalled();
    });

    it("answers 404 CLASS_NOT_FOUND for a malformed id", async () => {
      for (const id of ["not-a-uuid", "123"]) {
        const res = await getClass(director, id).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "CLASS_NOT_FOUND",
          message: "Class not found.",
        });
      }
    });

    it("answers 404 CLASS_NOT_FOUND for a class that was deleted from the table", async () => {
      await dataSource.query(`UPDATE classes SET deleted_at = now() WHERE id = $1`, [classId]);

      const res = await getClass(director, classId).expect(404);

      expect(res.body.error).toBe("CLASS_NOT_FOUND");
    });
  });

  describe("the route among its neighbours", () => {
    it("still answers GET /classes/summary-by-course as its own route", async () => {
      const res = await request(app.getHttpServer())
        .get(`/classes/summary-by-course?courseIds=${courseId}`)
        .set("Cookie", director.cookie)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toEqual([{ courseId, total: 1, active: 1 }]);
    });

    it("has no write on the same path: a POST on /classes/:id is not a route", async () => {
      await request(app.getHttpServer())
        .post(`/classes/${classId}`)
        .set("Cookie", director.cookie)
        .send({})
        .expect(404);
    });
  });

  describe("who can read it", () => {
    it("lets a member read it", async () => {
      await enroll(12);

      const res = await getClass(member, classId).expect(200);

      expect((res.body as ClassDetailBody).id).toBe(classId);
      expect((res.body as ClassDetailBody).summary.enrolledCount).toBe(12);
    });

    it("answers 401 without a session cookie", async () => {
      await getClass(null, classId).expect(401);
      await getClass(null, randomUUID()).expect(401);
    });
  });
});
