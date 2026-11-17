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
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Clock } from "@shared/dates/clock";
import { Role } from "@shared/enums/role.enum";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { ClassesModule } from "../classes.module";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import {
  FIRST_ENROLLED_AT,
  insertClass,
  insertCourse,
  insertEdition,
  insertEnrollment,
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

process.env.JWT_SECRET = "e2e-enrollment-listing-secret";

const SESSION_COOKIE_NAME = "tedi_session";
const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

// The clock of the application: 2026-04-15 in São Paulo. A student born on 1958-04-15 is 68 today.
const NOW = new Date("2026-04-15T15:00:00.000Z");

interface Actor {
  id: string;
  cookie: string;
}

interface Page<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

interface ClassRef {
  id: string;
  code: string;
  name: string | null;
  edition: { id: string; name: string };
}

interface ClassEnrollmentItem {
  id: string;
  student: {
    id: string;
    name: string;
    age: number;
    phone: string | null;
    accessibilityNeed: string | null;
  };
  status: string;
  enrolledAt: string;
  statusChangedAt: string;
  attendanceRate: number | null;
}

interface StudentItem {
  id: string;
  name: string;
  age: number;
  phone?: string | null;
  accessibilityNeed?: string;
  currentClasses: ClassRef[];
}

describe("Enrollment listings (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;

  let director: Actor;
  let member: Actor;
  let basic: string;
  let smartphones: string;
  let edition2025: string;
  let edition2026: string;
  /** INFO-A of Informática Básica in 2026.1. */
  let classId: string;

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
      ],
    })
      .overrideProvider(Clock)
      .useValue({ now: () => new Date(NOW) })
      .compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    jwtService = module.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE enrollments, classes, editions, course_prerequisites, courses,
                      student_profiles, people RESTART IDENTITY CASCADE`,
    );
    director = await createActor("Director", Role.DIRECTOR);
    member = await createActor("Member", Role.MEMBER);
    basic = await insertCourse(dataSource, director.id, "Informática Básica", "basic");
    smartphones = await insertCourse(dataSource, director.id, "Smartphones", "intermediate");
    edition2025 = await insertEdition(dataSource, "2025.2");
    edition2026 = await insertEdition(dataSource, "2026.1");
    classId = await addClass("INFO-A");
  });

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  function addClass(
    code: string,
    input: { courseId?: string; editionId?: string; archived?: boolean } = {},
  ): Promise<string> {
    return insertClass(dataSource, {
      courseId: input.courseId ?? basic,
      editionId: input.editionId ?? edition2026,
      createdById: director.id,
      code,
      archivedById: input.archived === true ? director.id : undefined,
    });
  }

  function student(
    name: string,
    input: {
      birthDate?: string;
      phone?: string;
      accessibilityNeed?: string;
      archived?: boolean;
    } = {},
  ): Promise<string> {
    return insertStudent(dataSource, {
      name,
      createdById: director.id,
      birthDate: input.birthDate,
      phone: input.phone,
      accessibilityNeed: input.accessibilityNeed,
      archivedById: input.archived === true ? director.id : undefined,
    });
  }

  function enroll(
    inClassId: string,
    studentId: string,
    input: {
      status?: EnrollmentStatus;
      enrolledAt?: Date;
      statusChangedAt?: string;
      deletedAt?: Date;
    } = {},
  ): Promise<string> {
    return insertEnrollment(dataSource, {
      classId: inClassId,
      studentId,
      createdById: director.id,
      status: input.status,
      enrolledAt: input.enrolledAt ?? FIRST_ENROLLED_AT,
      statusChangedAt: input.statusChangedAt,
      deletedAt: input.deletedAt,
    });
  }

  function get(path: string, actor: Actor | null = director) {
    const req = request(app.getHttpServer()).get(path);
    return actor === null ? req : req.set("Cookie", actor.cookie);
  }

  // ---------------------------------------------------------------------------
  // GET /classes/:id/enrollments
  // ---------------------------------------------------------------------------

  describe("GET /classes/:id/enrollments (listClassEnrollments)", () => {
    it("lists every status by default, ordered by the name of the student, with student id, name, age, phone, accessibilityNeed, status, enrolledAt, statusChangedAt and attendanceRate null", async () => {
      const bruno = await student("Bruno Lima", {
        birthDate: "1958-04-15",
        phone: "43988887777",
        accessibilityNeed: "hearing",
      });
      const ana = await student("Ana Souza");
      const carla = await student("Carla Dias");
      const brunoEnrollment = await enroll(classId, bruno);
      await enroll(classId, ana, {
        status: EnrollmentStatus.DROPPED,
        statusChangedAt: "2026-04-01",
      });
      await enroll(classId, carla, { status: EnrollmentStatus.COMPLETED });

      const res = await get(`/classes/${classId}/enrollments`).expect(200);
      const page = res.body as Page<ClassEnrollmentItem>;

      expect(page.total).toBe(3);
      expect(page.data.map((item) => [item.student.name, item.status])).toEqual([
        ["Ana Souza", "dropped"],
        ["Bruno Lima", "active"],
        ["Carla Dias", "completed"],
      ]);
      expect(page.data[1]).toEqual({
        id: brunoEnrollment,
        student: {
          id: bruno,
          name: "Bruno Lima",
          age: 68,
          phone: "43988887777",
          accessibilityNeed: "hearing",
        },
        status: "active",
        enrolledAt: FIRST_ENROLLED_AT.toISOString(),
        statusChangedAt: "2026-03-03",
        attendanceRate: null,
      });
      expect(page.data[0].statusChangedAt).toBe("2026-04-01");
      expect(page.data[0].student.phone).toBeNull();
      expect(page.data[0]).not.toHaveProperty("statusReason");
    });

    it("filters by one status and searches by name ignoring case and accents", async () => {
      await enroll(classId, await student("José Almeida"));
      await enroll(classId, await student("Ana Souza"), { status: EnrollmentStatus.DROPPED });
      await enroll(classId, await student("Bruno Lima"));

      const dropped = await get(`/classes/${classId}/enrollments?status=dropped`).expect(200);
      expect(
        (dropped.body as Page<ClassEnrollmentItem>).data.map((item) => item.student.name),
      ).toEqual(["Ana Souza"]);

      const search = await get(`/classes/${classId}/enrollments?search=JOSE`).expect(200);
      expect(
        (search.body as Page<ClassEnrollmentItem>).data.map((item) => item.student.name),
      ).toEqual(["José Almeida"]);
      expect((search.body as Page<ClassEnrollmentItem>).total).toBe(1);

      await get(`/classes/${classId}/enrollments?status=paused`).expect(400);
    });

    it("answers the same total for ?status=active as enrollmentsTotal of GET /classes/:id", async () => {
      for (const name of ["Ana", "Bruno", "Carla"]) await enroll(classId, await student(name));
      await enroll(classId, await student("Davi"), { status: EnrollmentStatus.DROPPED });
      await enroll(classId, await student("Eva"), {
        deletedAt: new Date("2026-04-01T12:00:00.000Z"),
      });

      const list = await get(`/classes/${classId}/enrollments?status=active`).expect(200);
      const sheet = await get(`/classes/${classId}`).expect(200);

      expect((list.body as Page<ClassEnrollmentItem>).total).toBe(3);
      expect(sheet.body.enrollmentsTotal).toBe(3);
      expect(sheet.body.summary.enrolledCount).toBe(3);
    });

    it("paginates without repeating a student", async () => {
      for (const name of ["Ana", "Bruno", "Carla", "Davi", "Eva"]) {
        await enroll(classId, await student(name));
      }

      const seen: string[] = [];
      for (const pageNumber of [1, 2, 3]) {
        const res = await get(`/classes/${classId}/enrollments?page=${pageNumber}&limit=2`).expect(
          200,
        );
        const page = res.body as Page<ClassEnrollmentItem>;
        expect(page).toMatchObject({ total: 5, page: pageNumber, limit: 2 });
        seen.push(...page.data.map((item) => item.student.name));
      }

      expect(seen).toEqual(["Ana", "Bruno", "Carla", "Davi", "Eva"]);
    });

    it("keeps an archived student with an old enrollment; answers 200 for an archived class", async () => {
      const archived = await student("Arquivada", { archived: true });
      await enroll(classId, archived, { status: EnrollmentStatus.COMPLETED });

      const res = await get(`/classes/${classId}/enrollments`).expect(200);
      expect((res.body as Page<ClassEnrollmentItem>).data.map((item) => item.student.id)).toEqual([
        archived,
      ]);

      const oldClass = await addClass("OLD-A", { archived: true });
      await enroll(oldClass, await student("Ana"), { status: EnrollmentStatus.COMPLETED });
      const old = await get(`/classes/${oldClass}/enrollments`).expect(200);
      expect((old.body as Page<ClassEnrollmentItem>).total).toBe(1);
    });

    it("lets a member read it; answers 404 CLASS_NOT_FOUND for an unknown class", async () => {
      await enroll(classId, await student("Ana"));

      const res = await get(`/classes/${classId}/enrollments`, member).expect(200);
      expect((res.body as Page<ClassEnrollmentItem>).total).toBe(1);

      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const missing = await get(`/classes/${id}/enrollments`).expect(404);
        expect(missing.body.error).toBe("CLASS_NOT_FOUND");
      }
      await get(`/classes/${classId}/enrollments`, null).expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /classes/:id/available-students
  // ---------------------------------------------------------------------------

  describe("GET /classes/:id/available-students (listAvailableStudents)", () => {
    it("CA4: leaves out who is active in the class, and also who dropped or completed it, and the archived students", async () => {
      await enroll(classId, await student("Ana"));
      await enroll(classId, await student("Bruno"), { status: EnrollmentStatus.DROPPED });
      await enroll(classId, await student("Carla"), { status: EnrollmentStatus.COMPLETED });
      // A removed enrollment frees the student for the class again.
      await enroll(classId, await student("Davi"), {
        deletedAt: new Date("2026-04-01T12:00:00.000Z"),
      });
      await student("Eva", { archived: true });
      await student("Fabio");

      const res = await get(`/classes/${classId}/available-students`).expect(200);
      const page = res.body as Page<StudentItem>;

      expect(page.data.map((item) => item.name)).toEqual(["Davi", "Fabio"]);
      expect(page.total).toBe(2);
    });

    it("shows the age and the other active classes of each student in currentClasses", async () => {
      const fabio = await student("Fabio", { birthDate: "1958-04-16", phone: "43999990000" });
      const web = await addClass("WEB-A", { courseId: smartphones });
      const smart = await addClass("SMART-B", { courseId: smartphones, editionId: edition2025 });
      await enroll(web, fabio);
      await enroll(smart, fabio);
      // A dropped enrollment is not a current class.
      await enroll(await addClass("OLD-C"), fabio, { status: EnrollmentStatus.DROPPED });

      const res = await get(`/classes/${classId}/available-students`).expect(200);
      const [item] = (res.body as Page<StudentItem>).data;

      expect(item).toEqual({
        id: fabio,
        name: "Fabio",
        age: 67,
        currentClasses: [
          { id: web, code: "WEB-A", name: null, edition: { id: edition2026, name: "2026.1" } },
          { id: smart, code: "SMART-B", name: null, edition: { id: edition2025, name: "2025.2" } },
        ],
      });
    });

    it("searches by name and paginates", async () => {
      for (const name of ["Ana", "Andre", "Bruno"]) await student(name);

      const first = await get(
        `/classes/${classId}/available-students?search=an&page=1&limit=1`,
      ).expect(200);
      const second = await get(
        `/classes/${classId}/available-students?search=an&page=2&limit=1`,
      ).expect(200);

      expect((first.body as Page<StudentItem>).data.map((item) => item.name)).toEqual(["Ana"]);
      expect((second.body as Page<StudentItem>).data.map((item) => item.name)).toEqual(["Andre"]);
      expect((first.body as Page<StudentItem>).total).toBe(2);
    });

    it("answers 403 FORBIDDEN to a member", async () => {
      const res = await get(`/classes/${classId}/available-students`, member).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      await get(`/classes/${UNKNOWN_ID}/available-students`).expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /students/:id/enrollments
  // ---------------------------------------------------------------------------

  describe("GET /students/:id/enrollments (listStudentEnrollments)", () => {
    /** Maria: Básica in 2025.2 completed on 2025-12-12, Smartphones in 2026.1 active. */
    async function maria() {
      const id = await student("Maria");
      const basic2025 = await addClass("BAS-25", { editionId: edition2025 });
      const smart2026 = await addClass("SMART-A", { courseId: smartphones });
      const completed = await enroll(basic2025, id, {
        status: EnrollmentStatus.COMPLETED,
        enrolledAt: new Date("2025-08-04T13:00:00.000Z"),
        statusChangedAt: "2025-12-12",
      });
      const active = await enroll(smart2026, id);
      return { id, basic2025, smart2026, completed, active };
    }

    it("CT4/CA5: a student with Básica 2025 completed and Smartphones 2026 active answers completedCourses [Básica] and activeClasses 1", async () => {
      const scenery = await maria();

      const res = await get(`/students/${scenery.id}/enrollments`).expect(200);

      expect(res.body.summary).toEqual({
        activeClasses: 1,
        completedCourses: [
          { courseId: basic, name: "Informática Básica", completedAt: "2025-12-12" },
        ],
        firstEnrollmentAt: "2025-08-04T13:00:00.000Z",
      });
      // The dates come as the exact "YYYY-MM-DD" stored, never shifted by a time zone.
      expect(
        (res.body.enrollments as Array<{ statusChangedAt: string }>).map(
          (item) => item.statusChangedAt,
        ),
      ).toEqual(["2026-03-03", "2025-12-12"]);
    });

    it("lists the enrollments with class code and edition, course name and category, status and enrolledAt, the newest first, and firstEnrollmentAt", async () => {
      const scenery = await maria();
      // A removed enrollment is not history.
      await enroll(await addClass("GONE-A"), scenery.id, {
        deletedAt: new Date("2026-04-01T12:00:00.000Z"),
      });

      const res = await get(`/students/${scenery.id}/enrollments`).expect(200);

      expect(res.body.enrollments).toEqual([
        {
          id: scenery.active,
          status: "active",
          enrolledAt: FIRST_ENROLLED_AT.toISOString(),
          statusChangedAt: "2026-03-03",
          class: {
            id: scenery.smart2026,
            code: "SMART-A",
            name: null,
            edition: { id: edition2026, name: "2026.1" },
          },
          course: {
            id: smartphones,
            name: "Smartphones",
            category: "intermediate",
            status: "active",
          },
        },
        {
          id: scenery.completed,
          status: "completed",
          enrolledAt: "2025-08-04T13:00:00.000Z",
          statusChangedAt: "2025-12-12",
          class: {
            id: scenery.basic2025,
            code: "BAS-25",
            name: null,
            edition: { id: edition2025, name: "2025.2" },
          },
          course: { id: basic, name: "Informática Básica", category: "basic", status: "active" },
        },
      ]);
      expect(res.body.summary.firstEnrollmentAt).toBe("2025-08-04T13:00:00.000Z");
    });

    it("answers an empty history with firstEnrollmentAt null", async () => {
      const id = await student("Nova");

      const res = await get(`/students/${id}/enrollments`).expect(200);

      expect(res.body).toEqual({
        enrollments: [],
        summary: { activeClasses: 0, completedCourses: [], firstEnrollmentAt: null },
      });
    });

    it("answers 404 STUDENT_NOT_FOUND for a member who is not a student and for a malformed id; 200 for an archived student", async () => {
      for (const id of [member.id, UNKNOWN_ID, "not-a-uuid"]) {
        const res = await get(`/students/${id}/enrollments`).expect(404);
        expect(res.body).toEqual({
          statusCode: 404,
          error: "STUDENT_NOT_FOUND",
          message: "Student not found.",
        });
      }

      const archived = await student("Arquivada", { archived: true });
      await get(`/students/${archived}/enrollments`).expect(200);
      await get(`/students/${archived}/enrollments`, member).expect(200);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /enrollments/students
  // ---------------------------------------------------------------------------

  describe("GET /enrollments/students (listStudentsByEnrollment)", () => {
    /** Ana active in INFO-A and SMART-A, Bruno dropped from INFO-A, Davi active in SMART-A only. */
    async function scenery() {
      const smart = await addClass("SMART-A", { courseId: smartphones });
      const ana = await student("Ana", { phone: "43999990000", accessibilityNeed: "visual" });
      const bruno = await student("Bruno");
      const carla = await student("Carla");
      const davi = await student("Davi");
      await student("Eva", { archived: true });
      await enroll(classId, ana);
      await enroll(smart, ana);
      await enroll(classId, bruno, { status: EnrollmentStatus.DROPPED });
      await enroll(smart, davi);
      return { smart, ana, bruno, carla, davi };
    }

    function names(res: request.Response): string[] {
      return (res.body as Page<StudentItem>).data.map((item) => item.name);
    }

    it("lists the students enrolled in a class with currentClasses", async () => {
      const { smart, ana } = await scenery();

      const res = await get(`/enrollments/students?classId=${classId}&situation=enrolled`).expect(
        200,
      );

      expect((res.body as Page<StudentItem>).data).toEqual([
        {
          id: ana,
          name: "Ana",
          age: expect.any(Number),
          phone: "43999990000",
          accessibilityNeed: "visual",
          currentClasses: [
            {
              id: classId,
              code: "INFO-A",
              name: null,
              edition: { id: edition2026, name: "2026.1" },
            },
            {
              id: smart,
              code: "SMART-A",
              name: null,
              edition: { id: edition2026, name: "2026.1" },
            },
          ],
        },
      ]);
    });

    it("lists the students not enrolled in a class, archived left out", async () => {
      await scenery();

      const res = await get(
        `/enrollments/students?classId=${classId}&situation=not_enrolled`,
      ).expect(200);

      expect(names(res)).toEqual(["Bruno", "Carla", "Davi"]);
      expect((res.body as Page<StudentItem>).total).toBe(3);
    });

    it("without classId: enrolled = active somewhere; not_enrolled = active nowhere", async () => {
      await scenery();

      const enrolled = await get(`/enrollments/students?situation=enrolled`).expect(200);
      const notEnrolled = await get(`/enrollments/students?situation=not_enrolled`).expect(200);

      expect(names(enrolled)).toEqual(["Ana", "Davi"]);
      expect(names(notEnrolled)).toEqual(["Bruno", "Carla"]);
    });

    it("defaults the situation to enrolled; an unknown classId answers an empty page for enrolled and everybody for not_enrolled", async () => {
      await scenery();

      expect(names(await get(`/enrollments/students`).expect(200))).toEqual(["Ana", "Davi"]);

      const empty = await get(`/enrollments/students?classId=${UNKNOWN_ID}`).expect(200);
      expect(empty.body).toEqual({ data: [], total: 0, page: 1, limit: 20 });

      const everybody = await get(
        `/enrollments/students?classId=${UNKNOWN_ID}&situation=not_enrolled`,
      ).expect(200);
      expect(names(everybody)).toEqual(["Ana", "Bruno", "Carla", "Davi"]);
    });

    it("answers 400 VALIDATION_FAILED for a malformed classId; lets a member read it", async () => {
      await scenery();

      const malformed = await get(`/enrollments/students?classId=not-a-uuid`).expect(400);
      expect(malformed.body.error).toBe("VALIDATION_FAILED");
      const unknownSituation = await get(`/enrollments/students?situation=all`).expect(400);
      expect(unknownSituation.body.error).toBe("VALIDATION_FAILED");

      const res = await get(`/enrollments/students?search=an`, member).expect(200);
      expect(names(res)).toEqual(["Ana"]);
      await get(`/enrollments/students`, null).expect(401);
    });
  });
});
