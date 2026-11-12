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
import { Role } from "@shared/enums/role.enum";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { ClassesModule } from "../classes.module";
import { ClassStatus } from "../enums/class-status.enum";
import { EnrollmentCountsService } from "../services/enrollment-counts.service";
import {
  archiveCourse,
  insertClass,
  insertCourse,
  insertEdition,
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

process.env.JWT_SECRET = "e2e-course-classes-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface ClassItem {
  id: string;
  code: string;
  name: string | null;
  edition: { id: string; name: string };
  startDate: string;
  endDate: string;
  enrolledCount: number;
  capacity: number;
  status: string;
}

interface ClassPage {
  data: ClassItem[];
  total: number;
  page: number;
  limit: number;
}

interface SummaryItem {
  courseId: string;
  total: number;
  active: number;
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

/** `count` distinct, well formed ids that are not the id of anything. */
function unknownIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `01999a3e-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
  );
}

describe("CourseClassesController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;

  let director: Actor;
  let member: Actor;
  let basic: string;
  let smartphones: string;
  let edition1: string;
  let edition2: string;

  // The enrollments do not exist yet: the counts are replaced here, so `enrolledCount` is proven
  // to come from them. GUS-108 removes the override and uses real enrollments.
  const enrollmentCounts = { countActive: jest.fn(), countActiveByClass: jest.fn() };

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
      .overrideProvider(EnrollmentCountsService)
      .useValue(enrollmentCounts)
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
      "TRUNCATE TABLE classes, editions, course_prerequisites, courses, people RESTART IDENTITY CASCADE",
    );
    enrollmentCounts.countActive.mockReset();
    enrollmentCounts.countActive.mockResolvedValue(0);
    enrollmentCounts.countActiveByClass.mockReset();
    enrollmentCounts.countActiveByClass.mockResolvedValue(new Map());

    director = await createActor("Director", Role.DIRECTOR);
    member = await createActor("Member", Role.MEMBER);
    basic = await insertCourse(dataSource, director.id, "Informática Básica", "basic");
    smartphones = await insertCourse(dataSource, director.id, "Smartphones", "intermediate");
    edition1 = await insertEdition(dataSource, "2026.1");
    edition2 = await insertEdition(dataSource, "2026.2");
  });

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /** A class of `courseId` in `editionId`, with the author of the scenario. */
  function addClass(
    courseId: string,
    editionId: string,
    code: string,
    extra: { status?: ClassStatus; archived?: boolean; [key: string]: unknown } = {},
  ): Promise<string> {
    const { archived, ...rest } = extra;
    return insertClass(dataSource, {
      courseId,
      editionId,
      code,
      createdById: director.id,
      archivedById: archived === true ? director.id : undefined,
      ...rest,
    });
  }

  function getSummary(actor: Actor | null, query: string) {
    const req = request(app.getHttpServer()).get(`/classes/summary-by-course${query}`);
    return actor === null ? req : req.set("Cookie", actor.cookie);
  }

  function getClasses(actor: Actor | null, courseId: string, query = "") {
    const req = request(app.getHttpServer()).get(`/courses/${courseId}/classes${query}`);
    return actor === null ? req : req.set("Cookie", actor.cookie);
  }

  describe("GET /classes/summary-by-course (getClassesSummaryByCourse)", () => {
    it("CT1: Básica with INFO-A and INFO-B and Smartphones without classes answer [{ Básica, total 2, active 2 }, { Smartphones, total 0, active 0 }]", async () => {
      await addClass(basic, edition1, "INFO-A");
      await addClass(basic, edition1, "INFO-B");

      const res = await getSummary(director, `?courseIds=${basic},${smartphones}`).expect(200);

      expect(res.body).toEqual([
        { courseId: basic, total: 2, active: 2 },
        { courseId: smartphones, total: 0, active: 0 },
      ]);
    });

    it("keeps the order asked and answers one item for a repeated id", async () => {
      await addClass(basic, edition1, "INFO-A");

      const res = await getSummary(
        director,
        `?courseIds=${smartphones},${basic},${smartphones},${basic}`,
      ).expect(200);

      expect(res.body).toEqual([
        { courseId: smartphones, total: 0, active: 0 },
        { courseId: basic, total: 1, active: 1 },
      ]);
    });

    it("counts neither archived classes in total nor completed or cancelled ones in active", async () => {
      await addClass(basic, edition1, "PLANNED", { status: ClassStatus.PLANNED });
      await addClass(basic, edition1, "RUNNING", { status: ClassStatus.IN_PROGRESS });
      await addClass(basic, edition1, "DONE", { status: ClassStatus.COMPLETED });
      await addClass(basic, edition1, "CANCELLED", { status: ClassStatus.CANCELLED });
      // Archived ones are in neither count, whatever their status.
      await addClass(basic, edition2, "OLD-PLANNED", { archived: true });
      await addClass(basic, edition2, "OLD-RUNNING", {
        archived: true,
        status: ClassStatus.IN_PROGRESS,
      });

      const res = await getSummary(director, `?courseIds=${basic}`).expect(200);

      expect(res.body).toEqual([{ courseId: basic, total: 4, active: 2 }]);
    });

    it("counts the classes of each course apart, and of an archived course too", async () => {
      await addClass(basic, edition1, "INFO-A");
      await addClass(smartphones, edition1, "SMART-A");
      await addClass(smartphones, edition2, "SMART-B", { status: ClassStatus.COMPLETED });
      await archiveCourse(dataSource, smartphones, director.id);

      const res = await getSummary(director, `?courseIds=${basic},${smartphones}`).expect(200);

      expect(res.body).toEqual([
        { courseId: basic, total: 1, active: 1 },
        { courseId: smartphones, total: 2, active: 1 },
      ]);
    });

    it("does not count a class that was deleted from the table", async () => {
      const kept = await addClass(basic, edition1, "KEPT");
      const gone = await addClass(basic, edition1, "GONE");
      await dataSource.query(`UPDATE classes SET deleted_at = now() WHERE id = $1`, [gone]);

      const res = await getSummary(director, `?courseIds=${basic}`).expect(200);

      expect(kept).not.toBe(gone);
      expect(res.body).toEqual([{ courseId: basic, total: 1, active: 1 }]);
    });

    it("total matches the total of GET /courses/:id/classes", async () => {
      await addClass(basic, edition1, "INFO-A");
      await addClass(basic, edition1, "INFO-B", { status: ClassStatus.CANCELLED });
      await addClass(basic, edition2, "INFO-C", { status: ClassStatus.IN_PROGRESS });
      await addClass(basic, edition2, "INFO-D", { archived: true });

      const summary = await getSummary(director, `?courseIds=${basic}`).expect(200);
      const list = await getClasses(director, basic).expect(200);
      const running = await getClasses(director, basic, "?status=in_progress").expect(200);
      const planned = await getClasses(director, basic, "?status=planned").expect(200);

      const [item] = summary.body as SummaryItem[];
      expect(item.total).toBe((list.body as ClassPage).total);
      expect(item.total).toBe(3);
      // `active` is the planned plus the in progress: the two filters together.
      expect(item.active).toBe(
        (running.body as ClassPage).total + (planned.body as ClassPage).total,
      );
    });

    it("answers zeros for an id that is well formed but is not a course", async () => {
      const res = await getSummary(director, `?courseIds=${UNKNOWN_ID},${basic}`).expect(200);

      expect(res.body).toEqual([
        { courseId: UNKNOWN_ID, total: 0, active: 0 },
        { courseId: basic, total: 0, active: 0 },
      ]);
    });

    it("reads the ids in upper case, with spaces and as a repeated parameter, and answers them in lower case", async () => {
      await addClass(basic, edition1, "INFO-A");

      const upper = await getSummary(
        director,
        `?courseIds=${encodeURIComponent(` ${basic.toUpperCase()} , ${smartphones} `)}`,
      ).expect(200);
      expect(upper.body).toEqual([
        { courseId: basic, total: 1, active: 1 },
        { courseId: smartphones, total: 0, active: 0 },
      ]);

      const repeated = await getSummary(
        director,
        `?courseIds=${smartphones}&courseIds=${basic}`,
      ).expect(200);
      expect(repeated.body).toEqual([
        { courseId: smartphones, total: 0, active: 0 },
        { courseId: basic, total: 1, active: 1 },
      ]);
    });

    it("answers 100 courses at once, one item each, in the order asked", async () => {
      const asked = [...unknownIds(99), basic];

      const res = await getSummary(director, `?courseIds=${asked.join(",")}`).expect(200);

      expect(res.body).toHaveLength(100);
      expect((res.body as SummaryItem[]).map((item) => item.courseId)).toEqual(asked);
    });

    it("returns 400 VALIDATION_FAILED for no courseIds, a malformed id and 101 ids", async () => {
      const bad = [
        "",
        "?courseIds=",
        "?courseIds=%20,%20",
        "?courseIds=not-a-uuid",
        `?courseIds=${basic},not-a-uuid`,
        `?courseIds=${basic}x`,
        `?courseIds=${unknownIds(101).join(",")}`,
      ];

      for (const query of bad) {
        const res = await getSummary(director, query).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["courseIds"]);
      }
    });

    it("answers 200 to a member", async () => {
      await addClass(basic, edition1, "INFO-A");

      const res = await getSummary(member, `?courseIds=${basic}`).expect(200);

      expect(res.body).toEqual([{ courseId: basic, total: 1, active: 1 }]);
    });

    it("returns 401 without a session cookie", async () => {
      await getSummary(null, `?courseIds=${basic}`).expect(401);
    });

    it("is not answered as the class with the id summary-by-course", async () => {
      // The route is its own, and it answers before any `/classes/:id` that may come later.
      const res = await getSummary(director, `?courseIds=${basic}`).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("GET /courses/:id/classes (listCourseClasses)", () => {
    it("lists only the classes of the course, paginated (page 2 of limit 1)", async () => {
      const infoA = await addClass(basic, edition1, "INFO-A");
      const infoB = await addClass(basic, edition1, "INFO-B");
      await addClass(smartphones, edition1, "SMART-A");

      const first = await getClasses(director, basic, "?page=1&limit=1").expect(200);
      const second = await getClasses(director, basic, "?page=2&limit=1").expect(200);
      const beyond = await getClasses(director, basic, "?page=3&limit=1").expect(200);

      expect(first.body).toMatchObject({ total: 2, page: 1, limit: 1 });
      expect((first.body as ClassPage).data.map((item) => item.id)).toEqual([infoA]);
      expect(second.body).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect((second.body as ClassPage).data.map((item) => item.id)).toEqual([infoB]);
      // A page past the end is empty, and the total is still the total.
      expect(beyond.body).toEqual({ data: [], total: 2, page: 3, limit: 1 });

      const other = await getClasses(director, smartphones).expect(200);
      expect((other.body as ClassPage).data.map((item) => item.code)).toEqual(["SMART-A"]);
    });

    it("answers the item of the contract: code, edition, period, enrolledCount, capacity and status", async () => {
      const id = await addClass(basic, edition1, "INFO-A", {
        name: "Informática Básica, turma A",
        startDate: "2026-12-31",
        endDate: "2027-01-01",
        capacity: 20,
        status: ClassStatus.IN_PROGRESS,
      });

      const res = await getClasses(director, basic).expect(200);

      expect(res.body).toEqual({
        data: [
          {
            id,
            code: "INFO-A",
            name: "Informática Básica, turma A",
            edition: { id: edition1, name: "2026.1" },
            startDate: "2026-12-31",
            endDate: "2027-01-01",
            enrolledCount: 0,
            capacity: 20,
            status: "in_progress",
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
    });

    it("answers name null for a class without a name", async () => {
      await addClass(basic, edition1, "INFO-A");

      const res = await getClasses(director, basic).expect(200);

      expect((res.body as ClassPage).data[0].name).toBeNull();
    });

    it("leaves archived classes out and orders by edition desc then code", async () => {
      const a1 = await addClass(basic, edition1, "INFO-A");
      const c1 = await addClass(basic, edition1, "info-c");
      const b1 = await addClass(basic, edition1, "Info-B");
      const b2 = await addClass(basic, edition2, "INFO-B");
      await addClass(basic, edition2, "ARCHIVED", { archived: true });

      const res = await getClasses(director, basic).expect(200);

      // 2026.2 before 2026.1, and the code compared ignoring case: INFO-A, Info-B, info-c.
      expect((res.body as ClassPage).data.map((item) => item.id)).toEqual([b2, a1, b1, c1]);
      expect(
        (res.body as ClassPage).data.map((item) => `${item.edition.name} ${item.code}`),
      ).toEqual(["2026.2 INFO-B", "2026.1 INFO-A", "2026.1 Info-B", "2026.1 info-c"]);
      expect((res.body as ClassPage).total).toBe(4);
    });

    it("is stable between pages: no class repeats and none is skipped", async () => {
      const added: string[] = [];
      for (let index = 0; index < 7; index++) {
        added.push(
          await addClass(basic, index % 2 === 0 ? edition1 : edition2, `T-${String(index)}`),
        );
      }

      const seen: string[] = [];
      for (const page of [1, 2, 3, 4]) {
        const res = await getClasses(director, basic, `?page=${page}&limit=2`).expect(200);
        seen.push(...(res.body as ClassPage).data.map((item) => item.id));
      }

      expect(seen).toHaveLength(7);
      expect([...seen].sort()).toEqual([...added].sort());
    });

    it("filters by status", async () => {
      await addClass(basic, edition1, "PLANNED", { status: ClassStatus.PLANNED });
      await addClass(basic, edition1, "RUNNING", { status: ClassStatus.IN_PROGRESS });
      await addClass(basic, edition1, "DONE", { status: ClassStatus.COMPLETED });
      await addClass(basic, edition1, "CANCELLED", { status: ClassStatus.CANCELLED });
      await addClass(basic, edition1, "OLD", { status: ClassStatus.COMPLETED, archived: true });

      for (const [status, codes] of [
        ["planned", ["PLANNED"]],
        ["in_progress", ["RUNNING"]],
        ["completed", ["DONE"]],
        ["cancelled", ["CANCELLED"]],
      ] as const) {
        const res = await getClasses(director, basic, `?status=${status}`).expect(200);

        expect((res.body as ClassPage).data.map((item) => item.code)).toEqual(codes);
        expect((res.body as ClassPage).total).toBe(1);
      }

      const all = await getClasses(director, basic).expect(200);
      expect((all.body as ClassPage).total).toBe(4);
    });

    it("paginates the filtered list: the total is the one of the filter", async () => {
      for (const code of ["P-1", "P-2", "P-3"]) await addClass(basic, edition1, code);
      await addClass(basic, edition1, "DONE", { status: ClassStatus.COMPLETED });

      const res = await getClasses(director, basic, "?status=planned&page=2&limit=2").expect(200);

      expect(res.body).toMatchObject({ total: 3, page: 2, limit: 2 });
      expect((res.body as ClassPage).data.map((item) => item.code)).toEqual(["P-3"]);
    });

    it("fills enrolledCount from the enrollment counts in one call", async () => {
      const infoA = await addClass(basic, edition1, "INFO-A");
      const infoB = await addClass(basic, edition1, "INFO-B");
      await addClass(basic, edition1, "INFO-C");
      enrollmentCounts.countActiveByClass.mockResolvedValue(
        new Map([
          [infoA, 7],
          [infoB, 15],
        ]),
      );

      const res = await getClasses(director, basic).expect(200);

      // One call for the whole page, and the ids are the ones of the page, in its order.
      expect(enrollmentCounts.countActiveByClass).toHaveBeenCalledTimes(1);
      const [, askedIds] = enrollmentCounts.countActiveByClass.mock.calls[0] as [unknown, string[]];
      expect(askedIds).toEqual((res.body as ClassPage).data.map((item) => item.id));
      expect(askedIds).toHaveLength(3);
      expect((res.body as ClassPage).data.map((item) => [item.code, item.enrolledCount])).toEqual([
        ["INFO-A", 7],
        ["INFO-B", 15],
        ["INFO-C", 0],
      ]);
    });

    it("asks the enrollment counts only for the classes of the page", async () => {
      await addClass(basic, edition1, "INFO-A");
      const infoB = await addClass(basic, edition1, "INFO-B");

      await getClasses(director, basic, "?page=2&limit=1").expect(200);

      const [, askedIds] = enrollmentCounts.countActiveByClass.mock.calls[0] as [unknown, string[]];
      expect(askedIds).toEqual([infoB]);
    });

    it("lists the classes of an archived course", async () => {
      await addClass(basic, edition1, "INFO-A");
      await addClass(basic, edition1, "INFO-B");
      await archiveCourse(dataSource, basic, director.id);

      const res = await getClasses(director, basic).expect(200);

      expect((res.body as ClassPage).data.map((item) => item.code)).toEqual(["INFO-A", "INFO-B"]);
      expect((res.body as ClassPage).total).toBe(2);
    });

    it("answers an empty page for a course without classes, and does not ask the enrollments", async () => {
      const res = await getClasses(director, smartphones).expect(200);

      expect(res.body).toEqual({ data: [], total: 0, page: 1, limit: 20 });
      expect(enrollmentCounts.countActiveByClass).not.toHaveBeenCalled();
    });

    it("takes 20 per page by default and up to 100", async () => {
      for (let index = 0; index < 25; index++) {
        await addClass(basic, edition1, `T-${String(index).padStart(2, "0")}`);
      }

      const byDefault = await getClasses(director, basic).expect(200);
      expect(byDefault.body).toMatchObject({ total: 25, page: 1, limit: 20 });
      expect((byDefault.body as ClassPage).data).toHaveLength(20);

      const next = await getClasses(director, basic, "?page=2").expect(200);
      expect((next.body as ClassPage).data).toHaveLength(5);

      const wide = await getClasses(director, basic, "?limit=100").expect(200);
      expect(wide.body).toMatchObject({ total: 25, page: 1, limit: 100 });
      expect((wide.body as ClassPage).data).toHaveLength(25);
    });

    it("reads the id of the course in upper case", async () => {
      await addClass(basic, edition1, "INFO-A");

      const res = await getClasses(director, basic.toUpperCase()).expect(200);

      expect((res.body as ClassPage).data.map((item) => item.code)).toEqual(["INFO-A"]);
    });

    it("returns 404 COURSE_NOT_FOUND for an unknown and for a malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid", "123"]) {
        const res = await getClasses(director, id).expect(404);

        expect(res.body).toEqual({
          statusCode: 404,
          error: "COURSE_NOT_FOUND",
          message: "Course not found.",
        });
      }
    });

    it("answers the query before it looks for the course: a bad query is 400 even for a course that does not exist", async () => {
      // The pipes run before the handler, so the course is only looked up for a valid query.
      const badQuery = await getClasses(director, UNKNOWN_ID, "?limit=101").expect(400);
      expect(badQuery.body.error).toBe("VALIDATION_FAILED");

      const goodQuery = await getClasses(director, UNKNOWN_ID, "?limit=100").expect(404);
      expect(goodQuery.body.error).toBe("COURSE_NOT_FOUND");
    });

    it("returns 400 VALIDATION_FAILED for limit 101, page 0 and an unknown status", async () => {
      for (const [field, query] of [
        ["limit", "?limit=101"],
        ["limit", "?limit=0"],
        ["limit", "?limit=abc"],
        ["page", "?page=0"],
        ["page", "?page=-1"],
        ["page", "?page=1.5"],
        ["status", "?status=open"],
        ["status", "?status=PLANNED"],
      ] as const) {
        const res = await getClasses(director, basic, query).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual([field]);
      }
    });

    it("ignores a filter that does not exist, as the archived one: archived classes cannot be asked for", async () => {
      await addClass(basic, edition1, "INFO-A");
      await addClass(basic, edition1, "OLD", { archived: true });

      const res = await getClasses(director, basic, "?archived=true&search=OLD").expect(200);

      expect((res.body as ClassPage).data.map((item) => item.code)).toEqual(["INFO-A"]);
    });

    it("answers 200 to a member", async () => {
      await addClass(basic, edition1, "INFO-A");

      const res = await getClasses(member, basic).expect(200);

      expect((res.body as ClassPage).total).toBe(1);
    });

    it("returns 401 without a session cookie", async () => {
      await getClasses(null, basic).expect(401);
      await getClasses(null, UNKNOWN_ID).expect(401);
    });
  });

  describe("the two routes together", () => {
    it("have no write: a POST or a PATCH on them is not a route", async () => {
      await request(app.getHttpServer())
        .post(`/courses/${basic}/classes`)
        .set("Cookie", director.cookie)
        .send({})
        .expect(404);
      await request(app.getHttpServer())
        .post("/classes/summary-by-course")
        .set("Cookie", director.cookie)
        .send({})
        .expect(404);
    });
  });
});
