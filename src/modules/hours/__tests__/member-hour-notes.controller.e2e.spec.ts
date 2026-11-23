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
import { insertStudent } from "@modules/people/__tests__/fixtures/students.fixture";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { HoursModule } from "../hours.module";

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

process.env.JWT_SECRET = "e2e-member-hour-notes-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

const NOTE = "Aguardando validação da coordenação.";

interface Actor {
  id: string;
  cookie: string;
}

interface CategoryTotal {
  category: string;
  note: string | null;
}

interface SummaryBody {
  byCategory: CategoryTotal[];
}

function notesOf(summary: SummaryBody): Record<string, string | null> {
  return Object.fromEntries(summary.byCategory.map((total) => [total.category, total.note]));
}

/**
 * The observation of coordination on the hours of a member by category (GUS-173): written by
 * `PUT /members/:id/hours/notes`, read in the summary of Meu perfil (`GET /me/hours/summary`) and of
 * the hours of the member (`GET /members/:id/hours`).
 */
describe("MemberHourNotesController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;

  let tech: string;
  let member: Actor;
  let director: Actor;
  let coordinator: Actor;
  let superadmin: Actor;

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
      `TRUNCATE TABLE hour_category_notes, hour_entry_events, hour_entries, student_profiles,
                      invites, departments, people
       RESTART IDENTITY CASCADE`,
    );

    tech = await insertDepartment(dataSource, "Tecnologia");
    member = await createActor("Member", Role.MEMBER, tech);
    director = await createActor("Director", Role.DIRECTOR, tech);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    superadmin = await createActor("Superadmin", Role.SUPERADMIN);
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
  });

  /** A Person with a role and a session cookie; with a department, an approved member profile. */
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

  function putNote(memberId: string, actor: Actor, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .put(`/members/${memberId}/hours/notes`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  async function mySummary(actor: Actor): Promise<SummaryBody> {
    const res = await request(app.getHttpServer())
      .get("/me/hours/summary")
      .set("Cookie", actor.cookie)
      .expect(200);
    return res.body as SummaryBody;
  }

  async function memberSummary(memberId: string, actor: Actor): Promise<SummaryBody> {
    const res = await request(app.getHttpServer())
      .get(`/members/${memberId}/hours`)
      .set("Cookie", actor.cookie)
      .expect(200);
    return (res.body as { summary: SummaryBody }).summary;
  }

  async function noteRows(): Promise<Array<{ category: string; note: string | null }>> {
    return dataSource.query(`SELECT category, note FROM hour_category_notes ORDER BY category`);
  }

  it("shows the observation of coordination in Meu perfil and in the hours of the member, with the same text (CA1, CA2)", async () => {
    const res = await putNote(member.id, coordinator, { category: "planning", note: NOTE }).expect(
      200,
    );

    expect(res.body).toMatchObject({
      personId: member.id,
      category: "planning",
      note: NOTE,
      updatedById: coordinator.id,
    });
    const mine = notesOf(await mySummary(member));
    const viewed = notesOf(await memberSummary(member.id, director));
    expect(mine.planning).toBe(NOTE);
    expect(viewed).toEqual(mine);
    expect(mine.event).toBeNull();
  });

  it("shows the observation whatever the period of the summary: it has none", async () => {
    await putNote(member.id, coordinator, { category: "planning", note: NOTE }).expect(200);

    const res = await request(app.getHttpServer())
      .get("/me/hours/summary")
      .query({ from: "2020-01-01", to: "2020-01-31" })
      .set("Cookie", member.cookie)
      .expect(200);

    expect(notesOf(res.body as SummaryBody).planning).toBe(NOTE);
  });

  it("replaces the observation of the category, keeping one row, and clears it with null or blank", async () => {
    await putNote(member.id, coordinator, { category: "planning", note: NOTE }).expect(200);
    await putNote(member.id, superadmin, { category: "planning", note: "  Conferido.  " }).expect(
      200,
    );
    await putNote(member.id, coordinator, { category: "event", note: "Evento de maio." }).expect(
      200,
    );

    expect(await noteRows()).toEqual([
      { category: "planning", note: "Conferido." },
      { category: "event", note: "Evento de maio." },
    ]);

    const cleared = await putNote(member.id, coordinator, {
      category: "planning",
      note: "   ",
    }).expect(200);
    await putNote(member.id, coordinator, { category: "event", note: null }).expect(200);

    expect(cleared.body.note).toBeNull();
    expect(await noteRows()).toEqual([
      { category: "planning", note: null },
      { category: "event", note: null },
    ]);
    expect(notesOf(await mySummary(member))).toMatchObject({ planning: null, event: null });
  });

  it("emits HOUR_CATEGORY_NOTE_UPDATED without the text of the observation (RNF-13)", async () => {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));

    await putNote(member.id, coordinator, { category: "planning", note: NOTE }).expect(200);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: AuditableAction.HOUR_CATEGORY_NOTE_UPDATED,
      actorId: coordinator.id,
      after: { personId: member.id, category: "planning", hasNote: true },
    });
    expect(JSON.stringify(events[0])).not.toContain(NOTE);
  });

  it("answers 403 FORBIDDEN to a director and to a member: only coordination writes (RN-06), and writes nothing", async () => {
    for (const actor of [director, member]) {
      const res = await putNote(member.id, actor, { category: "planning", note: NOTE }).expect(403);

      expect(res.body).toMatchObject({ error: "FORBIDDEN" });
    }
    expect(await noteRows()).toEqual([]);
  });

  it("answers 404 MEMBER_NOT_FOUND for a malformed id, an unknown person and a student", async () => {
    const student = await insertStudent(dataSource, { name: "Aluna", createdById: director.id });

    for (const id of ["abc", UNKNOWN_ID, student]) {
      const res = await putNote(id, coordinator, { category: "planning", note: NOTE }).expect(404);

      expect(res.body).toMatchObject({ error: "MEMBER_NOT_FOUND" });
    }
    expect(await noteRows()).toEqual([]);
  });

  it("answers 400 VALIDATION_FAILED for an unknown category and a note over 500 characters", async () => {
    const category = await putNote(member.id, coordinator, {
      category: "class",
      note: NOTE,
    }).expect(400);
    const long = await putNote(member.id, coordinator, {
      category: "planning",
      note: "a".repeat(501),
    }).expect(400);

    expect(category.body).toMatchObject({ error: "VALIDATION_FAILED" });
    expect(long.body).toMatchObject({ error: "VALIDATION_FAILED" });
    expect(await noteRows()).toEqual([]);
  });

  it("leaves every observation null in the overview of the team, which sums many members", async () => {
    await putNote(member.id, coordinator, { category: "planning", note: NOTE }).expect(200);

    const res = await request(app.getHttpServer())
      .get("/hours/overview")
      .set("Cookie", coordinator.cookie)
      .expect(200);

    expect(
      (res.body as { summary: SummaryBody }).summary.byCategory.every(
        (total) => total.note === null,
      ),
    ).toBe(true);
  });
});
