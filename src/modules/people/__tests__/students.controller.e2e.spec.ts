/**
 * E2e spec for StudentsController — GUS-105 (students: entity and CRUD).
 *
 * CA1: create without name or birthDate answers 400 with the field
 * CA2: the response carries the computed age
 * CA3: a member gets 403 on every mutation; a director gets 403 on archive and unarchive
 *
 * Cases of the card:
 *  1. POST /students "Maria Silva Santos", 1958-04-12 -> 201
 *  2. POST /students without birthDate -> 400 with the field
 *  3. Born 1958-04-12 -> correct age today
 *  4. A member POSTs -> 403
 */
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
import { ageOn, todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { PeopleModule } from "../people.module";
import { PeopleService } from "../services/people.service";

// ---------------------------------------------------------------------------
// DB configuration
// ---------------------------------------------------------------------------
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

process.env.JWT_SECRET = "e2e-students-secret";

// Name of the session cookie set by the auth module (kept local: tests do not import module internals).
const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

// Personal data that must never travel in an audit event.
const SENSITIVE_VALUES = [
  "43999990000",
  "maria.santos@example.com",
  "Ana Santos",
  "43988887777",
  "visual",
  "Fonte ampliada",
  "Sentar perto do projetor",
];

const MARIA = {
  name: "Maria Silva Santos",
  birthDate: "1958-04-12",
  email: "maria.santos@example.com",
  phone: "(43) 99999-0000",
  education: "Ensino fundamental completo",
  hasSmartphone: true,
  hasComputer: false,
  howFoundUs: "Indicação de uma amiga",
  emergencyContactName: "Ana Santos",
  emergencyContactPhone: "43988887777",
  accessibilityNeed: "visual",
  supportResource: "Fonte ampliada",
  classNeeds: "Sentar perto do projetor",
};

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("StudentsController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;

  let director: Actor;
  let coordinator: Actor;
  let member: Actor;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // No EventEmitterModule.forRoot() here: AuthModule already registers the global one.
        // A second forRoot() creates a second EventEmitter2, and the service would emit on a
        // different instance than the one this test listens to (module.get).
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
    eventEmitter = module.get(EventEmitter2);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query("TRUNCATE TABLE student_profiles, people RESTART IDENTITY CASCADE");

    director = await createActor("Director", Role.DIRECTOR);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    member = await createActor("Member", Role.MEMBER);
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /** Registers Maria through the API as the director and returns the response body. */
  async function createMaria(overrides: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post("/students")
      .set("Cookie", director.cookie)
      .send({ ...MARIA, ...overrides })
      .expect(201);
    return res.body as Record<string, unknown> & { id: string };
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  async function countRows(table: "people" | "student_profiles"): Promise<number> {
    const rows: Array<{ total: string }> = await dataSource.query(
      `SELECT count(*) AS total FROM ${table}`,
    );
    return Number(rows[0].total);
  }

  // ---------------------------------------------------------------------------
  // POST /students
  // ---------------------------------------------------------------------------

  describe("POST /students (createStudent)", () => {
    it("creates Maria Silva Santos born 1958-04-12 and returns 201 StudentResponseDto", async () => {
      const res = await request(app.getHttpServer())
        .post("/students")
        .set("Cookie", director.cookie)
        .send(MARIA)
        .expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        name: "Maria Silva Santos",
        birthDate: "1958-04-12",
        age: expect.any(Number),
        email: "maria.santos@example.com",
        phone: "43999990000",
        education: "Ensino fundamental completo",
        hasSmartphone: true,
        hasComputer: false,
        howFoundUs: "Indicação de uma amiga",
        emergencyContactName: "Ana Santos",
        emergencyContactPhone: "43988887777",
        accessibilityNeed: "visual",
        supportResource: "Fonte ampliada",
        classNeeds: "Sentar perto do projetor",
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: director.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const people: Array<Record<string, string | null>> = await dataSource.query(
        `SELECT name, email, phone, birth_date::text AS birth_date FROM people WHERE id = $1`,
        [res.body.id],
      );
      expect(people).toEqual([
        {
          name: "Maria Silva Santos",
          email: "maria.santos@example.com",
          phone: "43999990000",
          birth_date: "1958-04-12",
        },
      ]);

      const profiles: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT person_id, created_by_id, accessibility_need, archived_at
           FROM student_profiles WHERE person_id = $1`,
        [res.body.id],
      );
      expect(profiles).toEqual([
        {
          person_id: res.body.id,
          created_by_id: director.id,
          accessibility_need: "visual",
          archived_at: null,
        },
      ]);
    });

    it("returns age for today in America/Sao_Paulo", async () => {
      const res = await request(app.getHttpServer())
        .post("/students")
        .set("Cookie", director.cookie)
        .send({ name: "Maria Silva Santos", birthDate: "1958-04-12" })
        .expect(201);

      // Computed from the same calendar day the API uses, not a fixed number.
      expect(res.body.age).toBe(ageOn("1958-04-12", todayInAppTimeZone()));
      expect(res.body.accessibilityNeed).toBe("none");
      expect(res.body.email).toBeNull();
      expect(res.body.phone).toBeNull();
    });

    it("returns 400 VALIDATION_FAILED with field birthDate when birthDate is missing", async () => {
      const res = await request(app.getHttpServer())
        .post("/students")
        .set("Cookie", director.cookie)
        .send({ name: "Maria Silva Santos" })
        .expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(res.body)).toEqual(["birthDate"]);
      expect(await countRows("student_profiles")).toBe(0);
    });

    it("returns 400 VALIDATION_FAILED with field name when name is missing", async () => {
      const res = await request(app.getHttpServer())
        .post("/students")
        .set("Cookie", director.cookie)
        .send({ birthDate: "1958-04-12" })
        .expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(res.body)).toEqual(["name"]);
    });

    it("returns 400 VALIDATION_FAILED with field birthDate when birthDate is in the future", async () => {
      const res = await request(app.getHttpServer())
        .post("/students")
        .set("Cookie", director.cookie)
        .send({ name: "Maria Silva Santos", birthDate: "2999-01-01" })
        .expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(res.body)).toEqual(["birthDate"]);
    });

    it("returns 403 FORBIDDEN for a member and creates nothing", async () => {
      const res = await request(app.getHttpServer())
        .post("/students")
        .set("Cookie", member.cookie)
        .send(MARIA)
        .expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      expect(await countRows("student_profiles")).toBe(0);
      // Only the three actors created by beforeEach.
      expect(await countRows("people")).toBe(3);
    });

    it("returns 401 without a session cookie", async () => {
      await request(app.getHttpServer()).post("/students").send(MARIA).expect(401);
    });

    it("returns 409 EMAIL_ALREADY_IN_USE when the e-mail belongs to another person", async () => {
      await peopleService.save({ name: "Other", email: "maria.santos@example.com" });
      const peopleBefore = await countRows("people");

      const res = await request(app.getHttpServer())
        .post("/students")
        .set("Cookie", director.cookie)
        .send(MARIA)
        .expect(409);

      expect(res.body.error).toBe("EMAIL_ALREADY_IN_USE");
      // The transaction rolled back: no half-created student.
      expect(await countRows("people")).toBe(peopleBefore);
      expect(await countRows("student_profiles")).toBe(0);
    });

    it("emits STUDENT_CREATED without phone, e-mail, emergency contact or accessibility data", async () => {
      const events = collectEvents();

      const created = await createMaria();

      expect(events).toHaveLength(1);
      expect(events[0].action).toBe(AuditableAction.STUDENT_CREATED);
      expect(events[0].actorId).toBe(director.id);
      expect(events[0].targetType).toBe("student");
      expect(events[0].targetId).toBe(created.id);
      expect(events[0].before).toBeNull();
      expect(events[0].after).toEqual({
        name: "Maria Silva Santos",
        birthDate: "1958-04-12",
        education: "Ensino fundamental completo",
        hasSmartphone: true,
        hasComputer: false,
        howFoundUs: "Indicação de uma amiga",
      });

      const serialized = JSON.stringify(events[0]);
      for (const value of SENSITIVE_VALUES) {
        expect(serialized).not.toContain(value);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /students/:id
  // ---------------------------------------------------------------------------

  describe("PATCH /students/:id (updateStudent)", () => {
    it("updates the fields sent and returns 200 for a director", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}`)
        .set("Cookie", director.cookie)
        .send({ phone: "(43) 91111-2222", education: "Ensino médio", accessibilityNeed: "hearing" })
        .expect(200);

      expect(res.body).toMatchObject({
        id: created.id,
        name: "Maria Silva Santos",
        birthDate: "1958-04-12",
        age: ageOn("1958-04-12", todayInAppTimeZone()),
        phone: "43911112222",
        education: "Ensino médio",
        accessibilityNeed: "hearing",
        // Not sent: unchanged.
        email: "maria.santos@example.com",
        supportResource: "Fonte ampliada",
        createdById: director.id,
      });

      const rows: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT p.phone, s.education, s.accessibility_need, s.support_resource
           FROM people p JOIN student_profiles s ON s.person_id = p.id WHERE p.id = $1`,
        [created.id],
      );
      expect(rows).toEqual([
        {
          phone: "43911112222",
          education: "Ensino médio",
          accessibility_need: "hearing",
          support_resource: "Fonte ampliada",
        },
      ]);
    });

    it("clears an optional field sent as null", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}`)
        .set("Cookie", director.cookie)
        .send({ classNeeds: null, hasSmartphone: null, phone: null })
        .expect(200);

      expect(res.body.classNeeds).toBeNull();
      expect(res.body.hasSmartphone).toBeNull();
      expect(res.body.phone).toBeNull();
      expect(res.body.supportResource).toBe("Fonte ampliada");

      const rows: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT p.phone, s.class_needs, s.has_smartphone
           FROM people p JOIN student_profiles s ON s.person_id = p.id WHERE p.id = $1`,
        [created.id],
      );
      expect(rows).toEqual([{ phone: null, class_needs: null, has_smartphone: null }]);
    });

    it("returns 400 when name or birthDate is null", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}`)
        .set("Cookie", director.cookie)
        .send({ name: null, birthDate: null })
        .expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(res.body).sort()).toEqual(["birthDate", "name"]);
    });

    it("returns 409 STUDENT_ARCHIVED for an archived student", async () => {
      const created = await createMaria();
      await request(app.getHttpServer())
        .patch(`/students/${created.id}/archive`)
        .set("Cookie", coordinator.cookie)
        .send({})
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}`)
        .set("Cookie", director.cookie)
        .send({ phone: "43911112222" })
        .expect(409);

      expect(res.body.error).toBe("STUDENT_ARCHIVED");
      const rows: Array<{ phone: string }> = await dataSource.query(
        `SELECT phone FROM people WHERE id = $1`,
        [created.id],
      );
      expect(rows[0].phone).toBe("43999990000");
    });

    it("returns 404 NOT_FOUND for a person without a student profile and for a malformed id", async () => {
      // The member is a Person but has no StudentProfile.
      for (const id of [member.id, UNKNOWN_ID, "not-a-uuid"]) {
        const res = await request(app.getHttpServer())
          .patch(`/students/${id}`)
          .set("Cookie", director.cookie)
          .send({ name: "Outro Nome" })
          .expect(404);

        expect(res.body.error).toBe("NOT_FOUND");
        expect(res.body.message).toBe("Student not found.");
      }
    });

    it("returns 403 FORBIDDEN for a member", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}`)
        .set("Cookie", member.cookie)
        .send({ phone: "43911112222" })
        .expect(403);
      expect(res.body.error).toBe("FORBIDDEN");

      // The guard runs before the validation pipe: an invalid body is still a 403.
      await request(app.getHttpServer())
        .patch(`/students/${created.id}`)
        .set("Cookie", member.cookie)
        .send({ name: null })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /students/:id/archive
  // ---------------------------------------------------------------------------

  describe("PATCH /students/:id/archive (archiveStudent)", () => {
    it("archives with a reason and returns 200 for a coordinator", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}/archive`)
        .set("Cookie", coordinator.cookie)
        .send({ reason: "Mudou de cidade." })
        .expect(200);

      expect(res.body).toMatchObject({
        id: created.id,
        archivedAt: expect.any(String),
        archivedById: coordinator.id,
        archiveReason: "Mudou de cidade.",
      });

      const rows: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT archived_at IS NOT NULL AS archived, archived_by_id, archive_reason
           FROM student_profiles WHERE person_id = $1`,
        [created.id],
      );
      expect(rows).toEqual([
        { archived: true, archived_by_id: coordinator.id, archive_reason: "Mudou de cidade." },
      ]);
    });

    it("archives without a body", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}/archive`)
        .set("Cookie", coordinator.cookie)
        .expect(200);

      expect(res.body.archivedAt).toEqual(expect.any(String));
      expect(res.body.archiveReason).toBeNull();
    });

    it("keeps the first archive when archiving twice", async () => {
      const created = await createMaria();
      const events = collectEvents();

      const first = await request(app.getHttpServer())
        .patch(`/students/${created.id}/archive`)
        .set("Cookie", coordinator.cookie)
        .send({ reason: "first" })
        .expect(200);
      const second = await request(app.getHttpServer())
        .patch(`/students/${created.id}/archive`)
        .set("Cookie", coordinator.cookie)
        .send({ reason: "second" })
        .expect(200);

      expect(second.body.archivedAt).toBe(first.body.archivedAt);
      expect(second.body.archiveReason).toBe("first");
      expect(events.filter((e) => e.action === AuditableAction.STUDENT_ARCHIVED)).toHaveLength(1);
    });

    it("returns 400 when the reason is too long", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}/archive`)
        .set("Cookie", coordinator.cookie)
        .send({ reason: "a".repeat(501) })
        .expect(400);

      expect(fieldsOf(res.body)).toEqual(["reason"]);
    });

    it("returns 404 NOT_FOUND for an unknown student", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/students/${UNKNOWN_ID}/archive`)
        .set("Cookie", coordinator.cookie)
        .send({})
        .expect(404);

      expect(res.body.error).toBe("NOT_FOUND");
    });

    it("returns 403 FORBIDDEN for a director", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}/archive`)
        .set("Cookie", director.cookie)
        .send({})
        .expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
      const rows: Array<{ archived_at: Date | null }> = await dataSource.query(
        `SELECT archived_at FROM student_profiles WHERE person_id = $1`,
        [created.id],
      );
      expect(rows[0].archived_at).toBeNull();
    });

    it("returns 403 FORBIDDEN for a member", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}/archive`)
        .set("Cookie", member.cookie)
        .send({})
        .expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /students/:id/unarchive
  // ---------------------------------------------------------------------------

  describe("PATCH /students/:id/unarchive (unarchiveStudent)", () => {
    it("unarchives and returns 200 for a coordinator", async () => {
      const created = await createMaria();
      await request(app.getHttpServer())
        .patch(`/students/${created.id}/archive`)
        .set("Cookie", coordinator.cookie)
        .send({ reason: "Mudou de cidade." })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}/unarchive`)
        .set("Cookie", coordinator.cookie)
        .expect(200);

      expect(res.body).toMatchObject({
        id: created.id,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });

      const rows: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT archived_at, archived_by_id, archive_reason
           FROM student_profiles WHERE person_id = $1`,
        [created.id],
      );
      expect(rows).toEqual([{ archived_at: null, archived_by_id: null, archive_reason: null }]);

      // Reactivated: editable again.
      await request(app.getHttpServer())
        .patch(`/students/${created.id}`)
        .set("Cookie", director.cookie)
        .send({ education: "Ensino médio" })
        .expect(200);
    });

    it("returns 403 FORBIDDEN for a director", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}/unarchive`)
        .set("Cookie", director.cookie)
        .expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
    });

    it("returns 403 FORBIDDEN for a member", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .patch(`/students/${created.id}/unarchive`)
        .set("Cookie", member.cookie)
        .expect(403);

      expect(res.body.error).toBe("FORBIDDEN");
    });
  });

  // ---------------------------------------------------------------------------
  // Routes and events
  // ---------------------------------------------------------------------------

  describe("routes", () => {
    it("has no DELETE /students/:id route", async () => {
      const created = await createMaria();

      const res = await request(app.getHttpServer())
        .delete(`/students/${created.id}`)
        .set("Cookie", coordinator.cookie)
        .expect(404);

      expect(res.body.error).toBe("NOT_FOUND");
      expect(await countRows("student_profiles")).toBe(1);
    });

    it("emits one event per mutation: STUDENT_CREATED, STUDENT_UPDATED, STUDENT_ARCHIVED, STUDENT_UNARCHIVED", async () => {
      const events = collectEvents();

      const created = await createMaria();
      await request(app.getHttpServer())
        .patch(`/students/${created.id}`)
        .set("Cookie", director.cookie)
        .send({ education: "Ensino médio", phone: "43911112222" })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/students/${created.id}/archive`)
        .set("Cookie", coordinator.cookie)
        .send({ reason: "Mudou de cidade." })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/students/${created.id}/unarchive`)
        .set("Cookie", coordinator.cookie)
        .expect(200);

      expect(events.map((event) => event.action)).toEqual([
        AuditableAction.STUDENT_CREATED,
        AuditableAction.STUDENT_UPDATED,
        AuditableAction.STUDENT_ARCHIVED,
        AuditableAction.STUDENT_UNARCHIVED,
      ]);
      expect(events.map((event) => event.actorId)).toEqual([
        director.id,
        director.id,
        coordinator.id,
        coordinator.id,
      ]);
      expect(events.every((event) => event.targetId === created.id)).toBe(true);
      expect(events[1].before).toEqual({ education: "Ensino fundamental completo" });
      expect(events[1].after).toEqual({
        education: "Ensino médio",
        changedFields: ["phone", "education"],
      });

      for (const event of events) {
        const serialized = JSON.stringify(event);
        for (const value of SENSITIVE_VALUES) {
          expect(serialized).not.toContain(value);
        }
      }
    });
  });
});
