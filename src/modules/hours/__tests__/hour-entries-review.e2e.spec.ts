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
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { HoursModule } from "../hours.module";
import { eventsOf, hourEntryBody } from "./fixtures/hour-entries.fixture";

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

process.env.JWT_SECRET = "e2e-hour-entries-review-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";
const JUSTIFICATION = "A reunião durou duas horas, conforme a ata.";
const REASON = "Atividade fora do projeto.";

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
  status: string;
  declaredMinutes: number;
  validatedMinutes: number | null;
  reviewNote: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
}

interface QueueItem {
  id: string;
  personId: string;
  status: string;
  date: string;
  member: { id: string; name: string; department: { id: string; name: string } | null } | null;
}

interface QueuePage {
  data: QueueItem[];
  total: number;
  page: number;
  limit: number;
}

interface HistoryItem {
  id: string;
  hourEntryId: string;
  type: string;
  actor: { id: string; name: string } | null;
  fromStatus: string | null;
  toStatus: string | null;
  fromMinutes: number | null;
  toMinutes: number | null;
  note: string | null;
  createdAt: string;
}

interface ReviewRow {
  status: string;
  declared_minutes: number;
  validated_minutes: number | null;
  review_note: string | null;
  reviewed_by_id: string | null;
  reviewed_at: Date | null;
  updated_at: Date;
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field);
}

