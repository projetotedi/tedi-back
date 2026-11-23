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
import { AuthModule } from "@modules/auth/auth.module";
import {
  insertDepartment,
  insertMemberProfile,
} from "@modules/people/__tests__/fixtures/member-registration.fixture";
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
import { HoursModule } from "../hours.module";
import {
  countEntries,
  entryRow,
  eventsOf,
  hourEntryBody,
  reviewEntry,
  tomorrowInAppTimeZone,
} from "./fixtures/hour-entries.fixture";

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

process.env.JWT_SECRET = "e2e-my-hours-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";

interface Actor {
  id: string;
  cookie: string;
}

interface StatusTotal {
  status: string;
  entries: number;
  declaredMinutes: number;
  validatedMinutes: number;
}

interface CategoryTotal {
  category: string;
  entries: number;
  declaredMinutes: number;
  bankMinutes: number;
  pendingMinutes: number;
}

interface SummaryBody {
  from: string | null;
  to: string | null;
  bankMinutes: number;
  byStatus: StatusTotal[];
  byCategory: CategoryTotal[];
}

interface PageBody {
  data: HourEntryBody[];
  total: number;
  page: number;
  limit: number;
}

const STATUSES = ["pending", "approved", "adjusted", "rejected"];
const CATEGORIES = ["lesson", "planning", "event", "management", "meeting", "support", "other"];

interface FieldError {
  field: string;
  message: string;
}

interface HourEntryBody {
  id: string;
  personId: string;
  activity: string;
  category: string;
  date: string;
  declaredMinutes: number;
  validatedMinutes: number | null;
  notes: string | null;
  status: string;
  origin: string;
  createdById: string;
  classId: string | null;
  lessonId: string | null;
  reviewNote: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field).sort();
}

