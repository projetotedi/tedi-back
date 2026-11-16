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
import { CatalogModule } from "@modules/catalog/catalog.module";
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
import { ClassesModule } from "../classes.module";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import { EnrollmentCountsService } from "../services/enrollment-counts.service";
import {
  insertClass,
  insertCourse,
  insertEdition,
  insertEnrollment,
  insertStudent,
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

process.env.JWT_SECRET = "e2e-student-archive-blocked-secret";

const SESSION_COOKIE_NAME = "tedi_session";

interface Actor {
  id: string;
  cookie: string;
}

/**
 * "A student with an active enrollment is not archived" (GUS-108, CA7, CT5): `people` asks the
 * enrollments through its port, and `classes` implements it. The flow between the two modules is
 * tested here, in the module that implements the port.
 */
describe("Archive of a student with enrollments (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;

  let director: Actor;
  let coordinator: Actor;
  let classId: string;
  let studentId: string;

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
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    // One server up for the whole suite: the races below keep a request open while others run.
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
      `TRUNCATE TABLE enrollments, classes, editions, course_prerequisites, courses,
                      student_profiles, people RESTART IDENTITY CASCADE`,
    );
    director = await createActor("Director", Role.DIRECTOR);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    const courseId = await insertCourse(dataSource, director.id);
    const editionId = await insertEdition(dataSource, "2026.1");
    classId = await insertClass(dataSource, { courseId, editionId, createdById: director.id });
    studentId = await insertStudent(dataSource, { name: "Maria Silva", createdById: director.id });
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
    jest.restoreAllMocks();
  });

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /** Students are archived by coordination (students.archive). */
  function archiveStudent(id: string) {
    return request(app.getHttpServer())
      .patch(`/students/${id}/archive`)
      .set("Cookie", coordinator.cookie)
      .send({ reason: "Mudou de cidade." });
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  async function storedArchivedAt(id: string): Promise<Date | null> {
    const rows: Array<{ archived_at: Date | null }> = await dataSource.query(
      `SELECT archived_at FROM student_profiles WHERE person_id = $1`,
      [id],
    );
    return rows[0].archived_at;
  }

  /**
   * The text of a statement that is waiting for a lock, or undefined after 3 seconds. A plain
   * SELECT is never blocked by a row lock (MVCC), so a select that waits proves it takes the lock.
   */
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

  it("CT5/CA7: PATCH /students/:id/archive of a student with an active enrollment answers 409 STUDENT_HAS_ACTIVE_ENROLLMENTS, archives nothing and emits no STUDENT_ARCHIVED", async () => {
    await insertEnrollment(dataSource, { classId, studentId, createdById: director.id });
    const events = collectEvents();

    const res = await archiveStudent(studentId).expect(409);

    expect(res.body).toEqual({
      statusCode: 409,
      error: "STUDENT_HAS_ACTIVE_ENROLLMENTS",
      message: "A student with active enrollments cannot be archived.",
    });
    expect(await storedArchivedAt(studentId)).toBeNull();
    expect(events.filter((event) => event.action === AuditableAction.STUDENT_ARCHIVED)).toEqual([]);
  });

  it("archives a student whose enrollments are all dropped or completed", async () => {
    await insertEnrollment(dataSource, {
      classId,
      studentId,
      createdById: director.id,
      status: EnrollmentStatus.DROPPED,
    });
    const otherClassId = await insertClass(dataSource, {
      courseId: await insertCourse(dataSource, director.id, "Smartphones", "intermediate"),
      editionId: await insertEdition(dataSource, "2025.2"),
      createdById: director.id,
    });
    await insertEnrollment(dataSource, {
      classId: otherClassId,
      studentId,
      createdById: director.id,
      status: EnrollmentStatus.COMPLETED,
    });
    // A removed active enrollment does not count either.
    const removedClassId = await insertClass(dataSource, {
      courseId: await insertCourse(dataSource, director.id, "Redes sociais"),
      editionId: await insertEdition(dataSource, "2025.1"),
      createdById: director.id,
    });
    await insertEnrollment(dataSource, {
      classId: removedClassId,
      studentId,
      createdById: director.id,
      deletedAt: new Date("2026-03-10T12:00:00.000Z"),
    });
    const events = collectEvents();

    const res = await archiveStudent(studentId).expect(200);

    expect(res.body.archivedAt).not.toBeNull();
    expect(await storedArchivedAt(studentId)).toBeInstanceOf(Date);
    expect(events.map((event) => event.action)).toEqual([AuditableAction.STUDENT_ARCHIVED]);
  });

  it("keeps the no-op of an archived student without asking the enrollments", async () => {
    const archived = await insertStudent(dataSource, {
      name: "Archived",
      createdById: director.id,
      archivedById: coordinator.id,
    });
    // Forced by SQL: an archived student with an active enrollment is not a state the rules make.
    await insertEnrollment(dataSource, { classId, studentId: archived, createdById: director.id });
    const count = jest.spyOn(module.get(EnrollmentCountsService), "countActiveEnrollments");
    const events = collectEvents();

    await archiveStudent(archived).expect(200);

    expect(count).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("race: the archive of a student waits for an enrollment in progress and answers 409 STUDENT_HAS_ACTIVE_ENROLLMENTS", async () => {
    // An enrollment in flight: the class FOR UPDATE, the profile FOR SHARE, the row not committed.
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      await holder.query(`SELECT id FROM classes WHERE id = $1 FOR UPDATE`, [classId]);
      await holder.query(`SELECT id FROM student_profiles WHERE person_id = $1 FOR SHARE`, [
        studentId,
      ]);
      await holder.query(
        `INSERT INTO enrollments (id, class_id, student_id, status, enrolled_at, status_changed_at, created_by_id)
         VALUES (gen_random_uuid(), $1, $2, 'active', now(), (now() AT TIME ZONE 'America/Sao_Paulo')::date, $3)`,
        [classId, studentId, director.id],
      );

      pending = archiveStudent(studentId).then((res) => res);
      // The archive waits on the lock of the profile, and counts only after the enrollment commits.
      expect(await blockedStatement()).toMatch(/"StudentProfile"/);
    } finally {
      await holder.commitTransaction();
      await holder.release();
    }

    const res = await pending;
    expect(res?.status).toBe(409);
    expect(res?.body.error).toBe("STUDENT_HAS_ACTIVE_ENROLLMENTS");
    expect(await storedArchivedAt(studentId)).toBeNull();
  });
});
