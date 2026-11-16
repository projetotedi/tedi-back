import "reflect-metadata";
import { INestApplication, Logger } from "@nestjs/common";
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
import { CourseLessonPlansService } from "@modules/catalog/services/course-lesson-plans.service";
import { CoursesService } from "@modules/catalog/services/courses.service";
import { LessonPlansService } from "@modules/catalog/services/lesson-plans.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { LESSON_CANCELLED_EVENT } from "@shared/events/lesson-cancelled.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { LessonsModule } from "../lessons.module";
import { LessonCreationService } from "../services/lesson-creation.service";
import {
  CLASS_PERIOD,
  GENERATION_PLAN_TITLES,
  generationBody,
  SHORT_CLASS_PERIOD,
} from "./fixtures/lessons.fixture";

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

process.env.JWT_SECRET = "e2e-lesson-generation-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

/** The days of a tuesday series from 2026-04-07: one lesson a week, one plan each. */
const SERIES_DATES = ["2026-04-07", "2026-04-14", "2026-04-21", "2026-04-28"] as const;

const LOCATION = "Laboratório 2 — Bloco B";

/** What each plan of the sequence says it is for. The last one has no objective: null is copied too. */
const PLAN_OBJECTIVES: Record<(typeof GENERATION_PLAN_TITLES)[number], string | null> = {
  "Conhecendo o computador": "Reconhecer as partes do computador e ligar e desligar com segurança.",
  "Teclado, mouse e janelas":
    "Familiarizar o aluno com o teclado, o mouse e o uso básico das janelas.",
  "Navegando na internet": "Usar o navegador para pesquisar e abrir sites.",
  "Senhas e privacidade": null,
};

type CreateCourseInput = Parameters<CoursesService["create"]>[0];

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface PreviewItem {
  sequenceOrder: number;
  lessonPlanId: string;
  title: string;
  date: string;
  expectedDurationMinutes: number;
  outsideClassPeriod: boolean;
}

interface PreviewBody {
  classId: string;
  classStartDate: string;
  classEndDate: string;
  weekday: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  location: string | null;
  lessonCount: number;
  outsideClassPeriodCount: number;
  items: PreviewItem[];
  skippedLessonPlans: Array<{
    sequenceOrder: number;
    lessonPlanId: string;
    title: string;
    archivedAt: string;
  }>;
}

interface GeneratedLesson extends Record<string, unknown> {
  id: string;
  class: { id: string; code: string; startDate: string; endDate: string };
  course: { id: string; name: string };
  lessonPlan: { id: string; title: string; archivedAt: string | null } | null;
  sequenceOrder: number | null;
  title: string;
  objective: string | null;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  location: string | null;
  status: string;
}

interface GeneratedBody {
  classId: string;
  lessons: GeneratedLesson[];
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

describe("Generation of the lessons of a class (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonPlansService: LessonPlansService;
  let courseLessonPlansService: CourseLessonPlansService;
  let lessonCreation: LessonCreationService;

  let director: Actor;
  let coordinator: Actor;
  let member: Actor;
  let superadmin: Actor;
  let courseId: string;
  let classId: string;
  /** The four lesson plans of the sequence of the course, in the order of the sequence. */
  let planIds: string[];

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
    // One server up for the whole suite: supertest would otherwise open and close it around each
    // request, and the close of one request resets a concurrent one (the concurrency tests below).
    await app.listen(0);

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    jwtService = module.get(JwtService);
    eventEmitter = module.get(EventEmitter2);
    coursesService = module.get(CoursesService);
    classesService = module.get(ClassesService);
    lessonPlansService = module.get(LessonPlansService);
    courseLessonPlansService = module.get(CourseLessonPlansService);
    // Not exported by LessonsModule, and it does not need to be: the test reaches it to make the
    // creation fail in the middle of a generation.
    lessonCreation = module.get(LessonCreationService);
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

    courseId = await createCourse("Informática Básica");
    classId = await createClassOf(courseId, "INFO-A");
    planIds = [];
    for (const title of GENERATION_PLAN_TITLES) {
      planIds.push(await createPlan(title, PLAN_OBJECTIVES[title]));
    }
    await courseLessonPlansService.replace(courseId, { lessonPlanIds: planIds }, director.id);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
    eventEmitter.removeAllListeners(LESSON_CANCELLED_EVENT);
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

  /** A class of the course in 2026.1, from 2026-03-03 to 2026-06-27 unless the period is given. */
  async function createClassOf(
    forCourseId: string,
    code: string,
    period: { startDate: string; endDate: string } = CLASS_PERIOD,
  ): Promise<string> {
    const schoolClass = await classesService.create(
      { courseId: forCourseId, code, editionName: "2026.1", ...period, capacity: 15 },
      director.id,
    );
    return schoolClass.id;
  }

  async function createPlan(title: string, objective: string | null): Promise<string> {
    const plan = await lessonPlansService.create(
      { title, objective, expectedDurationMinutes: 90, contents: ["Teclado e mouse"] },
      director.id,
    );
    return plan.id;
  }

  function postPreview(id: string, actor: Actor, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/classes/${id}/lessons/preview`)
      .set("Cookie", actor.cookie)
      .send(payload);
  }

  function postGenerate(id: string, actor: Actor, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/classes/${id}/lessons/generate`)
      .set("Cookie", actor.cookie)
      .send(payload);
  }