describe("MyHoursController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;

  let member: Actor;
  let otherMember: Actor;
  let director: Actor;
  let coordinator: Actor;
  let superadmin: Actor;
  let tech: string;

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
        HoursModule,
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE hour_entry_events, hour_entries, invites, departments, people
       RESTART IDENTITY CASCADE`,
    );

    tech = await insertDepartment(dataSource, "Tecnologia");
    member = await createActor("Member", Role.MEMBER, tech);
    otherMember = await createActor("Other Member", Role.MEMBER, tech);
    director = await createActor("Director", Role.DIRECTOR, tech);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    superadmin = await createActor("Superadmin", Role.SUPERADMIN);
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
  });

  /**
   * A Person with a role and a session cookie signed without a login. With a department, she also
   * gets an approved member profile in it; without one, she has no profile (coordination, admin).
   */
  async function createActor(name: string, role: Role, departmentId?: string): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    if (departmentId !== undefined) {
      await insertMemberProfile(dataSource, {
        personId: person.id,
        status: "approved",
        departmentId,
      });
    }
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  function postEntry(actor: Actor, payload: Record<string, unknown> = hourEntryBody()) {
    return request(app.getHttpServer())
      .post("/me/hour-entries")
      .set("Cookie", actor.cookie)
      .send(payload);
  }

  async function logEntry(
    actor: Actor,
    overrides: Record<string, unknown> = {},
  ): Promise<HourEntryBody> {
    const res = await postEntry(actor, hourEntryBody(overrides)).expect(201);
    return res.body as HourEntryBody;
  }

  function listEntries(actor: Actor, query: Record<string, string | number> = {}) {
    return request(app.getHttpServer())
      .get("/me/hour-entries")
      .query(query)
      .set("Cookie", actor.cookie);
  }

  async function statement(
    actor: Actor,
    query: Record<string, string | number> = {},
  ): Promise<PageBody> {
    const res = await listEntries(actor, query).expect(200);
    return res.body as PageBody;
  }

  function getSummary(actor: Actor, query: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .get("/me/hours/summary")
      .query(query)
      .set("Cookie", actor.cookie);
  }

  async function summaryOf(actor: Actor, query: Record<string, string> = {}): Promise<SummaryBody> {
    const res = await getSummary(actor, query).expect(200);
    return res.body as SummaryBody;
  }

  function removeEntry(id: string, actor: Actor) {
    return request(app.getHttpServer())
      .delete(`/me/hour-entries/${id}`)
      .set("Cookie", actor.cookie);
  }

  function categoryTotal(summary: SummaryBody, category: string): CategoryTotal | undefined {
    return summary.byCategory.find((total) => total.category === category);
  }

  function statusTotal(summary: SummaryBody, status: string): StatusTotal | undefined {
    return summary.byStatus.find((total) => total.status === status);
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  describe("POST /me/hour-entries", () => {
    it("logs 2h30 of planning and shows it in the statement as pending (CA1)", async () => {
      const entry = await logEntry(member);

      expect(entry).toMatchObject({
        declaredMinutes: 150,
        validatedMinutes: null,
        status: "pending",
      });
      const page = await statement(member);
      expect(page.total).toBe(1);
      expect(page.data).toEqual([entry]);
      expect(page.data[0]).toMatchObject({
        category: "planning",
        declaredMinutes: 150,
        validatedMinutes: null,
        status: "pending",
        origin: "manual",
        createdById: member.id,
      });
    });

    it("logs 2h30 of planning, pending and manual, authored by the member", async () => {
      const res = await postEntry(member).expect(201);

      expect(res.body).toMatchObject({
        personId: member.id,
        createdById: member.id,
        activity: "Planejamento da aula de teclado e mouse",
        category: "planning",
        date: "2026-03-10",
        declaredMinutes: 150,
        validatedMinutes: null,
        notes: null,
        status: "pending",
        origin: "manual",
        classId: null,
        lessonId: null,
        reviewNote: null,
        reviewedById: null,
        reviewedAt: null,
      });
      expect(res.body).not.toHaveProperty("deletedAt");
      expect((await entryRow(dataSource, (res.body as HourEntryBody).id))?.status).toBe("pending");
    });

    it("records a created event with the member as actor, from nothing to pending and 150 minutes, at the instant of the entry", async () => {
      const entry = await logEntry(member);

      const events = await eventsOf(dataSource, entry.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "created",
        actor_id: member.id,
        from_status: null,
        to_status: "pending",
        from_minutes: null,
        to_minutes: 150,
        note: null,
      });
      const row = await entryRow(dataSource, entry.id);
      expect(events[0].created_at).toEqual(row?.created_at);
      expect(row?.updated_at).toEqual(row?.created_at);
    });

    it("emits HOUR_ENTRY_CREATED after the commit, without the activity or the notes", async () => {
      const events = collectEvents();

      const entry = await logEntry(member, { notes: "Revisei os exercícios do plano 3." });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: AuditableAction.HOUR_ENTRY_CREATED,
        actorId: member.id,
        targetType: "hour_entry",
        targetId: entry.id,
        before: null,
        after: {
          personId: member.id,
          category: "planning",
          date: "2026-03-10",
          declaredMinutes: 150,
          status: "pending",
          origin: "manual",
          classId: null,
          lessonId: null,
        },
      });
      const serialized = JSON.stringify(events[0]);
      expect(serialized).not.toContain("Planejamento da aula");
      expect(serialized).not.toContain("Revisei os exercícios");
    });

    it.each([
      { case: "0 minutes", overrides: { declaredMinutes: 0 }, field: "declaredMinutes" },
      { case: "1441 minutes", overrides: { declaredMinutes: 1441 }, field: "declaredMinutes" },
      { case: 'the string "150"', overrides: { declaredMinutes: "150" }, field: "declaredMinutes" },
      { case: "1.5 minutes", overrides: { declaredMinutes: 1.5 }, field: "declaredMinutes" },
      { case: "a blank activity", overrides: { activity: "   " }, field: "activity" },
      { case: "the category lesson", overrides: { category: "lesson" }, field: "category" },
      { case: "the date 2026-02-30", overrides: { date: "2026-02-30" }, field: "date" },
      { case: "the date 0000-06-15", overrides: { date: "0000-06-15" }, field: "date" },
      { case: "the date 1999-12-31", overrides: { date: "1999-12-31" }, field: "date" },
      {
        case: "no declaredMinutes",
        overrides: { declaredMinutes: undefined },
        field: "declaredMinutes",
      },
    ])("answers 400 VALIDATION_FAILED for $case", async ({ overrides, field }) => {
      const res = await postEntry(member, hourEntryBody(overrides)).expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(res.body as { details?: FieldError[] })).toEqual([field]);
      expect(await countEntries(dataSource)).toBe(0);
    });

    it("answers 400 HOUR_ENTRY_DATE_IN_FUTURE for tomorrow in America/Sao_Paulo, with details on date, and accepts today", async () => {
      const res = await postEntry(member, hourEntryBody({ date: tomorrowInAppTimeZone() })).expect(
        400,
      );

      expect(res.body).toMatchObject({
        statusCode: 400,
        error: "HOUR_ENTRY_DATE_IN_FUTURE",
        message: "Hours cannot be logged for a future date.",
        details: [{ field: "date", message: "date must not be after today" }],
      });
      expect(await countEntries(dataSource)).toBe(0);

      const today = todayInAppTimeZone();
      const accepted = await logEntry(member, { date: today });
      expect(accepted.date).toBe(today);
    });

    it("ignores personId, status, origin, validatedMinutes, classId and lessonId sent in the body: the entry is the logged-in person's, pending and manual", async () => {
      const entry = await logEntry(member, {
        personId: otherMember.id,
        createdById: otherMember.id,
        status: "approved",
        origin: "attendance",
        validatedMinutes: 150,
        classId: CLASS_ID,
        lessonId: LESSON_ID,
        reviewedById: director.id,
      });

      expect(entry).toMatchObject({
        personId: member.id,
        createdById: member.id,
        status: "pending",
        origin: "manual",
        validatedMinutes: null,
        classId: null,
        lessonId: null,
        reviewedById: null,
      });
    });

    it("lets a director, a coordinator without member profile and the superadmin log their own hours", async () => {
      for (const actor of [director, coordinator, superadmin]) {
        const entry = await logEntry(actor);

        expect(entry).toMatchObject({
          personId: actor.id,
          createdById: actor.id,
          origin: "manual",
          status: "pending",
        });
      }
    });

    it("answers 401 without a session cookie", async () => {
      await request(app.getHttpServer()).post("/me/hour-entries").send(hourEntryBody()).expect(401);

      expect(await countEntries(dataSource)).toBe(0);
    });
  });

  describe("GET /me/hour-entries", () => {
    it("lists only the logged-in person's entries, newest day first, with declared, validated, status and the review note (CA1)", async () => {
      const planning = await logEntry(member, { date: "2026-03-10" });
      const meeting = await logEntry(member, {
        category: "meeting",
        date: "2026-03-12",
        declaredMinutes: 60,
      });
      const event = await logEntry(member, {
        category: "event",
        date: "2026-03-11",
        declaredMinutes: 90,
      });
      await logEntry(otherMember, { date: "2026-03-13" });
      await reviewEntry(dataSource, meeting.id, {
        status: "rejected",
        validatedMinutes: 0,
        reviewNote: "Reunião fora do projeto.",
        reviewedById: coordinator.id,
      });
      await reviewEntry(dataSource, event.id, {
        status: "adjusted",
        validatedMinutes: 60,
        reviewNote: "O evento durou uma hora.",
        reviewedById: coordinator.id,
      });

      const page = await statement(member);

      expect(page).toMatchObject({ total: 3, page: 1, limit: 20 });
      expect(page.data.map((entry) => entry.id)).toEqual([meeting.id, event.id, planning.id]);
      expect(page.data.every((entry) => entry.personId === member.id)).toBe(true);
      expect(page.data[0]).toMatchObject({
        declaredMinutes: 60,
        validatedMinutes: 0,
        status: "rejected",
        reviewNote: "Reunião fora do projeto.",
        reviewedById: coordinator.id,
      });
      expect(page.data[1]).toMatchObject({
        declaredMinutes: 90,
        validatedMinutes: 60,
        status: "adjusted",
        reviewNote: "O evento durou uma hora.",
      });
      expect(page.data[1].reviewedAt).not.toBeNull();
      expect(page.data[2]).toMatchObject({
        declaredMinutes: 150,
        validatedMinutes: null,
        status: "pending",
        reviewNote: null,
        reviewedAt: null,
      });
    });

    it("puts the newest entry first among the entries of the same day", async () => {
      const first = await logEntry(member, { activity: "Primeira" });
      const second = await logEntry(member, { activity: "Segunda" });

      const page = await statement(member);

      expect(page.data.map((entry) => entry.id)).toEqual([second.id, first.id]);
    });

    it("filters by status, by category and by period, both ends included", async () => {
      const march1 = await logEntry(member, { date: "2026-03-01" });
      const march15 = await logEntry(member, { category: "meeting", date: "2026-03-15" });
      const march31 = await logEntry(member, { date: "2026-03-31" });
      const april1 = await logEntry(member, { date: "2026-04-01" });
      await reviewEntry(dataSource, march15.id, {
        status: "approved",
        validatedMinutes: 150,
        reviewNote: null,
        reviewedById: coordinator.id,
      });
      const ids = (page: PageBody) => page.data.map((entry) => entry.id);

      expect(ids(await statement(member, { status: "approved" }))).toEqual([march15.id]);
      expect(ids(await statement(member, { status: "pending" }))).toEqual([
        april1.id,
        march31.id,
        march1.id,
      ]);
      expect(ids(await statement(member, { category: "meeting" }))).toEqual([march15.id]);
      expect(ids(await statement(member, { category: "lesson" }))).toEqual([]);
      expect(ids(await statement(member, { from: "2026-03-01", to: "2026-03-31" }))).toEqual([
        march31.id,
        march15.id,
        march1.id,
      ]);
      expect(ids(await statement(member, { from: "2026-03-31" }))).toEqual([april1.id, march31.id]);
      expect(ids(await statement(member, { to: "2026-03-01" }))).toEqual([march1.id]);
      expect(
        ids(await statement(member, { status: "pending", category: "planning", to: "2026-03-31" })),
      ).toEqual([march31.id, march1.id]);
    });

    it("paginates with page and limit and reports the total", async () => {
      for (const day of ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]) {
        await logEntry(member, { date: day });
      }

      const second = await statement(member, { page: 2, limit: 2 });
      expect(second).toMatchObject({ total: 5, page: 2, limit: 2 });
      expect(second.data.map((entry) => entry.date)).toEqual(["2026-03-03", "2026-03-02"]);

      const last = await statement(member, { page: 3, limit: 2 });
      expect(last.data.map((entry) => entry.date)).toEqual(["2026-03-01"]);

      const beyond = await statement(member, { page: 4, limit: 2 });
      expect(beyond).toMatchObject({ data: [], total: 5 });
    });

    it("leaves removed entries out of the statement", async () => {
      const kept = await logEntry(member, { date: "2026-03-10" });
      const removed = await logEntry(member, { date: "2026-03-11" });
      await removeEntry(removed.id, member).expect(204);

      const page = await statement(member);

      expect(page.total).toBe(1);
      expect(page.data.map((entry) => entry.id)).toEqual([kept.id]);
    });

    it("answers 400 INVALID_PERIOD when from is after to", async () => {
      const res = await listEntries(member, { from: "2026-03-31", to: "2026-03-01" }).expect(400);

      expect(res.body).toMatchObject({
        error: "INVALID_PERIOD",
        details: [{ field: "to", message: "to must be on or after from" }],
      });
    });

    it("answers 400 VALIDATION_FAILED for a status, a category, a date or a limit it does not take", async () => {
      const queries: Array<Record<string, string | number>> = [
        { status: "open" },
        { category: "class" },
        { from: "2026-02-30" },
        { limit: 101 },
      ];
      for (const query of queries) {
        const res = await listEntries(member, query).expect(400);
        expect(res.body.error).toBe("VALIDATION_FAILED");
      }
    });

    it("answers 401 without a session cookie", async () => {
      await request(app.getHttpServer()).get("/me/hour-entries").expect(401);
    });
  });

  describe("GET /me/hours/summary", () => {
    it("totals the logged-in person's entries by status and by category, with every status and category present even at zero", async () => {
      await logEntry(member, { declaredMinutes: 150 });
      await logEntry(member, { declaredMinutes: 30 });
      await logEntry(member, { category: "support", declaredMinutes: 45 });

      const summary = await summaryOf(member);

      expect(summary.byStatus.map((total) => total.status)).toEqual(STATUSES);
      expect(summary.byCategory.map((total) => total.category)).toEqual(CATEGORIES);
      expect(statusTotal(summary, "pending")).toEqual({
        status: "pending",
        entries: 3,
        declaredMinutes: 225,
        validatedMinutes: 0,
      });
      expect(statusTotal(summary, "approved")).toEqual({
        status: "approved",
        entries: 0,
        declaredMinutes: 0,
        validatedMinutes: 0,
      });
      expect(categoryTotal(summary, "planning")).toEqual({
        category: "planning",
        entries: 2,
        declaredMinutes: 180,
        bankMinutes: 0,
        pendingMinutes: 180,
        note: null,
      });
      expect(categoryTotal(summary, "lesson")).toEqual({
        category: "lesson",
        entries: 0,
        declaredMinutes: 0,
        bankMinutes: 0,
        pendingMinutes: 0,
        note: null,
      });
      expect(summary).toMatchObject({ from: null, to: null, bankMinutes: 0 });
    });

    it("counts in the bank only the validated minutes of approved and adjusted entries, and the declared minutes of pending ones as pending", async () => {
      const approved = await logEntry(member, { declaredMinutes: 60 });
      const adjusted = await logEntry(member, { declaredMinutes: 150 });
      const rejected = await logEntry(member, { declaredMinutes: 300 });
      await logEntry(member, { declaredMinutes: 90 });
      await reviewEntry(dataSource, approved.id, {
        status: "approved",
        validatedMinutes: 60,
        reviewNote: null,
        reviewedById: coordinator.id,
      });
      await reviewEntry(dataSource, adjusted.id, {
        status: "adjusted",
        validatedMinutes: 120,
        reviewNote: "Duas horas.",
        reviewedById: coordinator.id,
      });
      await reviewEntry(dataSource, rejected.id, {
        status: "rejected",
        validatedMinutes: 0,
        reviewNote: "Fora do projeto.",
        reviewedById: coordinator.id,
      });

      const summary = await summaryOf(member);

      expect(summary.bankMinutes).toBe(180);
      expect(categoryTotal(summary, "planning")).toEqual({
        category: "planning",
        entries: 4,
        declaredMinutes: 600,
        bankMinutes: 180,
        pendingMinutes: 90,
        note: null,
      });
      expect(statusTotal(summary, "adjusted")).toMatchObject({ entries: 1, validatedMinutes: 120 });
      expect(statusTotal(summary, "rejected")).toMatchObject({ entries: 1, declaredMinutes: 300 });
    });

    it("returns numbers, not strings, for every total", async () => {
      const approved = await logEntry(member);
      await reviewEntry(dataSource, approved.id, {
        status: "approved",
        validatedMinutes: 150,
        reviewNote: null,
        reviewedById: coordinator.id,
      });

      const summary = await summaryOf(member);

      expect(typeof summary.bankMinutes).toBe("number");
      for (const total of summary.byStatus) {
        expect(typeof total.entries).toBe("number");
        expect(typeof total.declaredMinutes).toBe("number");
        expect(typeof total.validatedMinutes).toBe("number");
      }
      for (const total of summary.byCategory) {
        expect(typeof total.entries).toBe("number");
        expect(typeof total.declaredMinutes).toBe("number");
        expect(typeof total.bankMinutes).toBe("number");
        expect(typeof total.pendingMinutes).toBe("number");
      }
      expect(summary.bankMinutes).toBe(150);
    });

    it("restricts the totals to the period and leaves removed entries and other people's entries out", async () => {
      await logEntry(member, { date: "2026-02-28", declaredMinutes: 10 });
      await logEntry(member, { date: "2026-03-01", declaredMinutes: 20 });
      await logEntry(member, { date: "2026-03-31", declaredMinutes: 40 });
      await logEntry(member, { date: "2026-04-01", declaredMinutes: 80 });
      const removed = await logEntry(member, { date: "2026-03-15", declaredMinutes: 160 });
      await removeEntry(removed.id, member).expect(204);
      await logEntry(otherMember, { date: "2026-03-15", declaredMinutes: 320 });

      const march = await summaryOf(member, { from: "2026-03-01", to: "2026-03-31" });
      expect(march).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
      expect(statusTotal(march, "pending")).toMatchObject({ entries: 2, declaredMinutes: 60 });
      expect(categoryTotal(march, "planning")).toMatchObject({ entries: 2, pendingMinutes: 60 });

      const fromMarch31 = await summaryOf(member, { from: "2026-03-31" });
      expect(fromMarch31).toMatchObject({ from: "2026-03-31", to: null });
      expect(statusTotal(fromMarch31, "pending")).toMatchObject({ declaredMinutes: 120 });

      const everything = await summaryOf(member);
      expect(statusTotal(everything, "pending")).toMatchObject({
        entries: 4,
        declaredMinutes: 150,
      });
    });

    it("answers zeros for a person with no entries", async () => {
      await logEntry(otherMember);

      const summary = await summaryOf(member);

      expect(summary.bankMinutes).toBe(0);
      expect(summary.byStatus.every((total) => total.entries === 0)).toBe(true);
      expect(summary.byCategory.every((total) => total.declaredMinutes === 0)).toBe(true);
    });

    it("answers 400 INVALID_PERIOD when from is after to, and 400 VALIDATION_FAILED for a date that does not exist", async () => {
      const invalid = await getSummary(member, { from: "2026-03-31", to: "2026-03-01" }).expect(
        400,
      );
      expect(invalid.body.error).toBe("INVALID_PERIOD");

      const malformed = await getSummary(member, { to: "2026-02-30" }).expect(400);
      expect(malformed.body.error).toBe("VALIDATION_FAILED");
    });

    it("answers 401 without a session cookie", async () => {
      await request(app.getHttpServer()).get("/me/hours/summary").expect(401);
    });
  });

  describe("DELETE /me/hour-entries/:id", () => {
    it("removes a pending entry of the logged-in person: 204, gone from the statement and the summary, the row kept with deleted_at (CA2)", async () => {
      const entry = await logEntry(member);

      const res = await removeEntry(entry.id, member).expect(204);

      expect(res.body).toEqual({});
      expect((await statement(member)).total).toBe(0);
      expect(statusTotal(await summaryOf(member), "pending")).toMatchObject({ entries: 0 });
      const row = await entryRow(dataSource, entry.id);
      expect(row?.status).toBe("pending");
      expect(row?.deleted_at).toBeInstanceOf(Date);
      expect(row?.updated_at).toEqual(row?.deleted_at);
    });

    it("records a removed event, from pending and the declared minutes to nothing, with the member as actor, at the instant of deleted_at (CA2)", async () => {
      const entry = await logEntry(member, { declaredMinutes: 45 });

      await removeEntry(entry.id, member).expect(204);

      const events = await eventsOf(dataSource, entry.id);
      expect(events.map((event) => event.type)).toEqual(["created", "removed"]);
      expect(events[1]).toMatchObject({
        type: "removed",
        actor_id: member.id,
        from_status: "pending",
        to_status: null,
        from_minutes: 45,
        to_minutes: null,
        note: null,
      });
      expect(events[1].created_at).toEqual((await entryRow(dataSource, entry.id))?.deleted_at);
    });

    it("answers 409 ENTRY_NOT_PENDING for an approved, adjusted or rejected entry, and changes nothing (CA2)", async () => {
      const reviews = [
        { status: "approved", validatedMinutes: 150, reviewNote: null },
        { status: "adjusted", validatedMinutes: 120, reviewNote: "Duas horas." },
        { status: "rejected", validatedMinutes: 0, reviewNote: "Fora do projeto." },
      ] as const;

      for (const review of reviews) {
        const entry = await logEntry(member);
        await reviewEntry(dataSource, entry.id, { ...review, reviewedById: coordinator.id });

        const res = await removeEntry(entry.id, member).expect(409);

        expect(res.body).toMatchObject({
          statusCode: 409,
          error: "ENTRY_NOT_PENDING",
          message: "Only pending hour entries can be removed.",
        });
        const row = await entryRow(dataSource, entry.id);
        expect(row).toMatchObject({ status: review.status, deleted_at: null });
        expect((await eventsOf(dataSource, entry.id)).map((event) => event.type)).toEqual([
          "created",
        ]);
      }
    });

    it("answers 404 HOUR_ENTRY_NOT_FOUND for another person's entry, an unknown id, a malformed id and an entry already removed", async () => {
      const othersEntry = await logEntry(otherMember);
      const removed = await logEntry(member);
      await removeEntry(removed.id, member).expect(204);
      const notFound = {
        statusCode: 404,
        error: "HOUR_ENTRY_NOT_FOUND",
        message: "Hour entry not found.",
      };

      for (const [id, actor] of [
        [othersEntry.id, member],
        [othersEntry.id, superadmin],
        [othersEntry.id, director],
        ["01999a3e-0000-7000-8000-000000000000", member],
        ["not-a-uuid", member],
        [removed.id, member],
      ] as const) {
        const res = await removeEntry(id, actor).expect(404);
        expect(res.body).toMatchObject(notFound);
      }

      expect((await entryRow(dataSource, othersEntry.id))?.deleted_at).toBeNull();
      expect((await eventsOf(dataSource, removed.id)).map((event) => event.type)).toEqual([
        "created",
        "removed",
      ]);
    });

    it("lets the member remove a pending entry a director logged in her name", async () => {
      const res = await request(app.getHttpServer())
        .post(`/members/${member.id}/hour-entries`)
        .set("Cookie", director.cookie)
        .send(hourEntryBody())
        .expect(201);
      const entry = res.body as HourEntryBody;
      expect(entry).toMatchObject({ origin: "on_behalf", createdById: director.id });

      await removeEntry(entry.id, director).expect(404);
      await removeEntry(entry.id, member).expect(204);

      const events = await eventsOf(dataSource, entry.id);
      expect(events.map((event) => [event.type, event.actor_id])).toEqual([
        ["created", director.id],
        ["removed", member.id],
      ]);
    });

    it("accepts the id of the entry in upper case", async () => {
      const entry = await logEntry(member);

      await removeEntry(entry.id.toUpperCase(), member).expect(204);

      expect((await entryRow(dataSource, entry.id))?.deleted_at).toBeInstanceOf(Date);
    });

    it("emits HOUR_ENTRY_REMOVED after the commit", async () => {
      const entry = await logEntry(member);
      const events = collectEvents();

      await removeEntry(entry.id, member).expect(204);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: AuditableAction.HOUR_ENTRY_REMOVED,
        actorId: member.id,
        targetType: "hour_entry",
        targetId: entry.id,
        before: { status: "pending", declaredMinutes: 150 },
      });
      expect(events[0].after.deletedAt).toEqual((await entryRow(dataSource, entry.id))?.deleted_at);
    });

    it("removes once when two requests race: one 204, one 404, a single removed event", async () => {
      const entry = await logEntry(member);

      const [first, second] = await Promise.all([
        removeEntry(entry.id, member),
        removeEntry(entry.id, member),
      ]);

      expect([first.status, second.status].sort()).toEqual([204, 404]);
      expect((await eventsOf(dataSource, entry.id)).map((event) => event.type)).toEqual([
        "created",
        "removed",
      ]);
    });

    it("keeps the history in order: read by created_at, id it is created, then removed", async () => {
      const entry = await logEntry(member);
      await removeEntry(entry.id, member).expect(204);

      const events = await eventsOf(dataSource, entry.id);

      expect(events.map((event) => event.type)).toEqual(["created", "removed"]);
      expect(events[0].created_at.getTime()).toBeLessThan(events[1].created_at.getTime());
      const row = await entryRow(dataSource, entry.id);
      expect(events[0].created_at).toEqual(row?.created_at);
      expect(events[1].created_at).toEqual(row?.deleted_at);
    });

    it("answers 401 without a session cookie", async () => {
      const entry = await logEntry(member);

      await request(app.getHttpServer()).delete(`/me/hour-entries/${entry.id}`).expect(401);

      expect((await entryRow(dataSource, entry.id))?.deleted_at).toBeNull();
    });
  });
});