describe("HourEntriesController (e2e)", () => {
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

  /** The person logs her own hours through the route, with its real history. */
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

  function validate(actor: Actor, ids: unknown) {
    return request(app.getHttpServer())
      .patch("/hour-entries/validate")
      .set("Cookie", actor.cookie)
      .send({ ids });
  }

  function adjust(actor: Actor, id: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/hour-entries/${id}/adjust`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  function reject(actor: Actor, id: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/hour-entries/${id}/reject`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  function removeOwn(actor: Actor, id: string) {
    return request(app.getHttpServer())
      .delete(`/me/hour-entries/${id}`)
      .set("Cookie", actor.cookie);
  }

  async function statementOf(actor: Actor): Promise<HourEntryBody[]> {
    const res = await request(app.getHttpServer())
      .get("/me/hour-entries")
      .set("Cookie", actor.cookie)
      .expect(200);
    return (res.body as { data: HourEntryBody[] }).data;
  }

  async function reviewRowOf(id: string): Promise<ReviewRow> {
    const rows: ReviewRow[] = await dataSource.query(
      `SELECT status, declared_minutes, validated_minutes, review_note, reviewed_by_id, reviewed_at,
              updated_at
         FROM hour_entries WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  function queueOf(actor: Actor, query: Record<string, string | number> = {}) {
    return request(app.getHttpServer())
      .get("/hour-entries")
      .query(query)
      .set("Cookie", actor.cookie);
  }

  function historyOf(actor: Actor, id: string) {
    return request(app.getHttpServer())
      .get(`/hour-entries/${id}/history`)
      .set("Cookie", actor.cookie);
  }

  describe("GET /hour-entries", () => {
    it("lists the pending entries of every member to coordination, oldest day first, with the member and the department", async () => {
      const ana = await logOwn(memberTech, { date: "2026-03-12" });
      const clara = await logOwn(memberComms, { date: "2026-03-10" });
      const diego = await logOwn(directorTech, { date: "2026-03-11" });
      const validated = await logOwn(memberTech2, { date: "2026-03-09" });
      await validate(coordinator, [validated.id]).expect(200);

      const res = await queueOf(coordinator).expect(200);
      const page = res.body as QueuePage;

      expect(page).toMatchObject({ total: 3, page: 1, limit: 20 });
      expect(page.data.map((item) => item.id)).toEqual([clara.id, diego.id, ana.id]);
      expect(page.data.every((item) => item.status === "pending")).toBe(true);
      expect(page.data[0].member).toEqual({
        id: memberComms.id,
        name: "Clara Nunes",
        department: { id: comms, name: "Comunicação" },
      });
      expect(page.data[2].member).toEqual({
        id: memberTech.id,
        name: "Ana Souza",
        department: { id: tech, name: "Tecnologia" },
      });
    });

    it("lists to a director only the pending entries of her own department, her own included", async () => {
      const ana = await logOwn(memberTech, { date: "2026-03-10" });
      const bruno = await logOwn(memberTech2, { date: "2026-03-11" });
      const own = await logOwn(directorTech, { date: "2026-03-12" });
      await logOwn(memberComms, { date: "2026-03-09" });
      await logOwn(coordinator, { date: "2026-03-09" });

      const res = await queueOf(directorTech).expect(200);

      expect((res.body as QueuePage).data.map((item) => item.id)).toEqual([
        ana.id,
        bruno.id,
        own.id,
      ]);
      expect((res.body as QueuePage).total).toBe(3);
    });

    it("filters by status, by member and by period", async () => {
      const march1 = await logOwn(memberTech, { date: "2026-03-01" });
      const march15 = await logOwn(memberTech, { date: "2026-03-15" });
      const march31 = await logOwn(memberTech2, { date: "2026-03-31" });
      const april1 = await logOwn(memberTech, { date: "2026-04-01" });
      await validate(coordinator, [march15.id]).expect(200);
      const ids = async (query: Record<string, string>) =>
        ((await queueOf(coordinator, query).expect(200)).body as QueuePage).data.map(
          (item) => item.id,
        );

      expect(await ids({ status: "approved" })).toEqual([march15.id]);
      expect(await ids({ personId: memberTech.id })).toEqual([march1.id, april1.id]);
      expect(await ids({ from: "2026-03-01", to: "2026-03-31" })).toEqual([march1.id, march31.id]);
      expect(await ids({ status: "pending", personId: memberTech2.id })).toEqual([march31.id]);

      const invalid = await queueOf(coordinator, { from: "2026-03-31", to: "2026-03-01" }).expect(
        400,
      );
      expect(invalid.body.error).toBe("INVALID_PERIOD");
      const malformed = await queueOf(coordinator, { personId: "42" }).expect(400);
      expect(malformed.body.error).toBe("VALIDATION_FAILED");
    });

    it("leaves removed entries out", async () => {
      const kept = await logOwn(memberTech);
      const removed = await logOwn(memberTech);
      await removeOwn(memberTech, removed.id).expect(204);

      const res = await queueOf(coordinator).expect(200);

      expect((res.body as QueuePage).data.map((item) => item.id)).toEqual([kept.id]);
    });

    it("answers 403 FORBIDDEN to a member and an empty page to a director without department", async () => {
      await logOwn(memberTech);

      const member = await queueOf(memberTech).expect(403);
      expect(member.body.error).toBe("FORBIDDEN");

      const empty = await queueOf(directorWithoutDepartment).expect(200);
      expect(empty.body).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });
  });

  describe("GET /hour-entries/:id/history", () => {
    it("shows the creation and the adjustment with author and instant (CA4)", async () => {
      const entry = await logOwn(memberTech, { declaredMinutes: 240 });
      const adjusted = await adjust(coordinator, entry.id, {
        validatedMinutes: 120,
        justification: JUSTIFICATION,
      }).expect(200);

      const res = await historyOf(coordinator, entry.id).expect(200);
      const history = res.body as HistoryItem[];

      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        hourEntryId: entry.id,
        type: "created",
        actor: { id: memberTech.id, name: "Ana Souza" },
        fromStatus: null,
        toStatus: "pending",
        fromMinutes: null,
        toMinutes: 240,
        note: null,
      });
      expect(history[1]).toMatchObject({
        hourEntryId: entry.id,
        type: "adjusted",
        actor: { id: coordinator.id, name: "Carla Coordenadora" },
        fromStatus: "pending",
        toStatus: "adjusted",
        fromMinutes: 240,
        toMinutes: 120,
        note: JUSTIFICATION,
      });
      expect(history[1].createdAt).toBe((adjusted.body as HourEntryBody).reviewedAt);
      expect(new Date(history[0].createdAt).getTime()).toBeLessThanOrEqual(
        new Date(history[1].createdAt).getTime(),
      );
      expect(history[0]).not.toHaveProperty("updatedAt");
    });

    it("shows the history of a removed entry: created, then removed", async () => {
      const entry = await logOwn(memberTech);
      await removeOwn(memberTech, entry.id).expect(204);

      for (const actor of [memberTech, coordinator]) {
        const res = await historyOf(actor, entry.id).expect(200);
        expect((res.body as HistoryItem[]).map((item) => [item.type, item.actor?.id])).toEqual([
          ["created", memberTech.id],
          ["removed", memberTech.id],
        ]);
      }
    });

    it("lets the member read the history of her entry and answers 403 FORBIDDEN_SCOPE for someone else's", async () => {
      const own = await logOwn(memberTech);
      const other = await logOwn(memberTech2);

      await historyOf(memberTech, own.id).expect(200);
      const res = await historyOf(memberTech, other.id).expect(403);

      expect(res.body).toMatchObject({ statusCode: 403, error: "FORBIDDEN_SCOPE" });
    });

    it("lets a director read the history of an entry of her department and answers 403 FORBIDDEN_SCOPE for another department", async () => {
      const techEntry = await logOwn(memberTech);
      const commsEntry = await logOwn(memberComms);

      await historyOf(directorTech, techEntry.id).expect(200);
      const res = await historyOf(directorTech, commsEntry.id).expect(403);
      expect(res.body.error).toBe("FORBIDDEN_SCOPE");
      const withoutDepartment = await historyOf(directorWithoutDepartment, techEntry.id).expect(
        403,
      );
      expect(withoutDepartment.body.error).toBe("FORBIDDEN_SCOPE");
      await historyOf(superadmin, commsEntry.id).expect(200);
    });

    it("answers 404 HOUR_ENTRY_NOT_FOUND for an unknown or malformed id", async () => {
      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await historyOf(memberTech, id).expect(404);
        expect(res.body).toMatchObject({
          statusCode: 404,
          error: "HOUR_ENTRY_NOT_FOUND",
          message: "Hour entry not found.",
        });
      }
    });
  });

  describe("PATCH /hour-entries/validate", () => {
    it("stores approved with the declared minutes, the reviewer and the instant, and an approved event per entry at that instant", async () => {
      const first = await logOwn(memberTech, { declaredMinutes: 60 });
      const second = await logOwn(memberComms, { declaredMinutes: 90 });

      const res = await validate(coordinator, [second.id, first.id]).expect(200);

      const answer = res.body as HourEntryBody[];
      expect(answer.map((entry) => entry.id)).toEqual([second.id, first.id]);
      expect(answer[0]).toMatchObject({
        status: "approved",
        declaredMinutes: 90,
        validatedMinutes: 90,
        reviewNote: null,
        reviewedById: coordinator.id,
      });
      for (const [entry, minutes] of [
        [first, 60],
        [second, 90],
      ] as const) {
        const row = await reviewRowOf(entry.id);
        expect(row).toMatchObject({
          status: "approved",
          declared_minutes: minutes,
          validated_minutes: minutes,
          review_note: null,
          reviewed_by_id: coordinator.id,
        });
        expect(row.updated_at).toEqual(row.reviewed_at);

        const history = await eventsOf(dataSource, entry.id);
        expect(history.map((event) => event.type)).toEqual(["created", "approved"]);
        expect(history[1]).toMatchObject({
          actor_id: coordinator.id,
          from_status: "pending",
          to_status: "approved",
          from_minutes: minutes,
          to_minutes: minutes,
          note: null,
        });
        expect(history[1].created_at).toEqual(row.reviewed_at);
      }
      expect((await reviewRowOf(first.id)).reviewed_at).toEqual(
        (await reviewRowOf(second.id)).reviewed_at,
      );
    });

    it("answers 403 FORBIDDEN to a director and to a member, and validates nothing (CA3)", async () => {
      const entry = await logOwn(memberTech);

      for (const actor of [directorTech, directorWithoutDepartment, memberTech2]) {
        const res = await validate(actor, [entry.id]).expect(403);
        expect(res.body.error).toBe("FORBIDDEN");
      }
      expect((await reviewRowOf(entry.id)).status).toBe("pending");
    });

    it("answers 409 SELF_REVIEW_NOT_ALLOWED with the position of the coordinator's own entry, and validates nothing", async () => {
      const member = await logOwn(memberTech);
      const own = await logOwn(coordinator);

      const res = await validate(coordinator, [member.id, own.id]).expect(409);

      expect(res.body).toMatchObject({
        statusCode: 409,
        error: "SELF_REVIEW_NOT_ALLOWED",
        message: "You cannot review your own hour entry.",
      });
      expect(fieldsOf(res.body as { details?: FieldError[] })).toEqual(["ids.1"]);
      expect((await reviewRowOf(member.id)).status).toBe("pending");
      expect((await reviewRowOf(own.id)).status).toBe("pending");
    });

    it("answers 409 ENTRY_NOT_PENDING with the position of a reviewed entry, and validates nothing", async () => {
      const reviewed = await logOwn(memberTech);
      const pending = await logOwn(memberTech2);
      await validate(coordinator, [reviewed.id]).expect(200);

      const res = await validate(coordinator, [pending.id, reviewed.id]).expect(409);

      expect(res.body).toMatchObject({
        error: "ENTRY_NOT_PENDING",
        message: "Only pending hour entries can be reviewed.",
      });
      expect(fieldsOf(res.body as { details?: FieldError[] })).toEqual(["ids.1"]);
      expect((await reviewRowOf(pending.id)).status).toBe("pending");
      expect((await eventsOf(dataSource, reviewed.id)).map((event) => event.type)).toEqual([
        "created",
        "approved",
      ]);
    });

    it("answers 400 HOUR_ENTRY_NOT_FOUND for an unknown or removed id, and 400 DUPLICATE_HOUR_ENTRY for an id repeated in another letter case", async () => {
      const kept = await logOwn(memberTech);
      const removed = await logOwn(memberTech);
      await removeOwn(memberTech, removed.id).expect(204);

      const notFound = await validate(coordinator, [kept.id, removed.id, UNKNOWN_ID]).expect(400);
      expect(notFound.body).toMatchObject({
        error: "HOUR_ENTRY_NOT_FOUND",
        message: "One or more hour entries do not exist.",
      });
      expect(fieldsOf(notFound.body as { details?: FieldError[] })).toEqual(["ids.1", "ids.2"]);

      const duplicate = await validate(coordinator, [kept.id, kept.id.toUpperCase()]).expect(400);
      expect(duplicate.body).toMatchObject({
        error: "DUPLICATE_HOUR_ENTRY",
        message: "The same hour entry appears more than once.",
      });
      expect(fieldsOf(duplicate.body as { details?: FieldError[] })).toEqual(["ids.1"]);

      expect((await reviewRowOf(kept.id)).status).toBe("pending");
    });

    it("validates an id in upper case", async () => {
      const entry = await logOwn(memberTech);

      const res = await validate(coordinator, [entry.id.toUpperCase()]).expect(200);

      expect((res.body as HourEntryBody[])[0]).toMatchObject({ id: entry.id, status: "approved" });
    });

    it("answers 400 VALIDATION_FAILED for an empty list, 101 ids and a malformed id", async () => {
      const entry = await logOwn(memberTech);
      const tooMany = Array.from(
        { length: 101 },
        (_, index) => `01999a3e-7c1b-7000-8000-${index.toString(16).padStart(12, "0")}`,
      );

      for (const ids of [[], tooMany, [entry.id, "not-a-uuid"], entry.id]) {
        const res = await validate(coordinator, ids).expect(400);
        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body as { details?: FieldError[] })).toEqual(["ids"]);
      }
      expect((await reviewRowOf(entry.id)).status).toBe("pending");
    });

    it("validates once when two batches race on the same entry: one 200, one 409, a single approved event", async () => {
      const shared = await logOwn(memberTech);
      const first = await logOwn(memberTech2);
      const second = await logOwn(memberComms);

      const responses = await Promise.all([
        validate(coordinator, [first.id, shared.id]),
        validate(superadmin, [shared.id, second.id]),
      ]);

      expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
      const loser = responses.find((res) => res.status === 409);
      expect(loser?.body.error).toBe("ENTRY_NOT_PENDING");
      expect((await eventsOf(dataSource, shared.id)).map((event) => event.type)).toEqual([
        "created",
        "approved",
      ]);
    });

    it("serializes the review and the removal of the same entry: 200 and 409, or 204 and 400, and one event after created", async () => {
      const entry = await logOwn(memberTech);

      const [review, removal] = await Promise.all([
        validate(coordinator, [entry.id]),
        removeOwn(memberTech, entry.id),
      ]);

      expect([
        [200, 409],
        [400, 204],
      ]).toContainEqual([review.status, removal.status]);
      const history = await eventsOf(dataSource, entry.id);
      expect(history).toHaveLength(2);
      expect(history[1].type).toBe(review.status === 200 ? "approved" : "removed");
    });

    it("emits HOUR_ENTRY_APPROVED once per entry after the commit, without the review note", async () => {
      const first = await logOwn(memberTech);
      const second = await logOwn(memberTech2);
      const events = collectEvents();

      await validate(coordinator, [first.id, second.id]).expect(200);

      expect(events.map((event) => [event.action, event.targetId])).toEqual([
        [AuditableAction.HOUR_ENTRY_APPROVED, first.id],
        [AuditableAction.HOUR_ENTRY_APPROVED, second.id],
      ]);
      expect(events[0]).toMatchObject({
        actorId: coordinator.id,
        targetType: "hour_entry",
        after: { status: "approved", validatedMinutes: 150, reviewedById: coordinator.id },
      });
      expect(events[0].after).not.toHaveProperty("reviewNote");
    });

    it("answers 401 without a session cookie", async () => {
      const entry = await logOwn(memberTech);

      await request(app.getHttpServer())
        .patch("/hour-entries/validate")
        .send({ ids: [entry.id] })
        .expect(401);
    });
  });

  describe("PATCH /hour-entries/:id/adjust", () => {
    it("adjusts 4h to 2h keeping both values, and the justification shows in the statement of the member (CA2)", async () => {
      const entry = await logOwn(memberTech, { declaredMinutes: 240 });

      const res = await adjust(coordinator, entry.id, {
        validatedMinutes: 120,
        justification: JUSTIFICATION,
      }).expect(200);

      expect(res.body).toMatchObject({
        id: entry.id,
        status: "adjusted",
        declaredMinutes: 240,
        validatedMinutes: 120,
        reviewNote: JUSTIFICATION,
        reviewedById: coordinator.id,
      });
      const [inStatement] = await statementOf(memberTech);
      expect(inStatement).toMatchObject({
        id: entry.id,
        status: "adjusted",
        declaredMinutes: 240,
        validatedMinutes: 120,
        reviewNote: JUSTIFICATION,
      });
      const history = await eventsOf(dataSource, entry.id);
      expect(history[1]).toMatchObject({
        type: "adjusted",
        actor_id: coordinator.id,
        from_status: "pending",
        to_status: "adjusted",
        from_minutes: 240,
        to_minutes: 120,
        note: JUSTIFICATION,
      });
    });

    it("accepts more minutes than declared", async () => {
      const entry = await logOwn(memberTech, { declaredMinutes: 240 });

      const res = await adjust(superadmin, entry.id, {
        validatedMinutes: 300,
        justification: JUSTIFICATION,
      }).expect(200);

      expect(res.body).toMatchObject({ declaredMinutes: 240, validatedMinutes: 300 });
    });

    it("answers 400 ADJUSTED_MINUTES_UNCHANGED for the declared minutes, and VALIDATION_FAILED for 0, 1441 and a blank justification", async () => {
      const entry = await logOwn(memberTech, { declaredMinutes: 240 });

      const unchanged = await adjust(coordinator, entry.id, {
        validatedMinutes: 240,
        justification: JUSTIFICATION,
      }).expect(400);
      expect(unchanged.body).toMatchObject({
        error: "ADJUSTED_MINUTES_UNCHANGED",
        details: [
          {
            field: "validatedMinutes",
            message: "validatedMinutes must differ from the declared minutes",
          },
        ],
      });

      for (const [body, field] of [
        [{ validatedMinutes: 0, justification: JUSTIFICATION }, "validatedMinutes"],
        [{ validatedMinutes: 1441, justification: JUSTIFICATION }, "validatedMinutes"],
        [{ validatedMinutes: 120, justification: "   " }, "justification"],
        [{ validatedMinutes: 120 }, "justification"],
      ] as const) {
        const res = await adjust(coordinator, entry.id, body).expect(400);
        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body as { details?: FieldError[] })).toEqual([field]);
      }
      expect((await reviewRowOf(entry.id)).status).toBe("pending");
    });

    it("answers 404 HOUR_ENTRY_NOT_FOUND for an unknown, malformed or removed id, and 409 for a reviewed entry and for the coordinator's own", async () => {
      const removed = await logOwn(memberTech);
      await removeOwn(memberTech, removed.id).expect(204);
      const body = { validatedMinutes: 60, justification: JUSTIFICATION };

      for (const id of [UNKNOWN_ID, "not-a-uuid", removed.id]) {
        const res = await adjust(coordinator, id, body).expect(404);
        expect(res.body).toMatchObject({
          statusCode: 404,
          error: "HOUR_ENTRY_NOT_FOUND",
          message: "Hour entry not found.",
        });
      }

      const reviewed = await logOwn(memberTech);
      await validate(coordinator, [reviewed.id]).expect(200);
      const notPending = await adjust(coordinator, reviewed.id, body).expect(409);
      expect(notPending.body.error).toBe("ENTRY_NOT_PENDING");

      const own = await logOwn(coordinator);
      const self = await adjust(coordinator, own.id, body).expect(409);
      expect(self.body.error).toBe("SELF_REVIEW_NOT_ALLOWED");
      expect((await reviewRowOf(own.id)).status).toBe("pending");
    });

    it("answers 403 FORBIDDEN to a director", async () => {
      const entry = await logOwn(memberTech);

      const res = await adjust(directorTech, entry.id, {
        validatedMinutes: 60,
        justification: JUSTIFICATION,
      }).expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect((await reviewRowOf(entry.id)).status).toBe("pending");
    });
  });

  describe("PATCH /hour-entries/:id/reject", () => {
    it("rejects with the reason: rejected, 0 minutes, out of the bank, the reason in the statement", async () => {
      const entry = await logOwn(memberTech, { declaredMinutes: 240 });
      const events = collectEvents();

      const res = await reject(coordinator, entry.id, { reason: REASON }).expect(200);

      expect(res.body).toMatchObject({
        status: "rejected",
        declaredMinutes: 240,
        validatedMinutes: 0,
        reviewNote: REASON,
        reviewedById: coordinator.id,
      });
      const [inStatement] = await statementOf(memberTech);
      expect(inStatement).toMatchObject({ status: "rejected", reviewNote: REASON });
      const summary = await request(app.getHttpServer())
        .get("/me/hours/summary")
        .set("Cookie", memberTech.cookie)
        .expect(200);
      expect(summary.body.bankMinutes).toBe(0);
      expect(events.map((event) => event.action)).toEqual([AuditableAction.HOUR_ENTRY_REJECTED]);
      expect(JSON.stringify(events[0])).not.toContain(REASON);
    });

    it("requires the reason: 400 VALIDATION_FAILED without it or blank", async () => {
      const entry = await logOwn(memberTech);

      for (const body of [{}, { reason: "  " }, { reason: "a".repeat(501) }]) {
        const res = await reject(coordinator, entry.id, body).expect(400);
        expect(res.body.error).toBe("VALIDATION_FAILED");
        expect(fieldsOf(res.body as { details?: FieldError[] })).toEqual(["reason"]);
      }
      expect((await reviewRowOf(entry.id)).status).toBe("pending");
    });

    it("answers 409 ENTRY_NOT_PENDING and SELF_REVIEW_NOT_ALLOWED like the adjustment", async () => {
      const entry = await logOwn(memberTech);
      await reject(coordinator, entry.id, { reason: REASON }).expect(200);
      const again = await reject(superadmin, entry.id, { reason: REASON }).expect(409);
      expect(again.body.error).toBe("ENTRY_NOT_PENDING");

      const own = await logOwn(superadmin);
      const self = await reject(superadmin, own.id, { reason: REASON }).expect(409);
      expect(self.body.error).toBe("SELF_REVIEW_NOT_ALLOWED");

      const forbidden = await reject(directorComms, own.id, { reason: REASON }).expect(403);
      expect(forbidden.body.error).toBe("FORBIDDEN");
    });
  });
});
