/**
 * E2e spec for GET /students/:id (getStudent) — GUS-107 (student record page).
 *
 * CA1: one call brings the personal data, accessibility and registration blocks
 * CA2: `age` is computed and `createdBy` carries the name of who registered the student
 * CA3: a person that is only a member (no student profile) answers 404
 * CA4: an unknown id answers 404 in the ApiErrorDto format
 *
 * Cases of the card:
 *  1. Student registered by Carla Menezes -> createdBy.name "Carla Menezes", emergencyContact filled
 *  2. GET /students/<id of a member without a student profile> -> 404
 *  3. GET /students/<random uuid> -> 404
 */
import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import request from "supertest";
import { DataSource } from "typeorm";
import { AuthModule } from "@modules/auth/auth.module";
import { ageOn, todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
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

process.env.JWT_SECRET = "e2e-student-detail-secret";

// Name of the session cookie set by the auth module (kept local: tests do not import module internals).
const SESSION_COOKIE_NAME = "tedi_session";

const NOT_FOUND_BODY = {
  statusCode: 404,
  error: "STUDENT_NOT_FOUND",
  message: "Student not found.",
};

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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GET /students/:id (e2e)", () => {
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

  /** Registers Maria through the API as `actor` (the director by default) and returns her id. */
  async function registerMaria(actor: Actor = director): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/students")
      .set("Cookie", actor.cookie)
      .send(MARIA)
      .expect(201);
    return (res.body as { id: string }).id;
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  // ---------------------------------------------------------------------------
  // GET /students/:id
  // ---------------------------------------------------------------------------

  describe("GET /students/:id (getStudent)", () => {
    it("returns every block of the record to a member, with createdBy Carla Menezes and the emergency contact", async () => {
      const carla = await createActor("Carla Menezes", Role.DIRECTOR);
      const studentId = await registerMaria(carla);

      const res = await request(app.getHttpServer())
        .get(`/students/${studentId}`)
        .set("Cookie", member.cookie)
        .expect(200);

      // toEqual on the whole body: no createdById, emergencyContactName or archivedById leaks.
      expect(res.body).toEqual({
        id: studentId,
        name: "Maria Silva Santos",
        birthDate: "1958-04-12",
        age: ageOn("1958-04-12", todayInAppTimeZone()),
        phone: "43999990000",
        email: "maria.santos@example.com",
        education: "Ensino fundamental completo",
        hasSmartphone: true,
        hasComputer: false,
        howFoundUs: "Indicação de uma amiga",
        emergencyContact: { name: "Ana Santos", phone: "43988887777" },
        accessibilityNeed: "visual",
        supportResource: "Fonte ampliada",
        classNeeds: "Sentar perto do projetor",
        createdAt: expect.any(String),
        createdBy: { id: carla.id, name: "Carla Menezes" },
        updatedAt: expect.any(String),
        archivedAt: null,
        archiveReason: null,
      });
    });

    it("is readable by member, director and coordinator (students.view)", async () => {
      const studentId = await registerMaria();

      for (const actor of [member, director, coordinator]) {
        const res = await request(app.getHttpServer())
          .get(`/students/${studentId}`)
          .set("Cookie", actor.cookie)
          .expect(200);

        expect(res.body.id).toBe(studentId);
      }
    });

    it("returns 404 STUDENT_NOT_FOUND for a person that is only a member", async () => {
      // The member is a Person but has no StudentProfile.
      const res = await request(app.getHttpServer())
        .get(`/students/${member.id}`)
        .set("Cookie", coordinator.cookie)
        .expect(404);

      expect(res.body).toEqual(NOT_FOUND_BODY);
    });

    it("returns 404 STUDENT_NOT_FOUND in the ApiErrorDto format for a random uuid and for a malformed id", async () => {
      for (const id of [randomUUID(), "not-a-uuid"]) {
        const res = await request(app.getHttpServer())
          .get(`/students/${id}`)
          .set("Cookie", coordinator.cookie)
          .expect(404);

        expect(res.body).toEqual(NOT_FOUND_BODY);
      }
    });

    it("keeps an archived student readable, with archivedAt and archiveReason", async () => {
      const studentId = await registerMaria();
      await request(app.getHttpServer())
        .patch(`/students/${studentId}/archive`)
        .set("Cookie", coordinator.cookie)
        .send({ reason: "Mudou de cidade." })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/students/${studentId}`)
        .set("Cookie", member.cookie)
        .expect(200);

      expect(res.body).toMatchObject({
        id: studentId,
        archivedAt: expect.any(String),
        archiveReason: "Mudou de cidade.",
      });
      expect(res.body).not.toHaveProperty("archivedById");
    });

    it("returns createdBy null when the person who registered the student was soft-deleted", async () => {
      const studentId = await registerMaria();
      await dataSource.query(`UPDATE people SET deleted_at = now() WHERE id = $1`, [director.id]);

      // The session of the deleted director no longer works: the coordinator reads the record.
      const res = await request(app.getHttpServer())
        .get(`/students/${studentId}`)
        .set("Cookie", coordinator.cookie)
        .expect(200);

      expect(res.body.id).toBe(studentId);
      expect(res.body.createdBy).toBeNull();
    });

    it("keeps createdBy when the access of the registering person was disabled", async () => {
      const studentId = await registerMaria();
      await dataSource.query(`UPDATE people SET access_enabled = false WHERE id = $1`, [
        director.id,
      ]);

      const res = await request(app.getHttpServer())
        .get(`/students/${studentId}`)
        .set("Cookie", coordinator.cookie)
        .expect(200);

      expect(res.body.createdBy).toEqual({ id: director.id, name: "Director" });
    });

    it("returns 404 STUDENT_NOT_FOUND when the student's person was soft-deleted", async () => {
      const studentId = await registerMaria();
      await dataSource.query(`UPDATE people SET deleted_at = now() WHERE id = $1`, [studentId]);

      const res = await request(app.getHttpServer())
        .get(`/students/${studentId}`)
        .set("Cookie", coordinator.cookie)
        .expect(404);

      expect(res.body).toEqual(NOT_FOUND_BODY);
    });

    it("returns 404 STUDENT_NOT_FOUND when the student profile was soft-deleted", async () => {
      const studentId = await registerMaria();
      await dataSource.query(
        `UPDATE student_profiles SET deleted_at = now() WHERE person_id = $1`,
        [studentId],
      );

      const res = await request(app.getHttpServer())
        .get(`/students/${studentId}`)
        .set("Cookie", coordinator.cookie)
        .expect(404);

      expect(res.body).toEqual(NOT_FOUND_BODY);
    });

    it("returns 401 without a session cookie", async () => {
      const studentId = await registerMaria();

      await request(app.getHttpServer()).get(`/students/${studentId}`).expect(401);
    });

    it("emits no audit event when reading a student", async () => {
      const studentId = await registerMaria();
      const events = collectEvents();

      await request(app.getHttpServer())
        .get(`/students/${studentId}`)
        .set("Cookie", member.cookie)
        .expect(200);

      expect(events).toHaveLength(0);
    });
  });
});
