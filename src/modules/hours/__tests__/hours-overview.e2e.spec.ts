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
import { Role } from "@shared/enums/role.enum";
import { AUDITABLE_ACTION_EVENT } from "@shared/events/auditable-action.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { HoursModule } from "../hours.module";
import { hourEntryBody, insertPendingEntries } from "./fixtures/hour-entries.fixture";

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

process.env.JWT_SECRET = "e2e-hours-overview-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";
const JUSTIFICATION = "A reunião durou duas horas, conforme a ata.";
const MARCH = { from: "2026-03-01", to: "2026-03-31" };

interface Actor {
  id: string;
  cookie: string;
}

interface HourEntryBody {
  id: string;
  personId: string;
  status: string;
  date: string;
  declaredMinutes: number;
  validatedMinutes: number | null;
  reviewNote: string | null;
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

interface Summary {
  from: string | null;
  to: string | null;
  bankMinutes: number;
  byStatus: StatusTotal[];
  byCategory: CategoryTotal[];
}

interface MemberRef {
  id: string;
  name: string;
  department: { id: string; name: string } | null;
}

interface MemberTotal {
  personId: string;
  member: MemberRef | null;
  entries: number;
  declaredMinutes: number;
  bankMinutes: number;
  pendingEntries: number;
  pendingMinutes: number;
}

interface Overview {
  summary: Summary;
  members: { data: MemberTotal[]; total: number; page: number; limit: number };
}

interface MemberHours {
  member: MemberRef;
  summary: Summary;
  entries: { data: HourEntryBody[]; total: number; page: number; limit: number };
}

const CSV_HEADER =
  '"entry_id";"date";"person_id";"member_name";"department";"category";"activity";"origin";"status";"declared_minutes";"validated_minutes";"review_note";"reviewed_at"';

/** The lines of an exported file without the BOM and the last line end, each as its cells. */
function csvRows(text: string): string[][] {
  const lines = text.slice(1).split("\r\n");
  expect(lines.pop()).toBe("");
  return lines.map((line) => line.slice(1, -1).split('";"'));
}

function statusOf(summary: Summary, status: string): StatusTotal {
  const total = summary.byStatus.find((item) => item.status === status);
  if (total === undefined) throw new Error(`No total for status ${status}`);
  return total;
}

function categoryOf(summary: Summary, category: string): CategoryTotal {
  const total = summary.byCategory.find((item) => item.category === category);
  if (total === undefined) throw new Error(`No total for category ${category}`);
  return total;
}

/** The four numbers of the card, by the formulas of HoursOverviewResponseDto. */
function cardNumbers(summary: Summary) {
  const adjusted = statusOf(summary, "adjusted");
  const rejected = statusOf(summary, "rejected");
  return {
    logged: summary.byStatus.reduce((sum, item) => sum + item.declaredMinutes, 0),
    validated: summary.bankMinutes,
    pending: statusOf(summary, "pending").declaredMinutes,
    adjustedOrRejected: adjusted.entries + rejected.entries,
    notAccepted: adjusted.declaredMinutes - adjusted.validatedMinutes + rejected.declaredMinutes,
  };
}

describe("hours views (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;

  let tech: string;
  let comms: string;
  let coordinator: Actor;
  let superadmin: Actor;
  let directorTech: Actor;
  let directorComms: Actor;
  let directorWithoutDepartment: Actor;
  let memberTech: Actor;
  let memberTech2: Actor;
  let memberComms: Actor;

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
    comms = await insertDepartment(dataSource, "Comunicação");

    coordinator = await createActor("Carla Coordenadora", Role.COORDINATOR);
    superadmin = await createActor("Sara Superadmin", Role.SUPERADMIN);
    directorTech = await createActor("Diego Diretor", Role.DIRECTOR, tech);
    directorComms = await createActor("Denise Diretora", Role.DIRECTOR, comms);
    directorWithoutDepartment = await createActor("Davi Diretor", Role.DIRECTOR, null);
    memberTech = await createActor("Ana Souza", Role.MEMBER, tech, "a1");
    memberTech2 = await createActor("Bruno Lima", Role.MEMBER, tech, "a2");
    memberComms = await createActor("Clara Nunes", Role.MEMBER, comms, "a3");
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
  });

  /**
   * A Person with a role and a session cookie signed without a login. `departmentId` gives her an
   * approved member profile (null: approved, without department); omitted, she has no profile.
   */
  async function createActor(
    name: string,
    role: Role,
    departmentId?: string | null,
    ra?: string,
  ): Promise<Actor> {
    const person = await peopleService.save({ name, ra, role, accessEnabled: true });
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

  async function logOwn(
    actor: Actor,
    overrides: Record<string, unknown> = {},
  ): Promise<HourEntryBody> {
    const res = await request(app.getHttpServer())
      .post("/me/hour-entries")
      .set("Cookie", actor.cookie)
      .send(hourEntryBody(overrides))
      .expect(201);
    return res.body as HourEntryBody;
  }

  async function validate(ids: string[]): Promise<void> {
    await request(app.getHttpServer())
      .patch("/hour-entries/validate")
      .set("Cookie", superadmin.cookie)
      .send({ ids })
      .expect(200);
  }

  async function adjust(id: string, validatedMinutes: number): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/hour-entries/${id}/adjust`)
      .set("Cookie", superadmin.cookie)
      .send({ validatedMinutes, justification: JUSTIFICATION })
      .expect(200);
  }

  async function reject(id: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/hour-entries/${id}/reject`)
      .set("Cookie", superadmin.cookie)
      .send({ reason: "Fora do projeto." })
      .expect(200);
  }

  function overviewOf(actor: Actor, query: Record<string, string | number> = {}) {
    return request(app.getHttpServer())
      .get("/hours/overview")
      .query(query)
      .set("Cookie", actor.cookie);
  }

  function memberHoursOf(actor: Actor, id: string, query: Record<string, string | number> = {}) {
    return request(app.getHttpServer())
      .get(`/members/${id}/hours`)
      .query(query)
      .set("Cookie", actor.cookie);
  }

  /**
   * Ana (tech): 240 adjusted to 120, 60 approved, 90 pending. Bruno (tech): 300 rejected. Clara
   * (comms): 150 and 150 pending. All in March 2026.
   */
  async function logTheMonth(): Promise<void> {
    const anaMeeting = await logOwn(memberTech, { category: "meeting", declaredMinutes: 240 });
    const anaApproved = await logOwn(memberTech, { declaredMinutes: 60 });
    await logOwn(memberTech, { declaredMinutes: 90 });
    const brunoRejected = await logOwn(memberTech2, { declaredMinutes: 300 });
    await logOwn(memberComms, { declaredMinutes: 150 });
    await logOwn(memberComms, { declaredMinutes: 150, date: "2026-03-20" });
    await adjust(anaMeeting.id, 120);
    await validate([anaApproved.id]);
    await reject(brunoRejected.id);
  }

  describe("GET /hours/overview", () => {
    it("totals the period for coordination and lists the members with pending first (CA1)", async () => {
      await logTheMonth();

      const res = await overviewOf(coordinator, MARCH).expect(200);
      const overview = res.body as Overview;

      expect(overview.summary).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
      expect(statusOf(overview.summary, "pending")).toEqual({
        status: "pending",
        entries: 3,
        declaredMinutes: 390,
        validatedMinutes: 0,
      });
      expect(cardNumbers(overview.summary)).toEqual({
        logged: 990,
        validated: 180,
        pending: 390,
        adjustedOrRejected: 2,
        notAccepted: 420,
      });

      expect(overview.members).toMatchObject({ total: 3, page: 1, limit: 20 });
      expect(overview.members.data).toEqual([
        {
          personId: memberComms.id,
          member: {
            id: memberComms.id,
            name: "Clara Nunes",
            department: { id: comms, name: "Comunicação" },
          },
          entries: 2,
          declaredMinutes: 300,
          bankMinutes: 0,
          pendingEntries: 2,
          pendingMinutes: 300,
        },
        {
          personId: memberTech.id,
          member: {
            id: memberTech.id,
            name: "Ana Souza",
            department: { id: tech, name: "Tecnologia" },
          },
          entries: 3,
          declaredMinutes: 390,
          bankMinutes: 180,
          pendingEntries: 1,
          pendingMinutes: 90,
        },
        {
          personId: memberTech2.id,
          member: {
            id: memberTech2.id,
            name: "Bruno Lima",
            department: { id: tech, name: "Tecnologia" },
          },
          entries: 1,
          declaredMinutes: 300,
          bankMinutes: 0,
          pendingEntries: 0,
          pendingMinutes: 0,
        },
      ]);
    });

    it("shows a director only the members and the totals of her own department (CA3)", async () => {
      await logTheMonth();
      await logOwn(directorTech, { declaredMinutes: 30 });

      const res = await overviewOf(directorTech, MARCH).expect(200);
      const overview = res.body as Overview;

      expect(overview.members.data.map((line) => line.personId)).toEqual([
        memberTech.id,
        directorTech.id,
        memberTech2.id,
      ]);
      expect(overview.members.total).toBe(3);
      expect(cardNumbers(overview.summary)).toEqual({
        logged: 720,
        validated: 180,
        pending: 120,
        adjustedOrRejected: 2,
        notAccepted: 420,
      });

      const otherDepartment = await overviewOf(directorComms, MARCH).expect(200);
      expect((otherDepartment.body as Overview).members.data.map((line) => line.personId)).toEqual([
        memberComms.id,
      ]);
    });

    it("searches the members by name or RA, ignoring case and accents, and the totals follow the search", async () => {
      await logTheMonth();

      const byName = (await overviewOf(coordinator, { ...MARCH, search: "SÓUZA" }).expect(200))
        .body as Overview;
      expect(byName.members.data.map((line) => line.personId)).toEqual([memberTech.id]);
      expect(byName.summary.bankMinutes).toBe(180);
      expect(cardNumbers(byName.summary).logged).toBe(390);

      const byRa = (await overviewOf(coordinator, { ...MARCH, search: "a3" }).expect(200))
        .body as Overview;
      expect(byRa.members.data.map((line) => line.personId)).toEqual([memberComms.id]);
      expect(cardNumbers(byRa.summary).logged).toBe(300);

      const inDepartment = (await overviewOf(directorTech, { search: "Clara" }).expect(200))
        .body as Overview;
      expect(inDepartment.members.data).toEqual([]);
      expect(cardNumbers(inDepartment.summary).logged).toBe(0);
    });

    it("lists coordination without member profile with her own entries and department null, and leaves members without entries in the period out", async () => {
      await logOwn(coordinator, { declaredMinutes: 45 });
      await logOwn(memberTech, { date: "2026-02-10" });

      const res = await overviewOf(coordinator, MARCH).expect(200);
      const overview = res.body as Overview;

      expect(overview.members.data).toEqual([
        expect.objectContaining({
          personId: coordinator.id,
          member: { id: coordinator.id, name: "Carla Coordenadora", department: null },
          pendingMinutes: 45,
        }),
      ]);
      expect(overview.members.total).toBe(1);
    });

    it("paginates with a stable order and counts every member of the period", async () => {
      for (const actor of [memberTech, memberTech2, memberComms]) {
        await logOwn(actor, { declaredMinutes: 150 });
      }
      const byId = [memberTech.id, memberTech2.id, memberComms.id].sort();

      const first = (await overviewOf(coordinator, { page: 1, limit: 2 }).expect(200))
        .body as Overview;
      const second = (await overviewOf(coordinator, { page: 2, limit: 2 }).expect(200))
        .body as Overview;

      expect(first.members).toMatchObject({ total: 3, page: 1, limit: 2 });
      expect(second.members).toMatchObject({ total: 3, page: 2, limit: 2 });
      expect([...first.members.data, ...second.members.data].map((line) => line.personId)).toEqual(
        byId,
      );
    });

    it("leaves removed entries and entries outside the period out", async () => {
      await logOwn(memberTech, { declaredMinutes: 60 });
      await logOwn(memberTech, { declaredMinutes: 30, date: "2026-02-28" });
      await logOwn(memberTech, { declaredMinutes: 20, date: "2026-04-01" });
      const removed = await logOwn(memberTech, { declaredMinutes: 500 });
      await request(app.getHttpServer())
        .delete(`/me/hour-entries/${removed.id}`)
        .set("Cookie", memberTech.cookie)
        .expect(204);

      const overview = (await overviewOf(coordinator, MARCH).expect(200)).body as Overview;

      expect(cardNumbers(overview.summary).logged).toBe(60);
      expect(overview.members.data).toEqual([
        expect.objectContaining({ personId: memberTech.id, entries: 1, declaredMinutes: 60 }),
      ]);

      const open = (await overviewOf(coordinator).expect(200)).body as Overview;
      expect(cardNumbers(open.summary).logged).toBe(110);
    });

    it("returns numbers, not strings, for every total", async () => {
      await logTheMonth();

      const overview = (await overviewOf(coordinator).expect(200)).body as Overview;

      expect(typeof overview.summary.bankMinutes).toBe("number");
      for (const total of overview.summary.byStatus) {
        expect(typeof total.entries).toBe("number");
        expect(typeof total.declaredMinutes).toBe("number");
        expect(typeof total.validatedMinutes).toBe("number");
      }
      for (const line of overview.members.data) {
        for (const value of [
          line.entries,
          line.declaredMinutes,
          line.bankMinutes,
          line.pendingEntries,
          line.pendingMinutes,
        ]) {
          expect(typeof value).toBe("number");
        }
      }
      expect(typeof overview.members.total).toBe("number");
    });

    it("answers 403 FORBIDDEN to a member, an empty overview to a director without department, and 400 INVALID_PERIOD", async () => {
      await logTheMonth();

      const member = await overviewOf(memberTech).expect(403);
      expect(member.body.error).toBe("FORBIDDEN");

      const empty = (await overviewOf(directorWithoutDepartment, MARCH).expect(200))
        .body as Overview;
      expect(empty.members).toEqual({ data: [], total: 0, page: 1, limit: 20 });
      expect(cardNumbers(empty.summary).logged).toBe(0);

      const invalid = await overviewOf(coordinator, {
        from: "2026-03-31",
        to: "2026-03-01",
      }).expect(400);
      expect(invalid.body).toMatchObject({
        error: "INVALID_PERIOD",
        details: [{ field: "to", message: "to must be on or after from" }],
      });
    });
  });

  describe("GET /hours/export", () => {
    function exportOf(actor: Actor, query: Record<string, string> = {}) {
      return request(app.getHttpServer())
        .get("/hours/export")
        .query(query)
        .set("Cookie", actor.cookie);
    }

    it("exports the entries of the period as CSV: BOM, header, one line per entry, text/csv and the file name", async () => {
      const meeting = await logOwn(memberTech, {
        category: "meeting",
        declaredMinutes: 240,
        date: "2026-03-12",
        notes: "Nota pessoal.",
      });
      const planning = await logOwn(memberComms, { declaredMinutes: 90, date: "2026-03-10" });
      await logOwn(memberTech, { date: "2026-04-01" });
      await adjust(meeting.id, 120);

      const res = await exportOf(coordinator, { ...MARCH, format: "csv" }).expect(200);

      expect(res.headers["content-type"]).toMatch(/^text\/csv/);
      expect(res.headers["content-disposition"]).toBe(
        'attachment; filename="hours_2026-03-01_2026-03-31.csv"',
      );
      expect(res.text.startsWith("\uFEFF" + CSV_HEADER + "\r\n")).toBe(true);
      const rows = csvRows(res.text);
      expect(rows).toHaveLength(3);
      expect(rows[1]).toEqual([
        planning.id,
        "2026-03-10",
        memberComms.id,
        "Clara Nunes",
        "Comunicação",
        "planning",
        "Planejamento da aula de teclado e mouse",
        "manual",
        "pending",
        "90",
        "",
        "",
        "",
      ]);
      expect(rows[2].slice(0, 12)).toEqual([
        meeting.id,
        "2026-03-12",
        memberTech.id,
        "Ana Souza",
        "Tecnologia",
        "meeting",
        "Planejamento da aula de teclado e mouse",
        "manual",
        "adjusted",
        "240",
        "120",
        JUSTIFICATION,
      ]);
      expect(rows[2][12]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(res.text).not.toContain("Nota pessoal.");
    });

    it("exports to a director only the entries of her own department", async () => {
      const ana = await logOwn(memberTech);
      const own = await logOwn(directorTech);
      await logOwn(memberComms);
      await logOwn(coordinator);

      const res = await exportOf(directorTech).expect(200);

      const ids = csvRows(res.text)
        .slice(1)
        .map((row) => row[0]);
      expect(ids.sort()).toEqual([ana.id, own.id].sort());
      expect(res.headers["content-disposition"]).toBe('attachment; filename="hours_start_end.csv"');

      const empty = await exportOf(directorWithoutDepartment).expect(200);
      expect(empty.text).toBe("\uFEFF" + CSV_HEADER + "\r\n");
    });

    it("escapes quotes, semicolons and line breaks, and neutralizes a formula in the activity", async () => {
      await logOwn(memberTech, { activity: '=HYPERLINK("http://example.com")' });
      await logOwn(memberTech, { activity: 'Aula; "extra"\nsegunda linha', date: "2026-03-11" });

      const res = await exportOf(coordinator).expect(200);

      expect(res.text).toContain('"\'=HYPERLINK(""http://example.com"")"');
      expect(res.text).toContain('"Aula; ""extra""\nsegunda linha"');
      expect(res.text.split("\r\n")).toHaveLength(4);
    });

    it("exports more entries than one batch, each once, in order of date and id", async () => {
      await insertPendingEntries(dataSource, {
        personId: memberTech.id,
        date: "2026-03-10",
        declaredMinutes: 30,
        count: 501,
      });
      const later = await logOwn(memberTech2, { date: "2026-03-11" });
      const earlier = await logOwn(memberComms, { date: "2026-03-09" });

      const res = await exportOf(coordinator).expect(200);

      const rows = csvRows(res.text).slice(1);
      expect(rows).toHaveLength(503);
      const ids = rows.map((row) => row[0]);
      expect(new Set(ids).size).toBe(503);
      expect(ids[0]).toBe(earlier.id);
      expect(ids[502]).toBe(later.id);
      const sameDay = ids.slice(1, 502);
      expect(sameDay).toEqual([...sameDay].sort());
      expect(rows.slice(1, 502).every((row) => row[3] === "Ana Souza")).toBe(true);
    });

    it("answers 400 VALIDATION_FAILED for format=xlsx and 400 INVALID_PERIOD as JSON, before any byte of CSV", async () => {
      const xlsx = await exportOf(coordinator, { format: "xlsx" }).expect(400);
      expect(xlsx.headers["content-type"]).toMatch(/^application\/json/);
      expect(xlsx.body.error).toBe("VALIDATION_FAILED");
      expect(xlsx.body.details).toEqual([expect.objectContaining({ field: "format" })]);

      const invalid = await exportOf(coordinator, { from: "2026-03-31", to: "2026-03-01" }).expect(
        400,
      );
      expect(invalid.headers["content-type"]).toMatch(/^application\/json/);
      expect(invalid.body.error).toBe("INVALID_PERIOD");
    });

    it("answers 403 FORBIDDEN to a member", async () => {
      const res = await exportOf(memberTech).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
    });
  });

  describe("GET /members/:id/hours", () => {
    it("answers the member, the totals, the hours by category and the entries of the period (CA2: the adjustment with its justification)", async () => {
      const meeting = await logOwn(memberTech, {
        category: "meeting",
        declaredMinutes: 240,
        date: "2026-03-12",
      });
      const planning = await logOwn(memberTech, { declaredMinutes: 90, date: "2026-03-10" });
      await logOwn(memberTech, { declaredMinutes: 60, date: "2026-04-02" });
      await logOwn(memberTech2, { declaredMinutes: 30 });
      await adjust(meeting.id, 120);

      const res = await memberHoursOf(coordinator, memberTech.id, MARCH).expect(200);
      const hours = res.body as MemberHours;

      expect(hours.member).toEqual({
        id: memberTech.id,
        name: "Ana Souza",
        department: { id: tech, name: "Tecnologia" },
      });
      expect(hours.summary).toMatchObject({
        from: "2026-03-01",
        to: "2026-03-31",
        bankMinutes: 120,
      });
      expect(categoryOf(hours.summary, "meeting")).toEqual({
        category: "meeting",
        entries: 1,
        declaredMinutes: 240,
        bankMinutes: 120,
        pendingMinutes: 0,
      });
      expect(categoryOf(hours.summary, "planning")).toMatchObject({ pendingMinutes: 90 });
      expect(hours.summary.byCategory).toHaveLength(7);
      expect(hours.entries).toMatchObject({ total: 2, page: 1, limit: 20 });
      expect(hours.entries.data.map((entry) => entry.id)).toEqual([meeting.id, planning.id]);
      expect(hours.entries.data[0]).toMatchObject({
        status: "adjusted",
        declaredMinutes: 240,
        validatedMinutes: 120,
        reviewNote: JUSTIFICATION,
      });
    });

    it("lets a director read a member of her department and answers 403 FORBIDDEN_SCOPE for another department", async () => {
      await memberHoursOf(directorTech, memberTech.id).expect(200);
      await memberHoursOf(directorTech, directorTech.id).expect(200);

      const res = await memberHoursOf(directorTech, memberComms.id).expect(403);
      expect(res.body).toMatchObject({ statusCode: 403, error: "FORBIDDEN_SCOPE" });
      await memberHoursOf(directorWithoutDepartment, memberTech.id).expect(403);
      await memberHoursOf(directorTech, coordinator.id).expect(403);
    });

    it("opens the hours of coordination without member profile for coordination", async () => {
      await logOwn(coordinator, { declaredMinutes: 45 });

      const res = await memberHoursOf(superadmin, coordinator.id).expect(200);

      expect((res.body as MemberHours).member).toEqual({
        id: coordinator.id,
        name: "Carla Coordenadora",
        department: null,
      });
      expect((res.body as MemberHours).entries.total).toBe(1);
    });

    it("answers 404 MEMBER_NOT_FOUND for a student, an unknown id and a malformed id, and 403 FORBIDDEN to a member", async () => {
      const student = await peopleService.save({ name: "Estudante" });

      for (const id of [student.id, UNKNOWN_ID, "not-a-uuid"]) {
        const res = await memberHoursOf(coordinator, id).expect(404);
        expect(res.body).toMatchObject({
          statusCode: 404,
          error: "MEMBER_NOT_FOUND",
          message: "Member not found.",
        });
      }
      const notFoundFirst = await memberHoursOf(directorComms, UNKNOWN_ID).expect(404);
      expect(notFoundFirst.body.error).toBe("MEMBER_NOT_FOUND");

      const member = await memberHoursOf(memberTech, memberTech2.id).expect(403);
      expect(member.body.error).toBe("FORBIDDEN");
    });
  });
});