  function postLesson(actor: Actor, payload: Record<string, unknown>) {
    return request(app.getHttpServer()).post("/lessons").set("Cookie", actor.cookie).send(payload);
  }

  function getLesson(id: string, actor: Actor) {
    return request(app.getHttpServer()).get(`/lessons/${id}`).set("Cookie", actor.cookie);
  }

  function cancelLesson(id: string, actor: Actor) {
    return request(app.getHttpServer())
      .patch(`/lessons/${id}/cancel`)
      .set("Cookie", actor.cookie)
      .send({ reason: "Feriado." });
  }

  /** Both routes with the same arguments, so a rule that belongs to the two is tested on both. */
  const routes = [
    ["preview", postPreview],
    ["generate", postGenerate],
  ] as const;

  async function generateSeries(): Promise<GeneratedBody> {
    const res = await postGenerate(classId, director, generationBody()).expect(201);
    return res.body as GeneratedBody;
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  async function countLessons(): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM lessons`,
    );
    return Number(rows[0].total);
  }

  /** The row as the table has it, with the dates and the times as text so no time zone gets in the way. */
  async function storedLesson(id: string): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT class_id, lesson_plan_id, sequence_order, title, objective, date::text AS date,
              start_time::text AS start_time, end_time::text AS end_time, location,
              expected_students, expected_monitors, subject, post_notes, status, cancel_reason,
              cancelled_at, cancelled_by_id, original_date::text AS original_date,
              reschedule_reason, reschedule_note, created_by_id, deleted_at
         FROM lessons WHERE id = $1`,
      [id],
    );
    return rows[0];
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

  /**
   * A transaction of its own that stays open until `release`, as a concurrent request would. `run`
   * runs a statement inside it; `release` commits it. A test that opens one always releases it in a
   * `finally`: an open transaction would hold the next TRUNCATE.
   */
  async function openTransaction() {
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();

    return {
      run: (sql: string, parameters: unknown[] = []) => holder.query(sql, parameters),
      release: async () => {
        await holder.commitTransaction();
        await holder.release();
      },
    };
  }

  /** Holds the row of a table with the lock that is asked, as a write of another module does. */
  async function holdRow(table: "classes" | "courses" | "lesson_plans", id: string, lock: string) {
    const holder = await openTransaction();
    await holder.run(`SELECT id FROM ${table} WHERE id = $1 ${lock}`, [id]);
    return holder;
  }

