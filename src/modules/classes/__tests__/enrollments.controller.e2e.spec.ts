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
import { Clock } from "@shared/dates/clock";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { ClassesModule } from "../classes.module";
import { ClassStatus } from "../enums/class-status.enum";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import {
  FIRST_ENROLLED_AT,
  insertClass,
  insertCourse,
  insertEdition,
  insertEnrollment,
  insertEnrollments,
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

process.env.JWT_SECRET = "e2e-enrollments-secret";

const SESSION_COOKIE_NAME = "tedi_session";
const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

// The clock of the application: 12:00 in São Paulo on 2026-04-15, so "today" is 2026-04-15. The
// fixture enrolls from 2026-03-03 on, so a change of status from 2026-03-03 to 2026-04-15 is valid.
const NOW = new Date("2026-04-15T15:00:00.000Z");
const TODAY = "2026-04-15";

interface Actor {
  id: string;
  cookie: string;
}

interface FieldError {
  field: string;
  message: string;
}

interface EnrollmentBody {
  id: string;
  classId: string;
  student: { id: string; name: string };
  status: string;
  enrolledAt: string;
  statusChangedAt: string;
  statusReason: string | null;
}

interface EnrollBody {
  enrolled: EnrollmentBody[];
  skipped: Array<{ studentId: string; reason: string; enrollmentId: string; status: string }>;
  warnings: Array<{ studentId: string; code: string; courseId: string; courseName: string }>;
}

function fieldsOf(body: { details?: FieldError[] }): string[] {
  return (body.details ?? []).map((detail) => detail.field);
}

describe("Enrollments (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;

  let director: Actor;
  let coordinator: Actor;
  let member: Actor;
  let basic: string;
  let intermediate: string;
  let editionId: string;
  /** INFO-A of Informática Básica in 2026.1, planned, with 15 seats. */
  let classId: string;

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
    })
      .overrideProvider(Clock)
      .useValue({ now: () => new Date(NOW) })
      .compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(buildValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    // One server up for the whole suite: the races below keep requests open while others run.
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
    member = await createActor("Member", Role.MEMBER);
    basic = await insertCourse(dataSource, director.id, "Informática Básica", "basic");
    intermediate = await insertCourse(
      dataSource,
      director.id,
      "Informática Intermediária",
      "intermediate",
    );
    // Intermediária requires Básica (RF-032).
    await dataSource.query(
      `INSERT INTO course_prerequisites (id, course_id, prerequisite_id)
       VALUES (gen_random_uuid(), $1, $2)`,
      [intermediate, basic],
    );
    editionId = await insertEdition(dataSource, "2026.1");
    classId = await addClass("INFO-A");
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
  });

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  function addClass(
    code: string,
    input: { courseId?: string; capacity?: number; status?: ClassStatus; archived?: boolean } = {},
  ): Promise<string> {
    return insertClass(dataSource, {
      courseId: input.courseId ?? basic,
      editionId,
      createdById: director.id,
      code,
      capacity: input.capacity ?? 15,
      status: input.status,
      archivedById: input.archived === true ? director.id : undefined,
    });
  }

  function student(name: string, input: { phone?: string; archived?: boolean } = {}) {
    return insertStudent(dataSource, {
      name,
      createdById: director.id,
      phone: input.phone,
      archivedById: input.archived === true ? coordinator.id : undefined,
    });
  }

  /** `count` students with an active enrollment in the class, by SQL (scenery, not the rule). */
  function enrollMany(inClassId: string, count: number, status?: EnrollmentStatus) {
    return insertEnrollments(dataSource, {
      classId: inClassId,
      createdById: director.id,
      count,
      status,
    });
  }

  /**
   * One enrollment by SQL, enrolled on 2026-03-03 like the ones of `enrollMany`: before the day of
   * the clock of the application, so a change of status up to today is valid whatever day the
   * database thinks it is.
   */
  function enrollOne(inClassId: string, studentId: string, status?: EnrollmentStatus) {
    return insertEnrollment(dataSource, {
      classId: inClassId,
      studentId,
      createdById: director.id,
      status,
      enrolledAt: FIRST_ENROLLED_AT,
    });
  }

  function postEnrollments(id: string, actor: Actor | null, payload: Record<string, unknown>) {
    const req = request(app.getHttpServer()).post(`/classes/${id}/enrollments`).send(payload);
    return actor === null ? req : req.set("Cookie", actor.cookie);
  }

  function patchEnrollment(id: string, actor: Actor, payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/enrollments/${id}`)
      .set("Cookie", actor.cookie)
      .send(payload);
  }

  function deleteEnrollment(id: string, actor: Actor) {
    return request(app.getHttpServer()).delete(`/enrollments/${id}`).set("Cookie", actor.cookie);
  }

  function getClass(id: string) {
    return request(app.getHttpServer()).get(`/classes/${id}`).set("Cookie", director.cookie);
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  async function countActive(inClassId: string): Promise<number> {
    const rows: Array<{ total: number }> = await dataSource.query(
      `SELECT COUNT(*)::int AS total FROM enrollments
        WHERE class_id = $1 AND status = 'active' AND deleted_at IS NULL`,
      [inClassId],
    );
    return rows[0].total;
  }

  async function countRows(): Promise<number> {
    const rows: Array<{ total: number }> = await dataSource.query(
      `SELECT COUNT(*)::int AS total FROM enrollments`,
    );
    return rows[0].total;
  }

  /** The row as the table has it, with the date as text so no time zone gets in the way. */
  async function storedEnrollment(id: string): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT class_id, student_id, status, enrolled_at, status_changed_at::text AS status_changed_at,
              status_reason, created_by_id, created_at, updated_at, deleted_at
         FROM enrollments WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  async function enrollmentOf(inClassId: string, studentId: string): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM enrollments WHERE class_id = $1 AND student_id = $2 AND deleted_at IS NULL`,
      [inClassId, studentId],
    );
    return rows[0].id;
  }

  /**
   * Waits until `count` statements are waiting for a lock (3 seconds at most) and answers how many
   * were seen. A plain SELECT is never blocked by a row lock (MVCC), so a statement that waits
   * proves it asks for the lock.
   */
  async function blockedStatements(count = 1): Promise<string[]> {
    let rows: Array<{ query: string }> = [];
    for (let attempt = 0; attempt < 60; attempt++) {
      rows = await dataSource.query(
        `SELECT query FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (rows.length >= count) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return rows.map((row) => row.query);
  }

  /**
   * Holds the row of a table in a transaction of its own, with the lock that is asked, as a
   * concurrent write would. `run` runs a statement inside that transaction; `release` commits it.
   */
  async function holdRow(table: "classes" | "student_profiles", column: string, id: string) {
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(`SELECT id FROM ${table} WHERE ${column} = $1 FOR UPDATE`, [id]);

    return {
      run: (sql: string, parameters: unknown[]) => holder.query(sql, parameters),
      release: async () => {
        await holder.commitTransaction();
        await holder.release();
      },
    };
  }

  // ---------------------------------------------------------------------------
  // POST /classes/:id/enrollments
  // ---------------------------------------------------------------------------

  describe("POST /classes/:id/enrollments (enrollStudents)", () => {
    it("CT1: INFO-A with 15 seats and 12 active enrolls 3 (201, 3 in enrolled); one more answers 409 CLASS_FULL with 0 seats left", async () => {
      await enrollMany(classId, 12);
      const [ana, bruno, carla, davi] = [
        await student("Ana Souza"),
        await student("Bruno Lima"),
        await student("Carla Dias"),
        await student("Davi Rocha"),
      ];

      const res = await postEnrollments(classId, director, {
        studentIds: [ana, bruno, carla],
      }).expect(201);
      const body = res.body as EnrollBody;
      expect(body.enrolled.map((item) => item.student.id)).toEqual([ana, bruno, carla]);
      expect(body.skipped).toEqual([]);
      expect(body.warnings).toEqual([]);
      expect(body.enrolled[0]).toEqual({
        id: expect.any(String),
        classId,
        student: { id: ana, name: "Ana Souza" },
        status: "active",
        enrolledAt: NOW.toISOString(),
        statusChangedAt: TODAY,
        statusReason: null,
      });

      const full = await postEnrollments(classId, director, { studentIds: [davi] }).expect(409);
      expect(full.body).toEqual({
        statusCode: 409,
        error: "CLASS_FULL",
        message: "The class has 0 seats left and 1 students were asked.",
        details: [{ field: "studentIds", message: "0" }],
      });
      expect(await countActive(classId)).toBe(15);
    });

    it("CA1: enrolling 3 students in a class with 2 seats left answers 409 CLASS_FULL and writes none of them", async () => {
      await enrollMany(classId, 13);
      const ids = [await student("Ana"), await student("Bruno"), await student("Carla")];
      const events = collectEvents();

      const res = await postEnrollments(classId, director, { studentIds: ids }).expect(409);

      expect(res.body.error).toBe("CLASS_FULL");
      expect(res.body.message).toBe("The class has 2 seats left and 3 students were asked.");
      expect(res.body.details).toEqual([{ field: "studentIds", message: "2" }]);
      expect(await countRows()).toBe(13);
      expect(events).toEqual([]);
    });

    it("CA2: a student already enrolled comes in skipped with its enrollment and status, and the others are enrolled", async () => {
      const ana = await student("Ana Souza");
      const bruno = await student("Bruno Lima");
      const first = await postEnrollments(classId, director, { studentIds: [ana] }).expect(201);
      const anaEnrollment = (first.body as EnrollBody).enrolled[0].id;

      const res = await postEnrollments(classId, director, { studentIds: [ana, bruno] }).expect(
        201,
      );
      const body = res.body as EnrollBody;

      expect(body.skipped).toEqual([
        {
          studentId: ana,
          reason: "ALREADY_ENROLLED",
          enrollmentId: anaEnrollment,
          status: "active",
        },
      ]);
      expect(body.enrolled.map((item) => item.student.id)).toEqual([bruno]);
      expect(await countActive(classId)).toBe(2);
    });

    it("skips a dropped student of the class instead of enrolling her again", async () => {
      const ana = await student("Ana Souza");
      const dropped = await enrollOne(classId, ana, EnrollmentStatus.DROPPED);
      const events = collectEvents();

      const res = await postEnrollments(classId, director, { studentIds: [ana] }).expect(201);

      expect(res.body).toEqual({
        enrolled: [],
        skipped: [
          { studentId: ana, reason: "ALREADY_ENROLLED", enrollmentId: dropped, status: "dropped" },
        ],
        warnings: [],
      });
      expect(await countRows()).toBe(1);
      expect(events).toEqual([]);
    });

    it("CT2/CA3: a student who did not complete Básica enrolls in an Intermediária class with warnings PREREQUISITE_NOT_COMPLETED", async () => {
      const intermediateClass = await addClass("INT-A", { courseId: intermediate });
      const ana = await student("Ana Souza");

      const res = await postEnrollments(intermediateClass, director, { studentIds: [ana] }).expect(
        201,
      );
      const body = res.body as EnrollBody;

      expect(body.enrolled.map((item) => item.student.id)).toEqual([ana]);
      expect(body.warnings).toEqual([
        {
          studentId: ana,
          code: "PREREQUISITE_NOT_COMPLETED",
          courseId: basic,
          courseName: "Informática Básica",
        },
      ]);
      expect(await countActive(intermediateClass)).toBe(1);
    });

    it("does not warn a student whose enrollment in a Básica class is completed", async () => {
      const intermediateClass = await addClass("INT-A", { courseId: intermediate });
      const bruno = await student("Bruno Lima");
      // Básica completed in a class of another edition, archived since: it still counts (RN-16).
      const oldClass = await insertClass(dataSource, {
        courseId: basic,
        editionId: await insertEdition(dataSource, "2025.2"),
        createdById: director.id,
        status: ClassStatus.COMPLETED,
        archivedById: director.id,
      });
      await enrollOne(oldClass, bruno, EnrollmentStatus.COMPLETED);

      const res = await postEnrollments(intermediateClass, director, {
        studentIds: [bruno],
      }).expect(201);

      expect((res.body as EnrollBody).warnings).toEqual([]);
      expect((res.body as EnrollBody).enrolled).toHaveLength(1);
    });

    it("answers 409 CLASS_ARCHIVED, 409 CLASS_CLOSED, 400 STUDENT_NOT_FOUND, 409 STUDENT_ARCHIVED and 400 DUPLICATE_STUDENT, writing nothing", async () => {
      const ana = await student("Ana Souza");
      const archivedStudent = await student("Arquivada", { archived: true });
      const archivedClass = await addClass("OLD-A", { archived: true });
      const completedClass = await addClass("DONE-A", { status: ClassStatus.COMPLETED });
      const cancelledClass = await addClass("CANC-A", { status: ClassStatus.CANCELLED });
      const events = collectEvents();

      const archived = await postEnrollments(archivedClass, director, {
        studentIds: [ana],
      }).expect(409);
      expect(archived.body.error).toBe("CLASS_ARCHIVED");

      for (const closed of [completedClass, cancelledClass]) {
        const res = await postEnrollments(closed, director, { studentIds: [ana] }).expect(409);
        expect(res.body.error).toBe("CLASS_CLOSED");
      }

      // A member (a person without a student profile) and an unknown id are not students.
      const notFound = await postEnrollments(classId, director, {
        studentIds: [ana, member.id, UNKNOWN_ID],
      }).expect(400);
      expect(notFound.body.error).toBe("STUDENT_NOT_FOUND");
      expect(fieldsOf(notFound.body)).toEqual(["studentIds.1", "studentIds.2"]);

      const archivedOne = await postEnrollments(classId, director, {
        studentIds: [ana, archivedStudent],
      }).expect(409);
      expect(archivedOne.body.error).toBe("STUDENT_ARCHIVED");
      expect(fieldsOf(archivedOne.body)).toEqual(["studentIds.1"]);

      const duplicate = await postEnrollments(classId, director, {
        studentIds: [ana, ana.toUpperCase()],
      }).expect(400);
      expect(duplicate.body.error).toBe("DUPLICATE_STUDENT");
      expect(fieldsOf(duplicate.body)).toEqual(["studentIds.1"]);

      expect(await countRows()).toBe(0);
      expect(events).toEqual([]);
    });

    it("answers the errors in the order class archived, class closed, student not found, student archived, class full", async () => {
      const badClass = await addClass("BAD-A", {
        capacity: 1,
        status: ClassStatus.COMPLETED,
        archived: true,
      });
      await enrollMany(badClass, 1);
      const ana = await student("Ana Souza");
      const archivedStudent = await student("Arquivada", { archived: true });
      const body = { studentIds: [UNKNOWN_ID, archivedStudent, ana] };

      const first = await postEnrollments(badClass, director, body).expect(409);
      expect(first.body.error).toBe("CLASS_ARCHIVED");

      await dataSource.query(
        `UPDATE classes SET archived_at = NULL, archived_by_id = NULL WHERE id = $1`,
        [badClass],
      );
      const second = await postEnrollments(badClass, director, body).expect(409);
      expect(second.body.error).toBe("CLASS_CLOSED");

      await dataSource.query(`UPDATE classes SET status = 'planned' WHERE id = $1`, [badClass]);
      const third = await postEnrollments(badClass, director, body).expect(400);
      expect(third.body.error).toBe("STUDENT_NOT_FOUND");

      const fourth = await postEnrollments(badClass, director, {
        studentIds: [archivedStudent, ana],
      }).expect(409);
      expect(fourth.body.error).toBe("STUDENT_ARCHIVED");

      const fifth = await postEnrollments(badClass, director, { studentIds: [ana] }).expect(409);
      expect(fifth.body.error).toBe("CLASS_FULL");
      expect(await countActive(badClass)).toBe(1);
    });

    it("answers 404 CLASS_NOT_FOUND for an unknown or malformed class id and 400 VALIDATION_FAILED for an empty or 101-id body", async () => {
      const ana = await student("Ana Souza");

      for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
        const res = await postEnrollments(id, director, { studentIds: [ana] }).expect(404);
        expect(res.body).toEqual({
          statusCode: 404,
          error: "CLASS_NOT_FOUND",
          message: "Class not found.",
        });
      }

      const tooMany = Array.from(
        { length: 101 },
        (_, index) => `01999a3e-7c1b-7000-8000-${String(index).padStart(12, "0")}`,
      );
      for (const studentIds of [[], tooMany, ["not-a-uuid"]]) {
        const res = await postEnrollments(classId, director, { studentIds }).expect(400);
        expect(res.body.error).toBe("VALIDATION_FAILED");
      }
      await postEnrollments(classId, director, {}).expect(400);
      expect(await countRows()).toBe(0);
    });

    it("lets a director and a coordinator enroll; a member gets 403 FORBIDDEN and no cookie 401", async () => {
      const ana = await student("Ana Souza");
      const bruno = await student("Bruno Lima");

      await postEnrollments(classId, director, { studentIds: [ana] }).expect(201);
      await postEnrollments(classId, coordinator, { studentIds: [bruno] }).expect(201);

      const forbidden = await postEnrollments(classId, member, {
        studentIds: [await student("Carla")],
      }).expect(403);
      expect(forbidden.body.error).toBe("FORBIDDEN");
      await postEnrollments(classId, null, { studentIds: [ana] }).expect(401);
      expect(await countRows()).toBe(2);
    });

    it("emits one ENROLLMENT_CREATED per enrollment after the commit, without personal data", async () => {
      const ana = await student("Ana Souza", { phone: "43999990000" });
      const bruno = await student("Bruno Lima", { phone: "43988887777" });
      const events = collectEvents();

      const res = await postEnrollments(classId, director, { studentIds: [ana, bruno] }).expect(
        201,
      );
      const body = res.body as EnrollBody;

      expect(events.map((event) => [event.action, event.targetType, event.targetId])).toEqual([
        [AuditableAction.ENROLLMENT_CREATED, "enrollment", body.enrolled[0].id],
        [AuditableAction.ENROLLMENT_CREATED, "enrollment", body.enrolled[1].id],
      ]);
      expect(events[0].actorId).toBe(director.id);
      expect(events[0].before).toBeNull();
      expect(events[0].after).toEqual({
        classId,
        studentId: ana,
        status: "active",
        enrolledAt: NOW,
        statusChangedAt: TODAY,
        missingPrerequisiteIds: [],
      });
      const serialized = JSON.stringify(events);
      for (const personal of ["Ana Souza", "Bruno Lima", "43999990000", "43988887777"]) {
        expect(serialized).not.toContain(personal);
      }
    });

    it("race: two lots fighting for the last seat end with one 201 and one 409 CLASS_FULL, and the class is full, not over", async () => {
      const lastSeat = await addClass("LAST-A", { capacity: 13 });
      await enrollMany(lastSeat, 12);
      const carla = await student("Carla Dias");
      const davi = await student("Davi Rocha");

      // Another write of the class holds it FOR UPDATE: both lots wait on the same lock.
      const holder = await holdRow("classes", "id", lastSeat);
      let lots: Array<Promise<request.Response>> = [];
      try {
        lots = [
          postEnrollments(lastSeat, director, { studentIds: [carla] }).then((res) => res),
          postEnrollments(lastSeat, coordinator, { studentIds: [davi] }).then((res) => res),
        ];
        const waiting = await blockedStatements(2);
        expect(waiting).toHaveLength(2);
        for (const statement of waiting) expect(statement).toMatch(/"SchoolClass"/);
      } finally {
        await holder.release();
      }

      const answers = await Promise.all(lots);
      expect(answers.map((res) => res.status).sort()).toEqual([201, 409]);
      const refused = answers.find((res) => res.status === 409);
      expect(refused?.body.error).toBe("CLASS_FULL");
      expect(refused?.body.details).toEqual([{ field: "studentIds", message: "0" }]);
      expect(await countActive(lastSeat)).toBe(13);
    });

    it("race: an enrollment waits for the archive of the class in progress and answers 409 CLASS_ARCHIVED", async () => {
      const ana = await student("Ana Souza");
      const archive = await holdRow("classes", "id", classId);

      let pending: Promise<request.Response> | undefined;
      try {
        pending = postEnrollments(classId, director, { studentIds: [ana] }).then((res) => res);
        expect(await blockedStatements(1)).toEqual([expect.stringMatching(/"SchoolClass"/)]);
        await archive.run(
          `UPDATE classes SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
          [classId, director.id],
        );
      } finally {
        await archive.release();
      }

      const res = await pending;
      expect(res?.status).toBe(409);
      expect(res?.body.error).toBe("CLASS_ARCHIVED");
      expect(await countRows()).toBe(0);
    });

    it("race: the archive of the class waits for an enrollment in progress and answers 409 CLASS_HAS_ACTIVE_ENROLLMENTS", async () => {
      const ana = await student("Ana Souza");
      // An enrollment in flight: the class FOR UPDATE and the new row, not committed yet.
      const enrollment = await holdRow("classes", "id", classId);

      let pending: Promise<request.Response> | undefined;
      try {
        await enrollment.run(
          `INSERT INTO enrollments (id, class_id, student_id, status, enrolled_at, status_changed_at, created_by_id)
           VALUES (gen_random_uuid(), $1, $2, 'active', now(), (now() AT TIME ZONE 'America/Sao_Paulo')::date, $3)`,
          [classId, ana, director.id],
        );
        pending = request(app.getHttpServer())
          .patch(`/classes/${classId}/archive`)
          .set("Cookie", director.cookie)
          .send({})
          .then((res) => res);
        expect(await blockedStatements(1)).toEqual([expect.stringMatching(/"SchoolClass"/)]);
      } finally {
        await enrollment.release();
      }

      const res = await pending;
      expect(res?.status).toBe(409);
      expect(res?.body.error).toBe("CLASS_HAS_ACTIVE_ENROLLMENTS");
      const rows: Array<{ archived_at: Date | null }> = await dataSource.query(
        `SELECT archived_at FROM classes WHERE id = $1`,
        [classId],
      );
      expect(rows[0].archived_at).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /enrollments/:id
  // ---------------------------------------------------------------------------

  describe("PATCH /enrollments/:id (updateEnrollmentStatus)", () => {
    it("CT3/CA6: dropping an active enrollment lowers enrolledCount by 1 and frees the seat for a new enrollment", async () => {
      const small = await addClass("SMALL-A", { capacity: 2 });
      const [first] = await enrollMany(small, 2);
      const newcomer = await student("Nova");
      await postEnrollments(small, director, { studentIds: [newcomer] }).expect(409);

      await patchEnrollment(await enrollmentOf(small, first), director, {
        status: "dropped",
        effectiveDate: "2026-04-10",
      }).expect(200);

      const sheet = await getClass(small).expect(200);
      expect(sheet.body.summary.enrolledCount).toBe(1);
      expect(sheet.body.enrollmentsTotal).toBe(1);
      await postEnrollments(small, director, { studentIds: [newcomer] }).expect(201);
      expect(await countActive(small)).toBe(2);
    });

    it("stores statusChangedAt = effectiveDate and the trimmed reason, and answers them", async () => {
      const ana = await student("Ana Souza");
      const enrollmentId = await enrollOne(classId, ana);

      const res = await patchEnrollment(enrollmentId, director, {
        status: "dropped",
        effectiveDate: "2026-04-10",
        reason: "  Mudou de cidade.  ",
      }).expect(200);

      expect(res.body).toEqual({
        id: enrollmentId,
        classId,
        student: { id: ana, name: "Ana Souza" },
        status: "dropped",
        enrolledAt: expect.any(String),
        statusChangedAt: "2026-04-10",
        statusReason: "Mudou de cidade.",
      });
      expect(await storedEnrollment(enrollmentId)).toMatchObject({
        status: "dropped",
        status_changed_at: "2026-04-10",
        status_reason: "Mudou de cidade.",
        updated_at: NOW,
      });
    });

    it("reactivates a dropped student with a seat, and answers 409 CLASS_FULL in a full class", async () => {
      const small = await addClass("SMALL-A", { capacity: 2 });
      await enrollMany(small, 1);
      const ana = await enrollOne(small, await student("Ana"), EnrollmentStatus.DROPPED);
      const carla = await enrollOne(small, await student("Carla"), EnrollmentStatus.DROPPED);

      const back = await patchEnrollment(ana, director, {
        status: "active",
        effectiveDate: TODAY,
      }).expect(200);
      expect(back.body.status).toBe("active");
      expect(back.body.statusChangedAt).toBe(TODAY);

      const full = await patchEnrollment(carla, director, {
        status: "active",
        effectiveDate: TODAY,
      }).expect(409);
      expect(full.body).toEqual({
        statusCode: 409,
        error: "CLASS_FULL",
        message: "The class has 0 seats left and 1 students were asked.",
        details: [{ field: "status", message: "0" }],
      });
      expect(await storedEnrollment(carla)).toMatchObject({ status: "dropped" });
      expect(await countActive(small)).toBe(2);
    });

    it("answers 409 CLASS_CLOSED when reactivating in a completed class, and lets it close out its enrollments as completed", async () => {
      const done = await addClass("DONE-A", { status: ClassStatus.COMPLETED });
      const active = await enrollOne(done, await student("Ana"));
      const dropped = await enrollOne(done, await student("Bruno"), EnrollmentStatus.DROPPED);

      const closed = await patchEnrollment(dropped, director, {
        status: "active",
        effectiveDate: TODAY,
      }).expect(409);
      expect(closed.body.error).toBe("CLASS_CLOSED");

      const completed = await patchEnrollment(active, director, {
        status: "completed",
        effectiveDate: TODAY,
      }).expect(200);
      expect(completed.body.status).toBe("completed");
    });

    it("answers 409 STUDENT_ARCHIVED when reactivating the enrollment of an archived student", async () => {
      const archived = await student("Arquivada", { archived: true });
      const enrollmentId = await enrollOne(classId, archived, EnrollmentStatus.DROPPED);

      const res = await patchEnrollment(enrollmentId, director, {
        status: "active",
        effectiveDate: TODAY,
      }).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        error: "STUDENT_ARCHIVED",
        message: "Archived students cannot be enrolled.",
      });
    });

    it("answers 400 EFFECTIVE_DATE_IN_FUTURE and 400 EFFECTIVE_DATE_BEFORE_ENROLLMENT, with details on effectiveDate", async () => {
      // Enrolled on 2026-03-03 (São Paulo); the clock says today is 2026-04-15.
      const [ana] = await enrollMany(classId, 1);
      const enrollmentId = await enrollmentOf(classId, ana);

      const future = await patchEnrollment(enrollmentId, director, {
        status: "dropped",
        effectiveDate: "2026-04-16",
      }).expect(400);
      expect(future.body.error).toBe("EFFECTIVE_DATE_IN_FUTURE");
      expect(future.body.details).toEqual([
        { field: "effectiveDate", message: "must not be after today" },
      ]);

      const before = await patchEnrollment(enrollmentId, director, {
        status: "dropped",
        effectiveDate: "2026-03-02",
      }).expect(400);
      expect(before.body.error).toBe("EFFECTIVE_DATE_BEFORE_ENROLLMENT");
      expect(fieldsOf(before.body)).toEqual(["effectiveDate"]);
      expect(await storedEnrollment(enrollmentId)).toMatchObject({ status: "active" });

      // Both ends are included.
      await patchEnrollment(enrollmentId, director, {
        status: "dropped",
        effectiveDate: "2026-03-03",
      }).expect(200);
      await patchEnrollment(enrollmentId, director, {
        status: "completed",
        effectiveDate: TODAY,
      }).expect(200);
    });

    it("is a no-op for the same status: 200, nothing written, no event", async () => {
      const enrollmentId = await enrollOne(classId, await student("Ana"));
      const before = await storedEnrollment(enrollmentId);
      const events = collectEvents();

      const res = await patchEnrollment(enrollmentId, director, {
        status: "active",
        effectiveDate: TODAY,
        reason: "Outro motivo.",
      }).expect(200);

      expect(res.body.statusReason).toBeNull();
      expect(res.body.statusChangedAt).toBe(before.status_changed_at);
      expect(await storedEnrollment(enrollmentId)).toEqual(before);
      expect(events).toEqual([]);
    });

    it("answers 409 CLASS_ARCHIVED for an enrollment of an archived class", async () => {
      const enrollmentId = await enrollOne(classId, await student("Ana"));
      await dataSource.query(
        `UPDATE classes SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
        [classId, director.id],
      );

      const res = await patchEnrollment(enrollmentId, director, {
        status: "dropped",
        effectiveDate: TODAY,
      }).expect(409);

      expect(res.body.error).toBe("CLASS_ARCHIVED");
      expect(await storedEnrollment(enrollmentId)).toMatchObject({ status: "active" });
    });

    it("answers 404 ENROLLMENT_NOT_FOUND for an unknown, malformed or removed id", async () => {
      const removed = await insertEnrollment(dataSource, {
        classId,
        studentId: await student("Ana"),
        createdById: director.id,
        deletedAt: new Date("2026-04-01T12:00:00.000Z"),
      });

      for (const id of [UNKNOWN_ID, "not-a-uuid", removed]) {
        const res = await patchEnrollment(id, director, {
          status: "dropped",
          effectiveDate: TODAY,
        }).expect(404);
        expect(res.body).toEqual({
          statusCode: 404,
          error: "ENROLLMENT_NOT_FOUND",
          message: "Enrollment not found.",
        });
      }
    });

    it("emits ENROLLMENT_STATUS_CHANGED without the reason", async () => {
      const ana = await student("Ana Souza");
      const enrollmentId = await enrollOne(classId, ana);
      const events = collectEvents();

      await patchEnrollment(enrollmentId, coordinator, {
        status: "dropped",
        effectiveDate: "2026-04-10",
        reason: "Problema de saúde.",
      }).expect(200);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: AuditableAction.ENROLLMENT_STATUS_CHANGED,
        actorId: coordinator.id,
        targetType: "enrollment",
        targetId: enrollmentId,
        before: { status: "active", statusChangedAt: expect.any(String) },
        after: {
          status: "dropped",
          statusChangedAt: "2026-04-10",
          changedFields: ["status", "statusChangedAt", "statusReason"],
        },
      });
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain("Problema de saúde.");
      expect(serialized).not.toContain("Ana Souza");
    });

    it("lets a director change it; a member gets 403 FORBIDDEN", async () => {
      const enrollmentId = await enrollOne(classId, await student("Ana"));

      const forbidden = await patchEnrollment(enrollmentId, member, {
        status: "dropped",
        effectiveDate: TODAY,
      }).expect(403);
      expect(forbidden.body.error).toBe("FORBIDDEN");
      expect(await storedEnrollment(enrollmentId)).toMatchObject({ status: "active" });

      await patchEnrollment(enrollmentId, director, {
        status: "dropped",
        effectiveDate: TODAY,
      }).expect(200);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /enrollments/:id
  // ---------------------------------------------------------------------------

  describe("DELETE /enrollments/:id (removeEnrollment)", () => {
    it("removes an active enrollment (204): it leaves enrolledCount and the list, the row stays with deleted_at, and the student can be enrolled again", async () => {
      const ana = await student("Ana Souza");
      const created = await postEnrollments(classId, director, { studentIds: [ana] }).expect(201);
      const enrollmentId = (created.body as EnrollBody).enrolled[0].id;

      const res = await deleteEnrollment(enrollmentId, director).expect(204);
      expect(res.body).toEqual({});

      const sheet = await getClass(classId).expect(200);
      expect(sheet.body.summary.enrolledCount).toBe(0);
      expect(sheet.body.enrollmentsPreview).toEqual([]);
      expect(await storedEnrollment(enrollmentId)).toMatchObject({
        status: "active",
        deleted_at: NOW,
        updated_at: NOW,
      });

      const again = await postEnrollments(classId, director, { studentIds: [ana] }).expect(201);
      expect((again.body as EnrollBody).enrolled[0].id).not.toBe(enrollmentId);
      expect(await countRows()).toBe(2);
    });

    it("answers 409 ENROLLMENT_NOT_REMOVABLE for a dropped or completed enrollment", async () => {
      for (const status of [EnrollmentStatus.DROPPED, EnrollmentStatus.COMPLETED]) {
        const enrollmentId = await enrollOne(classId, await student(`Aluna ${status}`), status);

        const res = await deleteEnrollment(enrollmentId, director).expect(409);

        expect(res.body).toEqual({
          statusCode: 409,
          error: "ENROLLMENT_NOT_REMOVABLE",
          message:
            "Only an active enrollment can be removed; use the status change for the others.",
        });
        expect(await storedEnrollment(enrollmentId)).toMatchObject({ deleted_at: null });
      }
    });

    it("answers 409 CLASS_ARCHIVED for an enrollment of an archived class", async () => {
      const enrollmentId = await enrollOne(classId, await student("Ana"));
      await dataSource.query(
        `UPDATE classes SET archived_at = now(), archived_by_id = $2 WHERE id = $1`,
        [classId, director.id],
      );

      const res = await deleteEnrollment(enrollmentId, director).expect(409);

      expect(res.body.error).toBe("CLASS_ARCHIVED");
      expect(await storedEnrollment(enrollmentId)).toMatchObject({ deleted_at: null });
    });

    it("answers 404 ENROLLMENT_NOT_FOUND the second time", async () => {
      const enrollmentId = await enrollOne(classId, await student("Ana"));

      await deleteEnrollment(enrollmentId, director).expect(204);
      const again = await deleteEnrollment(enrollmentId, director).expect(404);

      expect(again.body.error).toBe("ENROLLMENT_NOT_FOUND");
      await deleteEnrollment("not-a-uuid", director).expect(404);
    });

    it("emits ENROLLMENT_REMOVED; a member gets 403 FORBIDDEN", async () => {
      const ana = await student("Ana Souza");
      const enrollmentId = await enrollOne(classId, ana);
      const events = collectEvents();

      const forbidden = await deleteEnrollment(enrollmentId, member).expect(403);
      expect(forbidden.body.error).toBe("FORBIDDEN");
      expect(events).toEqual([]);

      await deleteEnrollment(enrollmentId, director).expect(204);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: AuditableAction.ENROLLMENT_REMOVED,
        actorId: director.id,
        targetType: "enrollment",
        targetId: enrollmentId,
        before: { classId, studentId: ana, status: "active" },
        after: { deletedAt: NOW },
      });
    });
  });
});
