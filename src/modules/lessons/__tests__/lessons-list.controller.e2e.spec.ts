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
import { LessonPlansService } from "@modules/catalog/services/lesson-plans.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";
import { LessonsModule } from "../lessons.module";
import { LessonListingService } from "../services/lesson-listing.service";
import { CLASS_PERIOD, insertLesson } from "./fixtures/lessons.fixture";

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

process.env.JWT_SECRET = "e2e-lessons-list-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

/** The month grid of the scenery: six weeks, 42 days counting both ends. */
const GRID = { from: "2026-03-01", to: "2026-04-11" } as const;

type CreateCourseInput = Parameters<CoursesService["create"]>[0];

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface ItemBody {
  id: string;
  class: { id: string; code: string; name: string; colorIndex: number };
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  status: string;
  teacher: { id: string; name: string } | null;
  belowExpectedMonitors: boolean;
  attendancePending: boolean;
}

interface PageBody {
  data: ItemBody[];
  total: number;
  page: number;
  limit: number;
}

type Query = Record<string, string | number>;

/** The two routes read the same lessons with the same filters: what they share is tested on both. */
const ROUTES = ["/lessons", "/lessons/calendar"] as const;
type Route = (typeof ROUTES)[number];

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

describe("Lessons list and calendar (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonPlansService: LessonPlansService;

  let director: Actor;
  let coordinator: Actor;
  let member: Actor;
  let superadmin: Actor;

  /** Informática Básica (X) and Segurança Digital (Y). */
  let courseX: string;
  let courseY: string;
  /** INFO-A in X, with a name; the first class made, so the first color. */
  let classA: string;
  /** SEG-B in Y, with no name; the second class, so the second color. */
  let classB: string;
  /** INFO-C in X, archived; the third class, so the third color. */
  let classC: string;
  let planP: string;
  let planQ: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          // Every entity: the foreign keys of Lesson point to other modules' tables by name.
          entities: [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
        AuthModule,
        PeopleModule,
        CatalogModule,
        ClassesModule,
        LessonsModule,
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
    coursesService = module.get(CoursesService);
    classesService = module.get(ClassesService);
    lessonPlansService = module.get(LessonPlansService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE lessons, classes, editions, course_lesson_plans, lesson_plan_contents,
                      lesson_plans, course_prerequisites, courses, people
       RESTART IDENTITY CASCADE`,
    );

    director = await createActor("Director", Role.DIRECTOR);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    member = await createActor("Member", Role.MEMBER);
    superadmin = await createActor("Superadmin", Role.SUPERADMIN);

    courseX = await createCourse("Informática Básica");
    courseY = await createCourse("Segurança Digital");
    // The order they are made in is the order of their colors, so it matters here.
    classA = await createClassOf(courseX, "INFO-A", "Informática Básica, turma A");
    classB = await createClassOf(courseY, "SEG-B");
    classC = await createClassOf(courseX, "INFO-C");
    await classesService.archive(classC, undefined, director.id);
    planP = await createPlan("Plano: senhas");
    planQ = await createPlan("Plano: redes");
  });

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /** The scenery comes from the services that the other modules export, not from their tables. */
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
  async function createClassOf(forCourseId: string, code: string, name?: string): Promise<string> {
    const schoolClass = await classesService.create(
      {
        courseId: forCourseId,
        code,
        name,
        editionName: "2026.1",
        ...CLASS_PERIOD,
        capacity: 15,
      },
      director.id,
    );
    return schoolClass.id;
  }

  async function createPlan(title: string): Promise<string> {
    const plan = await lessonPlansService.create(
      { title, objective: null, expectedDurationMinutes: 90, contents: ["Conteúdo"] },
      director.id,
    );
    return plan.id;
  }

  /** A lesson of the class A, planned, on 2026-03-10 at 14:00, unless the test says otherwise. */
  function lesson(overrides: Partial<Lesson> = {}): Promise<Lesson> {
    return insertLesson(dataSource, { classId: classA, createdById: director.id, ...overrides });
  }

  function getList(actor: Actor | null, query: Query = {}) {
    const req = request(app.getHttpServer()).get("/lessons").query(query);
    return actor === null ? req : req.set("Cookie", actor.cookie);
  }

  function getCalendar(actor: Actor | null, query: Query = {}) {
    const req = request(app.getHttpServer()).get("/lessons/calendar").query(query);
    return actor === null ? req : req.set("Cookie", actor.cookie);
  }

  /**
   * The lessons a route answers for the filters, as a plain list: the list with the largest page,
   * or the calendar of the whole month grid. What both of them answer is the same item.
   */
  async function itemsOf(
    route: Route,
    query: Query = {},
    actor: Actor = member,
  ): Promise<ItemBody[]> {
    if (route === "/lessons") {
      const res = await getList(actor, { limit: 100, ...query }).expect(200);
      return (res.body as PageBody).data;
    }
    const res = await getCalendar(actor, { ...GRID, ...query }).expect(200);
    return res.body as ItemBody[];
  }

  function titlesOf(items: ItemBody[]): string[] {
    return items.map((item) => item.title);
  }

  /**
   * The lessons that the tests of the filters share, all inside the month grid. In the order the
   * routes answer them: by day, then by start time.
   *
   *   03-10 09:00  B  Golpes na internet            planned
   *   03-10 10:00  C  Aula da turma arquivada       planned    (archived class)
   *   03-10 14:00  A  Senhas e privacidade          planned    plan P
   *   03-11 09:00  B  Privacidade nas redes         cancelled  plan P
   *   03-11 14:00  A  Redes sociais                 confirmed  plan Q, subject "Senhas fortes"
   *   03-12 14:00  A  Navegação segura              done
   *   03-13 14:00  A  Segurança                     cancelled  subject "Privacidade e senhas"
   */
  async function seedFilterScenario(): Promise<void> {
    await lesson({
      classId: classB,
      title: "Golpes na internet",
      date: "2026-03-10",
      startTime: "09:00",
      endTime: "10:30",
    });
    await lesson({
      classId: classC,
      title: "Aula da turma arquivada",
      date: "2026-03-10",
      startTime: "10:00",
      endTime: "11:30",
    });
    await lesson({
      title: "Senhas e privacidade",
      date: "2026-03-10",
      startTime: "14:00",
      lessonPlanId: planP,
    });
    await lesson({
      classId: classB,
      title: "Privacidade nas redes",
      date: "2026-03-11",
      startTime: "09:00",
      endTime: "10:30",
      status: LessonStatus.CANCELLED,
      lessonPlanId: planP,
    });
    await lesson({
      title: "Redes sociais",
      subject: "Senhas fortes",
      date: "2026-03-11",
      startTime: "14:00",
      status: LessonStatus.CONFIRMED,
      lessonPlanId: planQ,
    });
    await lesson({
      title: "Navegação segura",
      date: "2026-03-12",
      startTime: "14:00",
      status: LessonStatus.DONE,
    });
    await lesson({
      title: "Segurança",
      subject: "Privacidade e senhas",
      date: "2026-03-13",
      startTime: "14:00",
      status: LessonStatus.CANCELLED,
    });
  }

  describe.each(ROUTES)("what %s shares with the other route", (route) => {
    describe("access", () => {
      it("returns 401 without a session cookie", async () => {
        const query = route === "/lessons" ? {} : GRID;
        const res = await request(app.getHttpServer()).get(route).query(query).expect(401);

        expect(res.body.error).toBe("UNAUTHORIZED");
      });

      it("returns 200 for every profile: a member reads it, with lessons.view", async () => {
        await lesson();

        for (const actor of [member, director, coordinator, superadmin]) {
          const items = await itemsOf(route, {}, actor);

          expect(items).toHaveLength(1);
        }
      });
    });

    describe("the item", () => {
      it("answers id, class, date, times, title, status, teacher and belowExpectedMonitors", async () => {
        const created = await lesson({
          title: "Senhas e privacidade",
          date: "2026-03-10",
          startTime: "14:00",
          endTime: "15:30",
        });

        const items = await itemsOf(route);

        expect(items).toEqual([
          {
            id: created.id,
            class: {
              id: classA,
              code: "INFO-A",
              name: "Informática Básica, turma A",
              colorIndex: 0,
            },
            date: "2026-03-10",
            startTime: "14:00",
            endTime: "15:30",
            title: "Senhas e privacidade",
            status: "planned",
            teacher: null,
            belowExpectedMonitors: false,
            // Without the attendance module nobody is in a roll call: never pending (GUS-166).
            attendancePending: false,
          },
        ]);
      });

      it("answers the code as the name of a class that has no name", async () => {
        await lesson({ classId: classB });

        const items = await itemsOf(route);

        expect(items[0].class).toMatchObject({ id: classB, code: "SEG-B", name: "SEG-B" });
      });

      it("answers the times as HH:mm, never with seconds", async () => {
        await lesson({ startTime: "08:05", endTime: "10:45" });

        const [item] = await itemsOf(route);

        expect(item.startTime).toBe("08:05");
        expect(item.endTime).toBe("10:45");
      });

      it("answers the day as YYYY-MM-DD, whatever the time zone of the server", async () => {
        await lesson({ date: "2026-03-31" });
        await lesson({ date: "2026-04-01" });

        const items = await itemsOf(route);

        expect(items.map((item) => item.date)).toEqual(["2026-03-31", "2026-04-01"]);
      });

      it("answers teacher null while nobody is allocated, and belowExpectedMonitors by what the lesson expects: true for 3 monitors, false for zero or for not saying", async () => {
        // This app has no allocation module: no counter is registered, so nobody is confirmed in any
        // lesson. The e2e of the allocation, with real teachers and monitors, is in the assignments.
        await lesson({
          title: "Espera três monitores",
          expectedMonitors: 3,
          expectedStudents: 15,
          startTime: "09:00",
          endTime: "10:30",
        });
        await lesson({
          title: "Não espera monitor",
          expectedMonitors: 0,
          startTime: "11:00",
          endTime: "12:30",
        });
        await lesson({ title: "Não diz quantos", startTime: "14:00" });

        const items = await itemsOf(route);

        expect(items.map((item) => [item.title, item.teacher, item.belowExpectedMonitors])).toEqual(
          [
            ["Espera três monitores", null, true],
            ["Não espera monitor", null, false],
            ["Não diz quantos", null, false],
          ],
        );
      });

      it("answers belowExpectedMonitors false for a cancelled lesson, though it expects monitors", async () => {
        await lesson({ expectedMonitors: 3, status: LessonStatus.CANCELLED });

        const [item] = await itemsOf(route);

        expect(item.status).toBe("cancelled");
        expect(item.belowExpectedMonitors).toBe(false);
      });

      it("carries only what a row shows: none of the other fields of the lesson", async () => {
        await lesson({
          lessonPlanId: planP,
          sequenceOrder: 1,
          objective: "Familiarizar o aluno.",
          location: "Laboratório 3",
          subject: "Primeiro contato",
          postNotes: "Terminou antes do previsto.",
        });

        const [item] = await itemsOf(route);

        expect(Object.keys(item).sort()).toEqual([
          "attendancePending",
          "belowExpectedMonitors",
          "class",
          "date",
          "endTime",
          "id",
          "startTime",
          "status",
          "teacher",
          "title",
        ]);
        expect(Object.keys(item.class).sort()).toEqual(["code", "colorIndex", "id", "name"]);
      });

      it("lists a cancelled lesson like any other, with its status", async () => {
        await lesson({ status: LessonStatus.CANCELLED });

        const items = await itemsOf(route);

        expect(items.map((item) => item.status)).toEqual(["cancelled"]);
      });

      it("leaves out a lesson that was soft-deleted", async () => {
        const gone = await lesson({ title: "Apagada" });
        await lesson({ title: "Fica" });
        await dataSource.query(`UPDATE lessons SET deleted_at = now() WHERE id = $1`, [gone.id]);

        const items = await itemsOf(route);

        expect(titlesOf(items)).toEqual(["Fica"]);
      });
    });

    describe("the order", () => {
      it("is by day, then start time, then id, ascending", async () => {
        const first = await lesson({ title: "1", date: "2026-03-10", startTime: "14:00" });
        const second = await lesson({
          title: "2",
          date: "2026-03-10",
          startTime: "15:00",
          endTime: "16:00",
        });
        const third = await lesson({ title: "3", date: "2026-03-12", startTime: "08:00" });

        // Same day and time. The one with the larger id is made FIRST, so the order the table
        // keeps (the order the rows were made in) would put it first: only the id puts it second.
        const laterId = await lesson({
          id: "01999a3e-7c1b-7000-8000-0000000000f2",
          title: "5",
          date: "2026-03-12",
          startTime: "09:00",
          endTime: "10:00",
        });
        const earlierId = await lesson({
          id: "01999a3e-7c1b-7000-8000-0000000000f1",
          title: "4",
          date: "2026-03-12",
          startTime: "09:00",
          endTime: "10:00",
        });

        const items = await itemsOf(route);

        expect(items.map((item) => item.id)).toEqual([
          first.id,
          second.id,
          third.id,
          earlierId.id,
          laterId.id,
        ]);
      });

      it("puts the lessons of every class in one line, by day and time", async () => {
        await lesson({ classId: classA, title: "A 14h", date: "2026-03-10", startTime: "14:00" });
        await lesson({ classId: classB, title: "B 09h", date: "2026-03-10", startTime: "09:00" });
        await lesson({ classId: classA, title: "A 08h", date: "2026-03-11", startTime: "08:00" });
        await lesson({ classId: classB, title: "B 13h", date: "2026-03-09", startTime: "13:00" });

        const items = await itemsOf(route);

        expect(titlesOf(items)).toEqual(["B 13h", "B 09h", "A 14h", "A 08h"]);
      });
    });

    describe("the filters", () => {
      beforeEach(async () => {
        await seedFilterScenario();
      });

      it("lists every lesson of the classes that are not archived, the cancelled ones included, when there is no filter", async () => {
        const items = await itemsOf(route);

        expect(titlesOf(items)).toEqual([
          "Golpes na internet",
          "Senhas e privacidade",
          "Privacidade nas redes",
          "Redes sociais",
          "Navegação segura",
          "Segurança",
        ]);
      });

      it("filters by classId", async () => {
        expect(titlesOf(await itemsOf(route, { classId: classA }))).toEqual([
          "Senhas e privacidade",
          "Redes sociais",
          "Navegação segura",
          "Segurança",
        ]);
        expect(titlesOf(await itemsOf(route, { classId: classB }))).toEqual([
          "Golpes na internet",
          "Privacidade nas redes",
        ]);
      });

      it("filters by status", async () => {
        expect(titlesOf(await itemsOf(route, { status: "planned" }))).toEqual([
          "Golpes na internet",
          "Senhas e privacidade",
        ]);
        expect(titlesOf(await itemsOf(route, { status: "confirmed" }))).toEqual(["Redes sociais"]);
        expect(titlesOf(await itemsOf(route, { status: "done" }))).toEqual(["Navegação segura"]);
        expect(titlesOf(await itemsOf(route, { status: "cancelled" }))).toEqual([
          "Privacidade nas redes",
          "Segurança",
        ]);
      });

      it("combines classId and status", async () => {
        expect(titlesOf(await itemsOf(route, { classId: classA, status: "cancelled" }))).toEqual([
          "Segurança",
        ]);
        expect(titlesOf(await itemsOf(route, { classId: classB, status: "cancelled" }))).toEqual([
          "Privacidade nas redes",
        ]);
        expect(await itemsOf(route, { classId: classB, status: "done" })).toEqual([]);
      });

      it("filters by courseId: the lessons of the classes of the course, the archived class left out", async () => {
        expect(titlesOf(await itemsOf(route, { courseId: courseX }))).toEqual([
          "Senhas e privacidade",
          "Redes sociais",
          "Navegação segura",
          "Segurança",
        ]);
        expect(titlesOf(await itemsOf(route, { courseId: courseY }))).toEqual([
          "Golpes na internet",
          "Privacidade nas redes",
        ]);
      });

      it("combines courseId, classId and status: every filter has to match", async () => {
        expect(
          titlesOf(await itemsOf(route, { courseId: courseX, classId: classA, status: "done" })),
        ).toEqual(["Navegação segura"]);
        expect(await itemsOf(route, { courseId: courseY, classId: classA })).toEqual([]);
      });

      it("filters by lessonPlanId", async () => {
        expect(titlesOf(await itemsOf(route, { lessonPlanId: planP }))).toEqual([
          "Senhas e privacidade",
          "Privacidade nas redes",
        ]);
        expect(titlesOf(await itemsOf(route, { lessonPlanId: planQ }))).toEqual(["Redes sociais"]);
      });

      it("answers an empty list, not a 404, for an id that matches nothing", async () => {
        for (const filter of ["classId", "courseId", "lessonPlanId"]) {
          expect(await itemsOf(route, { [filter]: UNKNOWN_ID })).toEqual([]);
        }
      });

      it("takes an id in upper case", async () => {
        expect(titlesOf(await itemsOf(route, { classId: classB.toUpperCase() }))).toEqual([
          "Golpes na internet",
          "Privacidade nas redes",
        ]);
        expect(titlesOf(await itemsOf(route, { lessonPlanId: planQ.toUpperCase() }))).toEqual([
          "Redes sociais",
        ]);
      });

      it("leaves out the lessons of an archived class by default, and with courseId", async () => {
        const titles = titlesOf(await itemsOf(route));
        expect(titles).not.toContain("Aula da turma arquivada");

        const ofCourse = titlesOf(await itemsOf(route, { courseId: courseX }));
        expect(ofCourse).not.toContain("Aula da turma arquivada");
        expect(ofCourse).toHaveLength(4);
      });

      it("lists the lessons of an archived class when classId is that class", async () => {
        const items = await itemsOf(route, { classId: classC });

        expect(titlesOf(items)).toEqual(["Aula da turma arquivada"]);
        expect(items[0].class).toMatchObject({ id: classC, code: "INFO-C", name: "INFO-C" });
      });

      it("takes classId of an archived class together with its course, and not with another course", async () => {
        expect(titlesOf(await itemsOf(route, { classId: classC, courseId: courseX }))).toEqual([
          "Aula da turma arquivada",
        ]);
        expect(await itemsOf(route, { classId: classC, courseId: courseY })).toEqual([]);
      });

      it("keeps the lessons of a class that is completed or cancelled: the archive is what hides it", async () => {
        await dataSource.query(`UPDATE classes SET status = 'completed' WHERE id = $1`, [classA]);

        expect(await itemsOf(route, { classId: classA })).toHaveLength(4);
      });
    });

    describe("the search", () => {
      beforeEach(async () => {
        await seedFilterScenario();
        await lesson({ title: "Desconto de 50% na prova", date: "2026-03-14" });
        await lesson({ title: "Aula_de_reforço", date: "2026-03-15" });
        // What "a_d" would find if the underscore were a wildcard: "a", any character, "d".
        await lesson({ title: "Casa de papel", date: "2026-03-17" });
      });

      it("finds 'Senhas e privacidade' by 'senhas privacidade'", async () => {
        const items = await itemsOf(route, { search: "senhas privacidade" });

        expect(titlesOf(items)).toContain("Senhas e privacidade");
      });

      it("takes the words from the title and from the subject, in any order: all of them have to show up", async () => {
        // "Senhas e privacidade" has both in the title; "Segurança" has them in the subject
        // ("Privacidade e senhas"). "Redes sociais" has only "senhas" (in the subject) and
        // "Privacidade nas redes" has only "privacidade": both stay out.
        expect(titlesOf(await itemsOf(route, { search: "senhas privacidade" }))).toEqual([
          "Senhas e privacidade",
          "Segurança",
        ]);
        expect(titlesOf(await itemsOf(route, { search: "privacidade senhas" }))).toEqual([
          "Senhas e privacidade",
          "Segurança",
        ]);
      });

      it("takes one word in the title and another in the subject of the same lesson", async () => {
        // "Redes" is in the title of "Redes sociais", "fortes" in its subject.
        expect(titlesOf(await itemsOf(route, { search: "redes fortes" }))).toEqual([
          "Redes sociais",
        ]);
      });

      it("ignores case and accents, on both sides", async () => {
        expect(titlesOf(await itemsOf(route, { search: "navegacao" }))).toEqual([
          "Navegação segura",
        ]);
        expect(titlesOf(await itemsOf(route, { search: "NAVEGAÇÃO SEGURA" }))).toEqual([
          "Navegação segura",
        ]);
        expect(titlesOf(await itemsOf(route, { search: "seguranca" }))).toEqual(["Segurança"]);
      });

      it("finds a word that is only a stretch of a longer one", async () => {
        expect(titlesOf(await itemsOf(route, { search: "priva" }))).toEqual([
          "Senhas e privacidade",
          "Privacidade nas redes",
          "Segurança",
        ]);
      });

      it("ignores extra spaces and a repeated word", async () => {
        expect(
          titlesOf(await itemsOf(route, { search: "  senhas   privacidade senhas " })),
        ).toEqual(["Senhas e privacidade", "Segurança"]);
      });

      it("finds nothing when one of the words is nowhere", async () => {
        expect(await itemsOf(route, { search: "senhas inexistente" })).toEqual([]);
      });

      it("takes a blank search as no search", async () => {
        const all = await itemsOf(route);

        expect(await itemsOf(route, { search: "   " })).toEqual(all);
        expect(await itemsOf(route, { search: "" })).toEqual(all);
      });

      it("takes % and _ as the characters themselves, never as wildcards", async () => {
        expect(titlesOf(await itemsOf(route, { search: "50%" }))).toEqual([
          "Desconto de 50% na prova",
        ]);
        expect(titlesOf(await itemsOf(route, { search: "%" }))).toEqual([
          "Desconto de 50% na prova",
        ]);
        expect(titlesOf(await itemsOf(route, { search: "_" }))).toEqual(["Aula_de_reforço"]);
        expect(titlesOf(await itemsOf(route, { search: "a_d" }))).toEqual(["Aula_de_reforço"]);
        expect(await itemsOf(route, { search: "\\" })).toEqual([]);
      });

      it("combines with the other filters", async () => {
        expect(
          titlesOf(await itemsOf(route, { search: "senhas privacidade", classId: classA })),
        ).toEqual(["Senhas e privacidade", "Segurança"]);
        expect(
          titlesOf(await itemsOf(route, { search: "senhas privacidade", status: "cancelled" })),
        ).toEqual(["Segurança"]);
        expect(await itemsOf(route, { search: "senhas privacidade", classId: classB })).toEqual([]);
      });

      it("does not search the archived class unless classId asks for it", async () => {
        await lesson({ classId: classC, title: "Senhas na turma arquivada", date: "2026-03-16" });

        expect(titlesOf(await itemsOf(route, { search: "senhas arquivada" }))).toEqual([]);
        expect(
          titlesOf(await itemsOf(route, { search: "senhas arquivada", classId: classC })),
        ).toEqual(["Senhas na turma arquivada"]);
      });
    });

    describe("the colors", () => {
      it("gives each class the color of the order it was created in: the first is 0, the second 1, the third 2", async () => {
        await lesson({ classId: classA, title: "A", date: "2026-03-10" });
        await lesson({ classId: classB, title: "B", date: "2026-03-11" });
        await lesson({ classId: classC, title: "C", date: "2026-03-12" });

        const items = await itemsOf(route, {}, member);
        const archived = await itemsOf(route, { classId: classC });

        expect(items.map((item) => [item.title, item.class.colorIndex])).toEqual([
          ["A", 0],
          ["B", 1],
        ]);
        expect(archived.map((item) => [item.title, item.class.colorIndex])).toEqual([["C", 2]]);
      });

      it("does not change the color of a class with the filters: B is 1 with and without classId=B", async () => {
        await lesson({
          classId: classA,
          title: "A",
          date: "2026-03-10",
          status: LessonStatus.DONE,
        });
        await lesson({ classId: classB, title: "B", date: "2026-03-11" });

        const colorOfB = async (query: Query): Promise<number[]> =>
          (await itemsOf(route, query))
            .filter((item) => item.class.id === classB)
            .map((item) => item.class.colorIndex);

        expect(await colorOfB({})).toEqual([1]);
        expect(await colorOfB({ classId: classB })).toEqual([1]);
        expect(await colorOfB({ courseId: courseY })).toEqual([1]);
        expect(await colorOfB({ status: "planned" })).toEqual([1]);
        expect(await colorOfB({ search: "B" })).toEqual([1]);
        expect(await colorOfB({ from: "2026-03-11", to: "2026-03-11" })).toEqual([1]);
      });

      it("does not change the color of a class when another one is archived", async () => {
        await lesson({ classId: classB, title: "B", date: "2026-03-11" });
        const before = (await itemsOf(route))[0].class.colorIndex;

        await classesService.archive(classA, undefined, director.id);

        expect((await itemsOf(route))[0].class.colorIndex).toBe(before);
        expect(before).toBe(1);
      });

      it("reuses the colors from the ninth class on: rank 8 is color 7 and rank 9 is color 0 again", async () => {
        // INFO-A, SEG-B and INFO-C are ranks 1 to 3; six more make the ninth.
        const more: string[] = [];
        for (const code of ["T-4", "T-5", "T-6", "T-7", "T-8", "T-9"]) {
          more.push(await createClassOf(courseX, code));
        }
        await lesson({ classId: more[4], title: "oitava", date: "2026-03-10" });
        await lesson({ classId: more[5], title: "nona", date: "2026-03-11" });

        const items = await itemsOf(route);

        expect(items.map((item) => [item.title, item.class.colorIndex])).toEqual([
          ["oitava", 7],
          ["nona", 0],
        ]);
      });
    });
  });

  describe("GET /lessons (listLessons)", () => {
    describe("pagination", () => {
      /**
       * 25 lessons of the class A, with days and times that repeat every 15 lessons, so the first
       * ten have the same day and start time as the last ten, and only the id tells them apart.
       */
      async function seed25(): Promise<Lesson[]> {
        const created: Lesson[] = [];
        for (let index = 0; index < 25; index += 1) {
          const day = String(3 + (index % 5)).padStart(2, "0");
          const hour = String(8 + (index % 3)).padStart(2, "0");
          created.push(
            await lesson({
              title: `Aula ${index + 1}`,
              date: `2026-03-${day}`,
              startTime: `${hour}:00`,
              endTime: `${hour}:50`,
            }),
          );
        }
        return created;
      }

      it("paginates: default limit 20, with the total, the page and the limit", async () => {
        await seed25();

        const res = await getList(member).expect(200);
        const page = res.body as PageBody;

        expect(page.data).toHaveLength(20);
        expect(page.total).toBe(25);
        expect(page.page).toBe(1);
        expect(page.limit).toBe(20);
      });

      it("answers the last 5 on page 3 of limit 10, and none repeats across the pages", async () => {
        await seed25();

        const ids: string[] = [];
        for (const pageNumber of [1, 2, 3]) {
          const res = await getList(member, { page: pageNumber, limit: 10 }).expect(200);
          const page = res.body as PageBody;

          expect(page.total).toBe(25);
          expect(page.page).toBe(pageNumber);
          expect(page.limit).toBe(10);
          expect(page.data).toHaveLength(pageNumber === 3 ? 5 : 10);
          ids.push(...page.data.map((item) => item.id));
        }

        expect(new Set(ids).size).toBe(25);
        // And the three pages together are the order of the whole list.
        const all = await itemsOf("/lessons");
        expect(ids).toEqual(all.map((item) => item.id));
      });

      it("orders the whole list by day and start time, and by id where both are the same", async () => {
        await seed25();

        const all = await itemsOf("/lessons");

        let ties = 0;
        for (let index = 1; index < all.length; index += 1) {
          const before = all[index - 1];
          const current = all[index];
          const slotBefore = `${before.date} ${before.startTime}`;
          const slot = `${current.date} ${current.startTime}`;

          expect(slot >= slotBefore).toBe(true);
          if (slot === slotBefore) {
            ties += 1;
            expect(current.id > before.id).toBe(true);
          }
        }
        // The scenery does have lessons at the same day and time: the id was needed.
        expect(ties).toBeGreaterThan(0);
      });

      it("answers an empty page, with the total, past the last one", async () => {
        await seed25();

        const res = await getList(member, { page: 4, limit: 10 }).expect(200);

        expect(res.body).toEqual({ data: [], total: 25, page: 4, limit: 10 });
      });

      it("answers an empty page when there is no lesson", async () => {
        const res = await getList(member).expect(200);

        expect(res.body).toEqual({ data: [], total: 0, page: 1, limit: 20 });
      });

      it("counts only the lessons that match the filters", async () => {
        await seed25();
        await lesson({ classId: classB, title: "De outra turma" });

        const res = await getList(member, { classId: classB }).expect(200);

        expect((res.body as PageBody).total).toBe(1);
      });

      it("answers 400 VALIDATION_FAILED for a limit above 100, a limit or page below 1 and what is not a number", async () => {
        for (const [field, value] of [
          ["limit", 101],
          ["limit", 0],
          ["page", 0],
          ["page", -1],
          ["limit", "abc"],
          ["page", "1.5"],
        ] as const) {
          const res = await getList(member, { [field]: value }).expect(400);

          expect(res.body.error).toBe("VALIDATION_FAILED");
          expect(fieldsOf(res.body)).toEqual([field]);
        }
      });

      it("takes a limit of 100", async () => {
        const res = await getList(member, { limit: 100 }).expect(200);

        expect((res.body as PageBody).limit).toBe(100);
      });
    });

    describe("the period", () => {
      beforeEach(async () => {
        await lesson({ title: "Mar 09", date: "2026-03-09" });
        await lesson({ title: "Mar 10", date: "2026-03-10" });
        await lesson({ title: "Mar 11", date: "2026-03-11" });
        await lesson({ title: "Mar 12", date: "2026-03-12" });
        await lesson({ title: "Mar 13", date: "2026-03-13" });
      });

      it("takes from alone: that day on, the day included", async () => {
        expect(titlesOf(await itemsOf("/lessons", { from: "2026-03-11" }))).toEqual([
          "Mar 11",
          "Mar 12",
          "Mar 13",
        ]);
      });

      it("takes to alone: up to that day, the day included", async () => {
        expect(titlesOf(await itemsOf("/lessons", { to: "2026-03-11" }))).toEqual([
          "Mar 09",
          "Mar 10",
          "Mar 11",
        ]);
      });

      it("takes from and to together, both ends included", async () => {
        expect(
          titlesOf(await itemsOf("/lessons", { from: "2026-03-10", to: "2026-03-12" })),
        ).toEqual(["Mar 10", "Mar 11", "Mar 12"]);
      });

      it("takes a single day, from equal to to", async () => {
        expect(
          titlesOf(await itemsOf("/lessons", { from: "2026-03-11", to: "2026-03-11" })),
        ).toEqual(["Mar 11"]);
      });

      it("counts the total of the period, not of the table", async () => {
        const res = await getList(member, { from: "2026-03-10", to: "2026-03-12" }).expect(200);

        expect((res.body as PageBody).total).toBe(3);
      });

      it("does not limit the length of the period: the list is paginated", async () => {
        const items = await itemsOf("/lessons", { from: "2000-01-01", to: "2100-12-31" });

        expect(items).toHaveLength(5);
      });

      it("answers 400 INVALID_DATE_RANGE, pointing at to, when from is after to", async () => {
        const res = await getList(member, { from: "2026-03-12", to: "2026-03-10" }).expect(400);

        expect(res.body.error).toBe("INVALID_DATE_RANGE");
        expect(fieldsOf(res.body)).toEqual(["to"]);
      });

      it("answers 400 VALIDATION_FAILED for a day that does not exist or is not YYYY-MM-DD", async () => {
        for (const invalid of ["2026-3-1", "2026-02-30", "01/03/2026", "20260301"]) {
          const resFrom = await getList(member, { from: invalid }).expect(400);
          const resTo = await getList(member, { to: invalid }).expect(400);

          expect(resFrom.body.error).toBe("VALIDATION_FAILED");
          expect(fieldsOf(resFrom.body)).toEqual(["from"]);
          expect(resTo.body.error).toBe("VALIDATION_FAILED");
          expect(fieldsOf(resTo.body)).toEqual(["to"]);
        }
      });
    });

    describe("the query string", () => {
      it("answers 400 VALIDATION_FAILED, pointing at the field, for an id that is not a uuid", async () => {
        for (const field of ["classId", "courseId", "lessonPlanId"]) {
          const res = await getList(member, { [field]: "not-a-uuid" }).expect(400);

          expect(res.body.error).toBe("VALIDATION_FAILED");
          expect(fieldsOf(res.body)).toEqual([field]);
        }
      });

      it("answers 400 VALIDATION_FAILED for a status that does not exist, and for two statuses: it takes one", async () => {
        const unknown = await getList(member, { status: "x" }).expect(400);
        const two = await request(app.getHttpServer())
          .get("/lessons?status=planned&status=done")
          .set("Cookie", member.cookie)
          .expect(400);

        expect(unknown.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(unknown.body)).toEqual(["status"]);
        expect(two.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(two.body)).toEqual(["status"]);
      });

      it("answers 400 VALIDATION_FAILED for a search of 101 characters, and takes one of 100", async () => {
        const tooLong = await getList(member, { search: "s".repeat(101) }).expect(400);

        expect(tooLong.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(tooLong.body)).toEqual(["search"]);
        await getList(member, { search: "s".repeat(100) }).expect(200);
      });

      it("ignores a parameter it does not know", async () => {
        await lesson();

        const res = await getList(member, { sort: "title", teacherId: UNKNOWN_ID }).expect(200);

        expect((res.body as PageBody).data).toHaveLength(1);
      });

      it("answers 400 with every field that is wrong at once", async () => {
        const res = await getList(member, {
          classId: "x",
          status: "y",
          from: "z",
          limit: 500,
        }).expect(400);

        expect(fieldsOf(res.body)).toEqual(["classId", "from", "limit", "status"]);
      });
    });

    describe("next to the other routes", () => {
      it("keeps answering GET /lessons/:id with the lesson in full", async () => {
        const created = await lesson({ title: "Senhas e privacidade" });

        const res = await request(app.getHttpServer())
          .get(`/lessons/${created.id}`)
          .set("Cookie", member.cookie)
          .expect(200);

        expect(res.body).toMatchObject({ id: created.id, title: "Senhas e privacidade" });
        expect(res.body.course).toMatchObject({ id: courseX });
      });

      it("keeps answering 404 LESSON_NOT_FOUND for the id of a lesson that does not exist", async () => {
        const res = await request(app.getHttpServer())
          .get(`/lessons/${UNKNOWN_ID}`)
          .set("Cookie", member.cookie)
          .expect(404);

        expect(res.body.error).toBe("LESSON_NOT_FOUND");
      });

      it("writes nothing: a read leaves the table as it was", async () => {
        await seedFilterScenario();
        const before = await dataSource.query(`SELECT * FROM lessons ORDER BY id`);

        await getList(member, { search: "senhas privacidade" }).expect(200);
        await getCalendar(member, GRID).expect(200);

        expect(await dataSource.query(`SELECT * FROM lessons ORDER BY id`)).toEqual(before);
      });
    });
  });

  describe("GET /lessons/calendar (listLessonsCalendar)", () => {
    /**
     * 25 lessons between 2026-03-03 and 2026-04-11 (two classes, one of them cancelled), and one on
     * 2026-04-13, two days after the end of the month grid.
     */
    async function seedMonth(): Promise<{ inside: Lesson[]; outside: Lesson }> {
      const inside: Lesson[] = [];
      for (let index = 0; index < 25; index += 1) {
        // From 03-03 to 04-11, one a day and then some days twice: 40 days in the window.
        const offset = (index * 3) % 40;
        const date = new Date(Date.UTC(2026, 2, 3 + offset));
        const iso = date.toISOString().slice(0, 10);
        inside.push(
          await lesson({
            classId: index % 2 === 0 ? classA : classB,
            title: `Aula ${index + 1}`,
            date: iso,
            startTime: index % 4 === 0 ? "09:00" : "14:00",
            endTime: index % 4 === 0 ? "10:30" : "15:30",
            status: index === 7 ? LessonStatus.CANCELLED : LessonStatus.PLANNED,
          }),
        );
      }
      const outside = await lesson({ title: "Fora do mês", date: "2026-04-13" });
      return { inside, outside };
    }

    it("returns every lesson of the month grid in one call, without pagination", async () => {
      const { inside, outside } = await seedMonth();

      const res = await getCalendar(member, GRID).expect(200);
      const items = res.body as ItemBody[];

      // 25 is more than the 20 of a page of the list: nothing was cut.
      expect(Array.isArray(res.body)).toBe(true);
      expect(items).toHaveLength(25);
      expect(items.map((item) => item.id)).not.toContain(outside.id);
      expect(new Set(items.map((item) => item.id))).toEqual(new Set(inside.map((l) => l.id)));
      // No page envelope.
      expect(res.body).not.toHaveProperty("total");
      expect(res.body).not.toHaveProperty("page");
      expect(res.body).not.toHaveProperty("data");
    });

    it("answers the lessons of the month in the order date, start time, id", async () => {
      await seedMonth();

      const items = (await getCalendar(member, GRID).expect(200)).body as ItemBody[];
      const keys = items.map((item) => `${item.date} ${item.startTime}`);

      expect(keys).toEqual([...keys].sort());
    });

    it("includes the cancelled lesson and the lessons of both classes, each with its own color", async () => {
      await seedMonth();

      const items = (await getCalendar(member, GRID).expect(200)).body as ItemBody[];

      expect(items.filter((item) => item.status === "cancelled")).toHaveLength(1);
      expect(
        new Set(items.map((item) => [item.class.code, item.class.colorIndex].join(":"))),
      ).toEqual(new Set(["INFO-A:0", "SEG-B:1"]));
    });

    it("takes the ends of the period: the first and the last day of the grid", async () => {
      await lesson({ title: "Antes", date: "2026-02-28" });
      await lesson({ title: "Primeiro dia", date: "2026-03-01" });
      await lesson({ title: "Último dia", date: "2026-04-11" });
      await lesson({ title: "Depois", date: "2026-04-12" });

      const items = (await getCalendar(member, GRID).expect(200)).body as ItemBody[];

      expect(titlesOf(items)).toEqual(["Primeiro dia", "Último dia"]);
    });

    it("answers a week: a period of seven days", async () => {
      await lesson({ title: "Segunda", date: "2026-03-09" });
      await lesson({ title: "Domingo", date: "2026-03-15" });
      await lesson({ title: "Segunda seguinte", date: "2026-03-16" });

      const res = await getCalendar(member, { from: "2026-03-09", to: "2026-03-15" }).expect(200);

      expect(titlesOf(res.body as ItemBody[])).toEqual(["Segunda", "Domingo"]);
    });

    it("answers a single day, from equal to to", async () => {
      await lesson({ title: "Dia 10", date: "2026-03-10" });
      await lesson({ title: "Dia 11", date: "2026-03-11" });

      const res = await getCalendar(member, { from: "2026-03-10", to: "2026-03-10" }).expect(200);

      expect(titlesOf(res.body as ItemBody[])).toEqual(["Dia 10"]);
    });

    it("answers an empty array for a period with no lesson", async () => {
      const res = await getCalendar(member, GRID).expect(200);

      expect(res.body).toEqual([]);
    });

    it("answers a period that crosses the end of the year", async () => {
      await lesson({ title: "Dezembro", date: "2026-12-30" });
      await lesson({ title: "Janeiro", date: "2027-01-02" });

      const res = await getCalendar(member, { from: "2026-12-28", to: "2027-01-10" }).expect(200);

      expect(titlesOf(res.body as ItemBody[])).toEqual(["Dezembro", "Janeiro"]);
    });

    it("ignores page and limit: there is nothing to page", async () => {
      await seedMonth();

      const res = await getCalendar(member, { ...GRID, page: 2, limit: 3 }).expect(200);

      expect(res.body).toHaveLength(25);
    });

    describe("the period", () => {
      it("answers 400 VALIDATION_FAILED, pointing at from and to, without a query", async () => {
        const res = await getCalendar(member).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["from", "to"]);
      });

      it("answers 400 VALIDATION_FAILED, pointing at the one that is missing", async () => {
        const noTo = await getCalendar(member, { from: "2026-03-01" }).expect(400);
        const noFrom = await getCalendar(member, { to: "2026-04-11" }).expect(400);

        expect(noTo.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(noTo.body)).toEqual(["to"]);
        expect(noFrom.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(noFrom.body)).toEqual(["from"]);
      });

      it("answers 400 VALIDATION_FAILED for a day that is not YYYY-MM-DD, like 2026-3-1, or does not exist", async () => {
        for (const invalid of ["2026-3-1", "2026-02-30", "01/03/2026", "20260301", ""]) {
          const resFrom = await getCalendar(member, { from: invalid, to: "2026-04-11" }).expect(
            400,
          );
          const resTo = await getCalendar(member, { from: "2026-03-01", to: invalid }).expect(400);

          expect(resFrom.body.error).toBe("VALIDATION_FAILED");
          expect(fieldsOf(resFrom.body)).toEqual(["from"]);
          expect(resTo.body.error).toBe("VALIDATION_FAILED");
          expect(fieldsOf(resTo.body)).toEqual(["to"]);
        }
      });

      it("answers 400 DATE_RANGE_TOO_LONG, pointing at to, for 43 days", async () => {
        const res = await getCalendar(member, { from: "2026-03-01", to: "2026-04-12" }).expect(400);

        expect(res.body.error).toBe("DATE_RANGE_TOO_LONG");
        expect(fieldsOf(res.body)).toEqual(["to"]);
      });

      it("answers 200 for 42 days, counting both ends", async () => {
        await getCalendar(member, { from: "2026-03-01", to: "2026-04-11" }).expect(200);
        await getCalendar(member, { from: "2026-03-02", to: "2026-04-12" }).expect(200);
      });

      it("counts the days of a leap February: 2024-02-01 to 2024-03-13 are 42 days, to 03-14 are 43", async () => {
        await getCalendar(member, { from: "2024-02-01", to: "2024-03-13" }).expect(200);
        const res = await getCalendar(member, { from: "2024-02-01", to: "2024-03-14" }).expect(400);

        expect(res.body.error).toBe("DATE_RANGE_TOO_LONG");
      });

      it("answers 400 DATE_RANGE_TOO_LONG for a whole year", async () => {
        const res = await getCalendar(member, { from: "2026-01-01", to: "2026-12-31" }).expect(400);

        expect(res.body.error).toBe("DATE_RANGE_TOO_LONG");
      });

      it("answers 400 INVALID_DATE_RANGE, pointing at to, when from is after to", async () => {
        const res = await getCalendar(member, { from: "2026-04-11", to: "2026-03-01" }).expect(400);

        expect(res.body.error).toBe("INVALID_DATE_RANGE");
        expect(fieldsOf(res.body)).toEqual(["to"]);
      });

      it("answers INVALID_DATE_RANGE, and not DATE_RANGE_TOO_LONG, for a long period upside down", async () => {
        const res = await getCalendar(member, { from: "2026-12-31", to: "2026-01-01" }).expect(400);

        expect(res.body.error).toBe("INVALID_DATE_RANGE");
      });

      it("answers the period error before looking for any lesson, filters or not", async () => {
        await seedMonth();

        const res = await getCalendar(member, {
          from: "2026-03-01",
          to: "2026-04-12",
          classId: UNKNOWN_ID,
        }).expect(400);

        expect(res.body.error).toBe("DATE_RANGE_TOO_LONG");
      });
    });

    describe("the filters of the list, with the same validation", () => {
      it("answers 400 VALIDATION_FAILED for an id that is not a uuid, a status that does not exist and a search of 101 characters", async () => {
        const classId = await getCalendar(member, { ...GRID, classId: "x" }).expect(400);
        const status = await getCalendar(member, { ...GRID, status: "x" }).expect(400);
        const search = await getCalendar(member, { ...GRID, search: "s".repeat(101) }).expect(400);

        expect(fieldsOf(classId.body)).toEqual(["classId"]);
        expect(fieldsOf(status.body)).toEqual(["status"]);
        expect(fieldsOf(search.body)).toEqual(["search"]);
      });
    });

    describe("next to GET /lessons/:id", () => {
      it("GET /lessons/calendar without query answers 400 VALIDATION_FAILED, not 404 LESSON_NOT_FOUND", async () => {
        const res = await getCalendar(member).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(res.body.error).not.toBe("LESSON_NOT_FOUND");
      });

      it("answers the calendar, and not 404, for the word calendar in the place of an id", async () => {
        await lesson({ title: "Dia 10", date: "2026-03-10" });

        const res = await getCalendar(director, GRID).expect(200);

        expect(titlesOf(res.body as ItemBody[])).toEqual(["Dia 10"]);
      });
    });
  });

  describe("LessonListingService.findAgendaBetween and findAgendaByIds (exported, GUS-160)", () => {
    let listing: LessonListingService;

    beforeEach(() => {
      listing = module.get(LessonListingService);
    });

    it("answers the lessons of the period, both ends included, without the cancelled ones and without the archived class, in order", async () => {
      await seedFilterScenario();
      await lesson({ title: "Antes do período", date: "2026-03-09" });
      await lesson({
        title: "Depois do período",
        date: "2026-03-13",
        startTime: "16:00",
        endTime: "17:00",
      });

      const agenda = await listing.findAgendaBetween("2026-03-10", "2026-03-12");

      // Golpes (B, 09:00) before Senhas (A, 14:00) on the 10th; the archived INFO-C, the
      // cancelled lessons of the 11th and the 13th and the two days outside are left out.
      expect(agenda.map((ref) => ref.title)).toEqual([
        "Golpes na internet",
        "Senhas e privacidade",
        "Redes sociais",
        "Navegação segura",
      ]);
    });

    it("answers the class label (name or code), the position and the place of each lesson, and HH:mm times", async () => {
      const arquivos = await lesson({
        title: "Arquivos e pastas",
        lessonPlanId: planP,
        sequenceOrder: 3,
        location: "Laboratório 2",
        expectedMonitors: 3,
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
      });
      const golpes = await lesson({
        classId: classB,
        title: "Golpes na internet",
        date: "2026-03-11",
        startTime: "09:00",
        endTime: "10:30",
      });

      await expect(listing.findAgendaBetween("2026-03-09", "2026-03-15")).resolves.toEqual([
        {
          id: arquivos.id,
          title: "Arquivos e pastas",
          sequenceOrder: 3,
          date: "2026-03-10",
          startTime: "14:00",
          endTime: "15:30",
          location: "Laboratório 2",
          status: LessonStatus.PLANNED,
          expectedMonitors: 3,
          classActive: true,
          class: { id: classA, code: "INFO-A", name: "Informática Básica, turma A" },
        },
        {
          id: golpes.id,
          title: "Golpes na internet",
          sequenceOrder: null,
          date: "2026-03-11",
          startTime: "09:00",
          endTime: "10:30",
          location: null,
          status: LessonStatus.PLANNED,
          expectedMonitors: null,
          classActive: true,
          class: { id: classB, code: "SEG-B", name: "SEG-B" },
        },
      ]);
    });

    it("answers the lessons asked by id, cancelled ones and archived classes included, skipping unknown and malformed ids", async () => {
      const cancelled = await lesson({
        title: "Cancelada",
        date: "2026-03-12",
        status: LessonStatus.CANCELLED,
      });
      const archived = await lesson({
        classId: classC,
        title: "Da turma arquivada",
        date: "2026-03-11",
      });
      const planned = await lesson({ title: "Planejada", date: "2026-03-10" });

      const agenda = await listing.findAgendaByIds([
        cancelled.id,
        archived.id,
        planned.id,
        planned.id,
        UNKNOWN_ID,
        "not-a-uuid",
      ]);

      expect(agenda.map((ref) => [ref.title, ref.status, ref.class.code, ref.classActive])).toEqual(
        [
          ["Planejada", LessonStatus.PLANNED, "INFO-A", true],
          ["Da turma arquivada", LessonStatus.PLANNED, "INFO-C", false],
          ["Cancelada", LessonStatus.CANCELLED, "INFO-A", true],
        ],
      );
    });
  });
});