  /** Holds the advisory lock that a generation of the class takes, as another generation does. */
  async function holdGenerationLock(forClassId: string) {
    const holder = await openTransaction();
    await holder.run(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `lessons.generate:${forClassId}`,
    ]);
    return holder;
  }

  describe("POST /classes/:id/lessons/preview (previewClassLessons)", () => {
    it("previews one lesson per plan of the course, weekly from 2026-04-07, in the order of the sequence", async () => {
      const res = await postPreview(classId, coordinator, generationBody()).expect(200);

      expect(res.body).toEqual({
        classId,
        classStartDate: "2026-03-03",
        classEndDate: "2026-06-27",
        weekday: "tuesday",
        startTime: "09:00",
        endTime: "11:00",
        // What each lesson will last, from the two times of the body...
        durationMinutes: 120,
        location: LOCATION,
        lessonCount: 4,
        outsideClassPeriodCount: 0,
        // ...and the duration each plan expects, which is the one the Figma shows.
        items: GENERATION_PLAN_TITLES.map((title, index) => ({
          sequenceOrder: index + 1,
          lessonPlanId: planIds[index],
          title,
          date: SERIES_DATES[index],
          expectedDurationMinutes: 90,
          outsideClassPeriod: false,
        })),
        skippedLessonPlans: [],
      });
    });

    it("preview writes no lesson and emits no event", async () => {
      const events = collectEvents();

      await postPreview(classId, coordinator, generationBody()).expect(200);
      // The preview can be asked again and again: nothing was written that could block it.
      await postPreview(classId, coordinator, generationBody()).expect(200);

      expect(await countLessons()).toBe(0);
      expect(events).toHaveLength(0);
    });

    it("answers location null when the body has none, or a blank one", async () => {
      for (const location of [undefined, null, "", "   "]) {
        const res = await postPreview(classId, director, generationBody({ location })).expect(200);

        expect(res.body.location).toBeNull();
      }
    });

    it("marks the 4th lesson outsideClassPeriod when the class ends on 2026-04-24", async () => {
      const shortClassId = await createClassOf(courseId, "INFO-B", SHORT_CLASS_PERIOD);

      const res = await postPreview(shortClassId, coordinator, generationBody()).expect(200);

      const body = res.body as PreviewBody;
      expect(body.classEndDate).toBe("2026-04-24");
      expect(body.lessonCount).toBe(4);
      expect(body.outsideClassPeriodCount).toBe(1);
      expect(body.items.map((item) => [item.date, item.outsideClassPeriod])).toEqual([
        ["2026-04-07", false],
        ["2026-04-14", false],
        ["2026-04-21", false],
        ["2026-04-28", true],
      ]);
      // The preview only marks it: it still answers, and nothing was written.
      expect(await countLessons()).toBe(0);
    });

    it("marks the 1st lesson outside when firstDate is before startDate", async () => {
      // The class starts on 2026-04-10 (a friday): the tuesday of 2026-04-07 is before it.
      const lateClassId = await createClassOf(courseId, "INFO-B", {
        startDate: "2026-04-10",
        endDate: "2026-06-27",
      });

      const res = await postPreview(lateClassId, coordinator, generationBody()).expect(200);

      const body = res.body as PreviewBody;
      expect(body.outsideClassPeriodCount).toBe(1);
      expect(body.items.map((item) => [item.date, item.outsideClassPeriod])).toEqual([
        ["2026-04-07", true],
        ["2026-04-14", false],
        ["2026-04-21", false],
        ["2026-04-28", false],
      ]);
    });

    it("takes the first and the last day of the class as inside: both ends take a lesson", async () => {
      const exactClassId = await createClassOf(courseId, "INFO-B", {
        startDate: "2026-04-07",
        endDate: "2026-04-28",
      });

      const res = await postPreview(exactClassId, coordinator, generationBody()).expect(200);

      expect(res.body.outsideClassPeriodCount).toBe(0);
    });

    it("firstDate on a Monday with weekday tuesday starts on Tuesday", async () => {
      // 2026-04-06 is a monday: "from this date" means the tuesday that follows, never the one before.
      const res = await postPreview(
        classId,
        coordinator,
        generationBody({ firstDate: "2026-04-06" }),
      ).expect(200);

      expect((res.body as PreviewBody).items.map((item) => item.date)).toEqual([...SERIES_DATES]);
    });

    it("keeps firstDate when it is already the weekday, and goes to the next week when it has passed", async () => {
      const sameDay = await postPreview(classId, director, generationBody()).expect(200);
      // 2026-04-08 is a wednesday: this week's tuesday has gone by.
      const passed = await postPreview(
        classId,
        director,
        generationBody({ firstDate: "2026-04-08" }),
      ).expect(200);

      expect((sameDay.body as PreviewBody).items[0].date).toBe("2026-04-07");
      expect((passed.body as PreviewBody).items[0].date).toBe("2026-04-14");
    });

    it("builds the series on any weekday: a friday series from a tuesday", async () => {
      const res = await postPreview(
        classId,
        director,
        generationBody({ weekday: "friday" }),
      ).expect(200);

      expect((res.body as PreviewBody).items.map((item) => item.date)).toEqual([
        "2026-04-10",
        "2026-04-17",
        "2026-04-24",
        "2026-05-01",
      ]);
    });

    it("an archived plan in the sequence is skipped and listed in skippedLessonPlans", async () => {
      await lessonPlansService.archive(planIds[1], undefined, director.id);

      const res = await postPreview(classId, coordinator, generationBody()).expect(200);

      const body = res.body as PreviewBody;
      expect(body.lessonCount).toBe(3);
      // The days stay consecutive and each plan keeps its real position: the 2nd is just not there.
      expect(body.items.map((item) => [item.sequenceOrder, item.title, item.date])).toEqual([
        [1, "Conhecendo o computador", "2026-04-07"],
        [3, "Navegando na internet", "2026-04-14"],
        [4, "Senhas e privacidade", "2026-04-21"],
      ]);
      expect(body.skippedLessonPlans).toEqual([
        {
          sequenceOrder: 2,
          lessonPlanId: planIds[1],
          title: "Teclado, mouse e janelas",
          archivedAt: expect.any(String),
        },
      ]);
    });

    it("does not wait for the generation of the class that is in flight: a preview is a plain read", async () => {
      const generation = await holdGenerationLock(classId);

      let giveUp: NodeJS.Timeout | undefined;
      try {
        const outcome = await Promise.race([
          postPreview(classId, director, generationBody()).then((res) => res.status),
          new Promise<string>((resolve) => {
            giveUp = setTimeout(() => resolve("blocked"), 3000);
          }),
        ]);

        expect(outcome).toBe(200);
      } finally {
        clearTimeout(giveUp);
        await generation.release();
      }
    });
  });

  describe("POST /classes/:id/lessons/generate (generateClassLessons)", () => {
    it("generate creates the 4 lessons planned, copying title and objective, with lessonPlanId and sequenceOrder 1..4", async () => {
      const res = await postGenerate(classId, coordinator, generationBody()).expect(201);

      const body = res.body as GeneratedBody;
      expect(body.classId).toBe(classId);
      expect(body.lessons).toHaveLength(4);
      expect(await countLessons()).toBe(4);

      for (const [index, lesson] of body.lessons.entries()) {
        const title = GENERATION_PLAN_TITLES[index];
        expect(lesson).toEqual({
          id: expect.any(String),
          class: {
            id: classId,
            code: "INFO-A",
            name: null,
            startDate: "2026-03-03",
            endDate: "2026-06-27",
            archivedAt: null,
          },
          course: { id: courseId, name: "Informática Básica" },
          edition: { id: expect.any(String), name: "2026.1" },
          lessonPlan: { id: planIds[index], title, archivedAt: null },
          sequenceOrder: index + 1,
          title,
          objective: PLAN_OBJECTIVES[title],
          date: SERIES_DATES[index],
          startTime: "09:00",
          endTime: "11:00",
          durationMinutes: 120,
          location: LOCATION,
          expectedStudents: null,
          expectedMonitors: null,
          subject: null,
          postNotes: null,
          status: "planned",
          cancelReason: null,
          cancelledAt: null,
          cancelledById: null,
          originalDate: null,
          rescheduleReason: null,
          rescheduleNote: null,
          createdById: coordinator.id,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        });

        // What the table has is what the answer says.
        expect(await storedLesson(lesson.id)).toEqual({
          class_id: classId,
          lesson_plan_id: planIds[index],
          sequence_order: index + 1,
          title,
          objective: PLAN_OBJECTIVES[title],
          date: SERIES_DATES[index],
          start_time: "09:00:00",
          end_time: "11:00:00",
          location: LOCATION,
          expected_students: null,
          expected_monitors: null,
          subject: null,
          post_notes: null,
          status: "planned",
          cancel_reason: null,
          cancelled_at: null,
          cancelled_by_id: null,
          original_date: null,
          reschedule_reason: null,
          reschedule_note: null,
          created_by_id: coordinator.id,
          deleted_at: null,
        });
      }
      // The answer is in the order of the sequence, which is the order of the days.
      expect(body.lessons.map((lesson) => lesson.date)).toEqual([...SERIES_DATES]);
    });

    it("answers what the preview announced: the same days, titles and positions", async () => {
      const preview = (await postPreview(classId, coordinator, generationBody()).expect(200))
        .body as PreviewBody;

      const generated = (await postGenerate(classId, coordinator, generationBody()).expect(201))
        .body as GeneratedBody;

      expect(
        generated.lessons.map((lesson) => [lesson.sequenceOrder, lesson.title, lesson.date]),
      ).toEqual(preview.items.map((item) => [item.sequenceOrder, item.title, item.date]));
    });

    it("answers the lessons that GET /lessons/:id answers: they are lessons like any other", async () => {
      const generated = await generateSeries();

      for (const lesson of generated.lessons) {
        const read = await getLesson(lesson.id, member).expect(200);

        expect(read.body).toEqual(lesson);
      }
    });

    it("copies a plan without objective as an empty objective, and does not follow the plan afterwards (RN-18)", async () => {
      const generated = await generateSeries();
      expect(generated.lessons[3].objective).toBeNull();

      await lessonPlansService.update(
        planIds[0],
        { title: "Título novo do plano", objective: "Objetivo novo do plano" },
        director.id,
      );

      const read = await getLesson(generated.lessons[0].id, member).expect(200);
      // The lesson keeps what it copied; the reference shows the plan as it is now.
      expect(read.body.title).toBe("Conhecendo o computador");
      expect(read.body.objective).toBe(PLAN_OBJECTIVES["Conhecendo o computador"]);
      expect(read.body.lessonPlan.title).toBe("Título novo do plano");
    });

    it("applies a missing location as null to every lesson", async () => {
      const res = await postGenerate(classId, director, generationBody({ location: null })).expect(
        201,
      );

      expect((res.body as GeneratedBody).lessons.map((lesson) => lesson.location)).toEqual(
        Array(4).fill(null),
      );
    });

    it("firstDate on a Monday with weekday tuesday generates from the Tuesday", async () => {
      const res = await postGenerate(
        classId,
        director,
        generationBody({ firstDate: "2026-04-06" }),
      ).expect(201);

      expect((res.body as GeneratedBody).lessons.map((lesson) => lesson.date)).toEqual([
        ...SERIES_DATES,
      ]);
    });

    it("accepts the id of the class in upper case and works with the id of the database", async () => {
      const res = await postGenerate(classId.toUpperCase(), director, generationBody()).expect(201);

      const body = res.body as GeneratedBody;
      expect(body.classId).toBe(classId);
      expect(body.lessons.every((lesson) => lesson.class.id === classId)).toBe(true);
      expect(await countLessons()).toBe(4);
    });

    it("generate emits 4 LESSON_CREATED with targetType lesson", async () => {
      const events = collectEvents();

      const generated = await generateSeries();

      expect(events).toHaveLength(4);
      expect(events.map((event) => event.action)).toEqual(
        Array(4).fill(AuditableAction.LESSON_CREATED),
      );
      expect(events.map((event) => event.targetType)).toEqual(Array(4).fill("lesson"));
      expect(events.map((event) => event.targetId)).toEqual(
        generated.lessons.map((lesson) => lesson.id),
      );
      expect(events.every((event) => event.actorId === director.id)).toBe(true);
      expect(events.every((event) => event.before === null)).toBe(true);
      expect(events[1].after).toEqual({
        classId,
        lessonPlanId: planIds[1],
        sequenceOrder: 2,
        title: "Teclado, mouse e janelas",
        objective: PLAN_OBJECTIVES["Teclado, mouse e janelas"],
        date: "2026-04-14",
        startTime: "09:00",
        endTime: "11:00",
        location: LOCATION,
        expectedStudents: null,
        expectedMonitors: null,
        subject: null,
        status: "planned",
      });
    });

    it("generate answers 409 LESSONS_OUTSIDE_CLASS_PERIOD and writes nothing", async () => {
      const shortClassId = await createClassOf(courseId, "INFO-B", SHORT_CLASS_PERIOD);
      const events = collectEvents();

      const res = await postGenerate(shortClassId, coordinator, generationBody()).expect(409);

      expect(res.body.error).toBe("LESSONS_OUTSIDE_CLASS_PERIOD");
      // Anchored on the field that moves the whole series, naming the position that falls outside.
      expect(fieldsOf(res.body)).toEqual(["firstDate"]);
      expect(res.body.details[0].message).toContain("4");
      // Not one lesson of the three that fit: all or nothing.
      expect(await countLessons()).toBe(0);
      expect(events).toHaveLength(0);
    });

    it("generate rolls the whole batch back when the creation fails midway", async () => {
      const events = collectEvents();
      // The 500 is the point of the test: the filter logs it, and the log is not noise to the run.
      const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const original = lessonCreation.createMany.bind(lessonCreation);
      let insideTheTransaction = -1;
      jest.spyOn(lessonCreation, "createMany").mockImplementation(async (manager, ...rest) => {
        await original(manager, ...rest);
        // The four rows are in the table for this transaction, and then the work fails.
        const rows: Array<{ total: number }> = await manager.query(
          `SELECT count(*)::int AS total FROM lessons`,
        );
        insideTheTransaction = rows[0].total;
        throw new Error("The creation failed after the insert.");
      });

      const res = await postGenerate(classId, coordinator, generationBody());

      expect(insideTheTransaction).toBe(4);
      expect(res.status).toBe(500);
      expect(logged).toHaveBeenCalled();
      // They are gone with the rollback, and no event announced any of them.
      expect(await countLessons()).toBe(0);
      expect(events).toHaveLength(0);

      // Nothing was left behind that blocks the next try.
      jest.restoreAllMocks();
      await postGenerate(classId, coordinator, generationBody()).expect(201);
      expect(await countLessons()).toBe(4);
    });

    it("second generate answers 409 LESSONS_ALREADY_GENERATED and keeps 4 lessons", async () => {
      const first = await generateSeries();
      const events = collectEvents();

      for (const [, send] of routes) {
        const res = await send(classId, director, generationBody()).expect(409);

        expect(res.body.error).toBe("LESSONS_ALREADY_GENERATED");
      }

      expect(await countLessons()).toBe(4);
      expect(events).toHaveLength(0);
      // The lessons are the first ones, untouched.
      expect(await storedLesson(first.lessons[0].id)).toMatchObject({ sequence_order: 1 });
    });

    it("generates the lessons of each class once: another class of the same course is not blocked", async () => {
      await generateSeries();
      const otherClassId = await createClassOf(courseId, "INFO-B");

      const res = await postGenerate(otherClassId, director, generationBody()).expect(201);

      expect((res.body as GeneratedBody).classId).toBe(otherClassId);
      expect(await countLessons()).toBe(8);
    });

    it("two generates at the same time: one 201, one 409, 4 lessons", async () => {
      const events = collectEvents();

      const [first, second] = await Promise.all([
        postGenerate(classId, director, generationBody()),
        postGenerate(classId, coordinator, generationBody()),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const refused = first.status === 409 ? first : second;
      expect(refused.body.error).toBe("LESSONS_ALREADY_GENERATED");
      expect(await countLessons()).toBe(4);
      expect(events).toHaveLength(4);
    });

    it("five generates at the same time: one 201, four 409, 4 lessons, and none of them dead-locks", async () => {
      const events = collectEvents();

      const responses = await Promise.all(
        [director, coordinator, superadmin, director, coordinator].map((actor) =>
          postGenerate(classId, actor, generationBody()),
        ),
      );

      // A deadlock between them would answer 500: the order of the locks is what prevents it.
      expect(responses.map((res) => res.status).sort()).toEqual([201, 409, 409, 409, 409]);
      for (const refused of responses.filter((res) => res.status === 409)) {
        expect(refused.body.error).toBe("LESSONS_ALREADY_GENERATED");
      }
      expect(await countLessons()).toBe(4);
      expect(events).toHaveLength(4);
    });

    it("waits on pg_advisory_xact_lock while another generate holds the class, and then answers 409 without duplicating", async () => {
      // Another generation of the same class is in flight: it holds the advisory lock of the class.
      const other = await holdGenerationLock(classId);

      const pending = postGenerate(classId, coordinator, generationBody()).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/pg_advisory_xact_lock/);
        expect(await countLessons()).toBe(0);
        // The other generation commits the lessons of the sequence before it lets go.
        await other.run(
          `INSERT INTO lessons (id, class_id, lesson_plan_id, sequence_order, title, date,
                                start_time, end_time, created_by_id)
           VALUES (gen_random_uuid(), $1, $2, 1, $3, '2026-04-07', '09:00', '11:00', $4)`,
          [classId, planIds[0], GENERATION_PLAN_TITLES[0], director.id],
        );
      } finally {
        await other.release();
      }

      // The check is made again under the lock, so the one that waited sees what the other wrote.
      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("LESSONS_ALREADY_GENERATED");
      expect(await countLessons()).toBe(1);
    });

    it("goes on when the generation that held the class ends without writing", async () => {
      const other = await holdGenerationLock(classId);

      const pending = postGenerate(classId, coordinator, generationBody()).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/pg_advisory_xact_lock/);
      } finally {
        await other.release();
      }

      const res = await pending;
      expect(res.status).toBe(201);
      expect(await countLessons()).toBe(4);
    });

    it("does not wait for the generation of another class: the lock is one per class", async () => {
      const otherClassId = await createClassOf(courseId, "INFO-B");
      const holding = await holdGenerationLock(otherClassId);

      let giveUp: NodeJS.Timeout | undefined;
      try {
        const outcome = await Promise.race([
          postGenerate(classId, director, generationBody()).then((res) => res.status),
          new Promise<string>((resolve) => {
            giveUp = setTimeout(() => resolve("blocked"), 3000);
          }),
        ]);

        expect(outcome).toBe(201);
      } finally {
        clearTimeout(giveUp);
        await holding.release();
      }
    });

    it("a cancelled sequenced lesson still counts as generated", async () => {
      // A lesson of the sequence, made by hand and then cancelled: it is still in the class.
      const lesson = await postLesson(director, {
        classId,
        lessonPlanId: planIds[0],
        sequenceOrder: 1,
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
      }).expect(201);
      await cancelLesson(lesson.body.id, director).expect(200);

      for (const [, send] of routes) {
        const res = await send(classId, director, generationBody()).expect(409);

        expect(res.body.error).toBe("LESSONS_ALREADY_GENERATED");
      }
      expect(await countLessons()).toBe(1);
    });

    it("an extra lesson (no sequenceOrder) does not block", async () => {
      // On its own, and from a plan of the course without the position: both are extra lessons.
      await postLesson(director, {
        classId,
        title: "Aula de revisão",
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
      }).expect(201);
      await postLesson(director, {
        classId,
        lessonPlanId: planIds[0],
        date: "2026-03-17",
        startTime: "14:00",
        endTime: "15:30",
      }).expect(201);

      await postPreview(classId, director, generationBody()).expect(200);
      const res = await postGenerate(classId, director, generationBody()).expect(201);

      expect((res.body as GeneratedBody).lessons).toHaveLength(4);
      expect(await countLessons()).toBe(6);
    });

    it("an archived plan in the sequence is skipped: no lesson for it, and the others keep their position", async () => {
      await lessonPlansService.archive(planIds[1], undefined, director.id);
      const events = collectEvents();

      const res = await postGenerate(classId, coordinator, generationBody()).expect(201);

      const body = res.body as GeneratedBody;
      expect(
        body.lessons.map((lesson) => [lesson.sequenceOrder, lesson.title, lesson.date]),
      ).toEqual([
        [1, "Conhecendo o computador", "2026-04-07"],
        [3, "Navegando na internet", "2026-04-14"],
        [4, "Senhas e privacidade", "2026-04-21"],
      ]);
      expect(await countLessons()).toBe(3);
      expect(events).toHaveLength(3);
      const rows: Array<{ lesson_plan_id: string }> = await dataSource.query(
        `SELECT lesson_plan_id FROM lessons WHERE lesson_plan_id = $1`,
        [planIds[1]],
      );
      expect(rows).toHaveLength(0);
    });

    it("an archived course does not block: its classes keep being edited", async () => {
      await dataSource.query(
        `UPDATE courses SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
        [courseId, director.id],
      );

      const res = await postGenerate(classId, director, generationBody()).expect(201);

      expect((res.body as GeneratedBody).lessons).toHaveLength(4);
    });

    it("a class that is already completed still gets its lessons: only the archive blocks", async () => {
      await dataSource.query(`UPDATE classes SET status = 'completed' WHERE id = $1`, [classId]);

      const res = await postGenerate(classId, director, generationBody()).expect(201);

      expect((res.body as GeneratedBody).lessons).toHaveLength(4);
    });
  });

  describe("errors of both routes", () => {
    it.each(routes)(
      "%s answers 409 COURSE_WITHOUT_SEQUENCE for a course without plans",
      async (_name, send) => {
        await courseLessonPlansService.replace(courseId, { lessonPlanIds: [] }, director.id);

        const res = await send(classId, director, generationBody()).expect(409);

        expect(res.body.error).toBe("COURSE_WITHOUT_SEQUENCE");
        expect(await countLessons()).toBe(0);
      },
    );

    it.each(routes)(
      "%s answers 409 COURSE_WITHOUT_SEQUENCE when every plan of the sequence is archived",
      async (_name, send) => {
        for (const planId of planIds) {
          await lessonPlansService.archive(planId, undefined, director.id);
        }

        const res = await send(classId, director, generationBody()).expect(409);

        expect(res.body.error).toBe("COURSE_WITHOUT_SEQUENCE");
        expect(await countLessons()).toBe(0);
      },
    );

    it.each(routes)("%s answers 409 CLASS_ARCHIVED for an archived class", async (_name, send) => {
      await classesService.archive(classId, undefined, director.id);
      const events = collectEvents();

      const res = await send(classId, director, generationBody()).expect(409);

      expect(res.body.error).toBe("CLASS_ARCHIVED");
      expect(await countLessons()).toBe(0);
      expect(events).toHaveLength(0);
    });

    it.each(routes)(
      "%s answers 404 CLASS_NOT_FOUND for an unknown or malformed class id",
      async (_name, send) => {
        for (const id of [UNKNOWN_ID, "not-a-uuid", "123"]) {
          const res = await send(id, director, generationBody()).expect(404);

          expect(res.body).toMatchObject({ error: "CLASS_NOT_FOUND", message: "Class not found." });
        }
        expect(await countLessons()).toBe(0);
      },
    );

    it.each(routes)(
      "%s answers 400 INVALID_TIME_RANGE when endTime is not after startTime",
      async (_name, send) => {
        for (const [startTime, endTime] of [
          ["11:00", "09:00"],
          ["09:00", "09:00"],
        ]) {
          const res = await send(classId, director, generationBody({ startTime, endTime })).expect(
            400,
          );

          expect(res.body.error).toBe("INVALID_TIME_RANGE");
          expect(fieldsOf(res.body)).toEqual(["endTime"]);
        }
        expect(await countLessons()).toBe(0);
      },
    );

    it.each(routes)("%s answers 400 VALIDATION_FAILED for weekday 'terça'", async (_name, send) => {
      for (const weekday of ["terça", "Tuesday", "TUESDAY", 2, null, undefined]) {
        const res = await send(classId, director, generationBody({ weekday })).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual(["weekday"]);
      }
      expect(await countLessons()).toBe(0);
    });

    it.each(routes)(
      "%s answers 400 VALIDATION_FAILED with every field that is wrong at once",
      async (_name, send) => {
        const res = await send(classId, director, {
          weekday: "someday",
          startTime: "9:00",
          endTime: "24:00",
          firstDate: "2026-02-30",
          location: "l".repeat(201),
        }).expect(400);

        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body)).toEqual([
          "endTime",
          "firstDate",
          "location",
          "startTime",
          "weekday",
        ]);

        const empty = await send(classId, director, {}).expect(400);
        expect(fieldsOf(empty.body)).toEqual(["endTime", "firstDate", "startTime", "weekday"]);
      },
    );

    it.each(routes)(
      "%s answers 400 VALIDATION_FAILED for a firstDate that is not a date",
      async (_name, send) => {
        for (const firstDate of ["2026-02-30", "07/04/2026", "2026-4-7", "", null]) {
          const res = await send(classId, director, generationBody({ firstDate })).expect(400);

          expect(fieldsOf(res.body)).toEqual(["firstDate"]);
        }
      },
    );

    it.each(routes)(
      "%s answers the validation before it looks at the class",
      async (_name, send) => {
        // The class does not exist and the body is wrong: the body is what is answered first.
        const res = await send(UNKNOWN_ID, director, generationBody({ weekday: "terça" })).expect(
          400,
        );

        expect(res.body.error).toBe("VALIDATION_FAILED");
      },
    );

    it.each(routes)("%s answers INVALID_TIME_RANGE before CLASS_NOT_FOUND", async (_name, send) => {
      const res = await send(
        UNKNOWN_ID,
        director,
        generationBody({ startTime: "11:00", endTime: "09:00" }),
      ).expect(400);

      expect(res.body.error).toBe("INVALID_TIME_RANGE");
    });

    it.each(routes)(
      "%s answers CLASS_ARCHIVED before LESSONS_ALREADY_GENERATED and before COURSE_WITHOUT_SEQUENCE",
      async (_name, send) => {
        await generateSeries();
        await courseLessonPlansService.replace(courseId, { lessonPlanIds: [] }, director.id);
        await classesService.archive(classId, undefined, director.id);

        const archived = await send(classId, director, generationBody()).expect(409);
        expect(archived.body.error).toBe("CLASS_ARCHIVED");

        await classesService.unarchive(classId, director.id);
        const generated = await send(classId, director, generationBody()).expect(409);
        expect(generated.body.error).toBe("LESSONS_ALREADY_GENERATED");
      },
    );

    it("answers LESSONS_ALREADY_GENERATED before LESSONS_OUTSIDE_CLASS_PERIOD", async () => {
      await generateSeries();
      // The series of a class that has already got its lessons would also fall outside: the first
      // error is the one answered.
      await dataSource.query(`UPDATE classes SET end_date = '2026-04-24' WHERE id = $1`, [classId]);

      const res = await postGenerate(classId, director, generationBody()).expect(409);

      expect(res.body.error).toBe("LESSONS_ALREADY_GENERATED");
    });

    it("answers COURSE_WITHOUT_SEQUENCE before LESSONS_OUTSIDE_CLASS_PERIOD", async () => {
      await courseLessonPlansService.replace(courseId, { lessonPlanIds: [] }, director.id);

      const res = await postGenerate(
        classId,
        director,
        generationBody({ firstDate: "2027-01-05" }),
      ).expect(409);

      expect(res.body.error).toBe("COURSE_WITHOUT_SEQUENCE");
    });
  });

  describe("a write that is in flight", () => {
    it("waits for an archive of the class that is in flight, and then answers 409 CLASS_ARCHIVED", async () => {
      // An archive (or an edit of the period) holds the class FOR UPDATE until it commits.
      const archive = await holdRow("classes", classId, "FOR UPDATE");

      const pending = postGenerate(classId, director, generationBody()).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FROM "classes"/);
        // Nothing is written while the class can still change under the generation.
        expect(await countLessons()).toBe(0);
        await archive.run(
          `UPDATE classes SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
          [classId, director.id],
        );
      } finally {
        await archive.release();
      }

      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("CLASS_ARCHIVED");
      expect(await countLessons()).toBe(0);
    });

    it("waits for an edit of the period of the class that is in flight, and checks the days against the new period", async () => {
      const edit = await holdRow("classes", classId, "FOR UPDATE");

      const pending = postGenerate(classId, director, generationBody()).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FROM "classes"/);
        // The four lessons fit the period now, and the fourth would not fit the one being committed.
        await edit.run(`UPDATE classes SET end_date = '2026-04-24' WHERE id = $1`, [classId]);
      } finally {
        await edit.release();
      }

      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("LESSONS_OUTSIDE_CLASS_PERIOD");
      expect(await countLessons()).toBe(0);
    });

    it("does not wait for another lesson being created in the same class: shared locks do not conflict", async () => {
      // A creation of a lesson holds the class FOR SHARE for its whole transaction.
      const holder = await holdRow("classes", classId, "FOR SHARE");

      try {
        // If the generation asked for FOR UPDATE it would wait for the holder, and never answer.
        const res = await postGenerate(classId, director, generationBody()).expect(201);
        expect((res.body as GeneratedBody).lessons).toHaveLength(4);
      } finally {
        await holder.release();
      }
    });

    it("waits for a replacement of the sequence that is in flight, and generates from the sequence it commits", async () => {
      // PUT /courses/:id/lesson-plans holds the course FOR UPDATE while it rewrites the sequence.
      const replacement = await holdRow("courses", courseId, "FOR UPDATE");

      const pending = postGenerate(classId, director, generationBody()).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/FROM "courses"/);
        expect(await countLessons()).toBe(0);
        // The new sequence has three plans: the last one goes.
        await replacement.run(
          `DELETE FROM course_lesson_plans WHERE course_id = $1 AND position = 4`,
          [courseId],
        );
      } finally {
        await replacement.release();
      }

      // The series is the one of the sequence that was committed, never a mix of the two.
      const res = await pending;
      expect(res.status).toBe(201);
      expect((res.body as GeneratedBody).lessons.map((lesson) => lesson.sequenceOrder)).toEqual([
        1, 2, 3,
      ]);
      expect(await countLessons()).toBe(3);
    });

    it("waits for an edit of a lesson plan that is in flight, and copies the version it commits", async () => {
      // PATCH /lesson-plans/:id holds the plan FOR UPDATE while it rewrites it.
      const edit = await holdRow("lesson_plans", planIds[1], "FOR UPDATE");

      const pending = postGenerate(classId, director, generationBody()).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/lesson_plans/);
        await edit.run(`UPDATE lesson_plans SET title = $2, objective = $3 WHERE id = $1`, [
          planIds[1],
          "Título do plano depois da edição",
          "Objetivo do plano depois da edição",
        ]);
      } finally {
        await edit.release();
      }

      const res = await pending;
      expect(res.status).toBe(201);
      const lesson = (res.body as GeneratedBody).lessons[1];
      // The lesson copies the whole version of the plan that was committed, never a mix.
      expect(lesson.title).toBe("Título do plano depois da edição");
      expect(lesson.objective).toBe("Objetivo do plano depois da edição");
      expect(lesson.lessonPlan?.title).toBe("Título do plano depois da edição");
    });

    it("waits for an archive of a lesson plan that is in flight, and leaves that plan out", async () => {
      const archive = await holdRow("lesson_plans", planIds[2], "FOR UPDATE");

      const pending = postGenerate(classId, director, generationBody()).then((res) => res);

      try {
        expect(await blockedStatement()).toMatch(/lesson_plans/);
        await archive.run(
          `UPDATE lesson_plans SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
          [planIds[2], director.id],
        );
      } finally {
        await archive.release();
      }

      const res = await pending;
      expect(res.status).toBe(201);
      expect((res.body as GeneratedBody).lessons.map((lesson) => lesson.sequenceOrder)).toEqual([
        1, 2, 4,
      ]);
      expect(await countLessons()).toBe(3);
    });
  });

  describe("permissions", () => {
    it("requires a session: 401 without the cookie on both routes", async () => {
      for (const path of ["preview", "generate"]) {
        await request(app.getHttpServer())
          .post(`/classes/${classId}/lessons/${path}`)
          .send(generationBody())
          .expect(401);
      }
      expect(await countLessons()).toBe(0);
    });

    it.each(routes)("member gets 403 FORBIDDEN on %s", async (_name, send) => {
      const events = collectEvents();

      const res = await send(classId, member, generationBody()).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect(await countLessons()).toBe(0);
      expect(events).toHaveLength(0);
    });

    it("answers 403 to a member before it looks at the class or the body", async () => {
      const res = await postGenerate(UNKNOWN_ID, member, {}).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
    });

    it.each([
      ["director", () => director],
      ["coordinator", () => coordinator],
      ["superadmin", () => superadmin],
    ])("%s previews and generates", async (_name, actorOf) => {
      const actor = actorOf();

      await postPreview(classId, actor, generationBody()).expect(200);
      const res = await postGenerate(classId, actor, generationBody()).expect(201);

      expect(
        (res.body as GeneratedBody).lessons.every((lesson) => lesson.createdById === actor.id),
      ).toBe(true);
      expect(await countLessons()).toBe(4);
    });
  });

  describe("routes", () => {
    it("has no route to undo or regenerate: only POST preview and POST generate", async () => {
      await generateSeries();

      for (const [method, path] of [
        ["get", `/classes/${classId}/lessons`],
        ["delete", `/classes/${classId}/lessons`],
        ["get", `/classes/${classId}/lessons/preview`],
        ["delete", `/classes/${classId}/lessons/generate`],
        ["post", `/classes/${classId}/lessons/regenerate`],
      ] as const) {
        const res = await request(app.getHttpServer())
          [method](path)
          .set("Cookie", coordinator.cookie);

        expect(res.status).toBe(404);
      }
      expect(await countLessons()).toBe(4);
    });
  });
});
