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

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  describe("POST /me/hour-entries", () => {
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
});
