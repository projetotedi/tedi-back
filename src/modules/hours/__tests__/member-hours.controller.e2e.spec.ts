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
import { CourseCategory, CoursesService } from "@modules/catalog/services/courses.service";
import { ClassesService } from "@modules/classes/services/classes.service";
import { LessonsService } from "@modules/lessons/services/lessons.service";
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
import {
  countEntries,
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

process.env.JWT_SECRET = "e2e-member-hours-secret";

const SESSION_COOKIE_NAME = "tedi_session";

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

const FORBIDDEN_SCOPE_BODY = {
  statusCode: 403,
  error: "FORBIDDEN_SCOPE",
  message: "You do not have access to this resource.",
};
const MEMBER_NOT_FOUND_BODY = {
  statusCode: 404,
  error: "MEMBER_NOT_FOUND",
  message: "Member not found.",
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
  return (body.details ?? []).map((detail) => detail.field).sort();
}

interface HourEntryBody {
  id: string;
  personId: string;
  createdById: string;
  origin: string;
  status: string;
  declaredMinutes: number;
  validatedMinutes: number | null;
}

describe("MemberHoursController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonsService: LessonsService;

  let tech: string;
  let comms: string;
  let directorTech: Actor;
  let directorComms: Actor;
  let directorWithoutDepartment: Actor;
  let coordinator: Actor;
  let superadmin: Actor;
  let memberTech: Actor;
  let memberComms: Actor;
  let memberWithoutDepartment: Actor;

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
    coursesService = module.get(CoursesService);
    classesService = module.get(ClassesService);
    lessonsService = module.get(LessonsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE hour_entry_events, hour_entries, lessons, classes, editions,
                      course_lesson_plans, lesson_plan_contents, lesson_plans,
                      course_prerequisites, courses, invites, departments, people
       RESTART IDENTITY CASCADE`,
    );

    tech = await insertDepartment(dataSource, "Tecnologia");
    comms = await insertDepartment(dataSource, "Comunicação");

    directorTech = await createActor("Director Tech", Role.DIRECTOR, tech);
    directorComms = await createActor("Director Comms", Role.DIRECTOR, comms);
    directorWithoutDepartment = await createActor("Director", Role.DIRECTOR, null);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    superadmin = await createActor("Superadmin", Role.SUPERADMIN);
    memberTech = await createActor("Member Tech", Role.MEMBER, tech);
    memberComms = await createActor("Member Comms", Role.MEMBER, comms);
    memberWithoutDepartment = await createActor("Member", Role.MEMBER, null);
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
  ): Promise<Actor> {
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

  /** A person who cannot log in: a registration under review, a rejected one, or no profile. */
  async function createApplicant(
    name: string,
    status: "pending" | "rejected" | null,
  ): Promise<string> {
    const person = await peopleService.save({ name });
    if (status !== null) {
      await insertMemberProfile(dataSource, { personId: person.id, status, departmentId: tech });
    }
    return person.id;
  }

  function logFor(
    memberId: string,
    actor: Actor,
    payload: Record<string, unknown> = hourEntryBody(),
  ) {
    return request(app.getHttpServer())
      .post(`/members/${memberId}/hour-entries`)
      .set("Cookie", actor.cookie)
      .send(payload);
  }

  function statementOf(actor: Actor) {
    return request(app.getHttpServer()).get("/me/hour-entries").set("Cookie", actor.cookie);
  }

  function collectEvents(): AuditableActionEvent[] {
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));
    return events;
  }

  it("lets a director log hours for a member of her own department: 201, on_behalf, created by the director (CA3)", async () => {
    const res = await logFor(memberTech.id, directorTech).expect(201);

    expect(res.body).toMatchObject({
      personId: memberTech.id,
      createdById: directorTech.id,
      origin: "on_behalf",
      status: "pending",
      category: "planning",
      date: "2026-03-10",
      declaredMinutes: 150,
      validatedMinutes: null,
    });
  });

  /** A class and a lesson in it, through the services of the other modules. */
  async function createLesson(): Promise<{ classId: string; lessonId: string }> {
    const course = await coursesService.create(
      {
        name: "Informática Básica",
        description: "Fundamentos do uso do computador.",
        category: CourseCategory.BASIC,
      },
      coordinator.id,
    );
    const schoolClass = await classesService.create(
      {
        courseId: course.id,
        code: "INFO-A",
        editionName: "2026.1",
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        capacity: 15,
      },
      coordinator.id,
    );
    const lesson = await lessonsService.create(
      {
        classId: schoolClass.id,
        title: "Teclado, mouse e janelas",
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
      },
      coordinator.id,
    );
    return { classId: schoolClass.id, lessonId: lesson.id };
  }

  it("links the entry on behalf to a lesson and its class, and the member sees the link in her statement (GUS-172)", async () => {
    const { classId, lessonId } = await createLesson();

    const res = await logFor(memberTech.id, directorTech, hourEntryBody({ lessonId })).expect(201);

    expect(res.body).toMatchObject({ origin: "on_behalf", classId, lessonId });
    const statement = await statementOf(memberTech).expect(200);
    expect(statement.body.data[0]).toMatchObject({ id: res.body.id, classId, lessonId });
  });

  it("checks the scope before the link: a director of another department gets 403, not the error of the link (GUS-172)", async () => {
    const { lessonId } = await createLesson();
    await lessonsService.cancel(lessonId, { reason: "Feriado" }, coordinator.id);

    const res = await logFor(memberTech.id, directorComms, hourEntryBody({ lessonId })).expect(403);

    expect(res.body).toMatchObject({ error: "FORBIDDEN_SCOPE" });
    expect(await countEntries(dataSource)).toBe(0);
  });

  it("answers 403 FORBIDDEN_SCOPE to a director logging for a member of another department, and writes nothing (CA3)", async () => {
    const res = await logFor(memberComms.id, directorTech).expect(403);

    expect(res.body).toMatchObject(FORBIDDEN_SCOPE_BODY);
    expect(await countEntries(dataSource)).toBe(0);
  });

  it("answers 403 FORBIDDEN_SCOPE to a director without department, and to a director for a member without department", async () => {
    const withoutDepartment = await logFor(memberTech.id, directorWithoutDepartment).expect(403);
    expect(withoutDepartment.body).toMatchObject(FORBIDDEN_SCOPE_BODY);

    const toMemberWithoutDepartment = await logFor(memberWithoutDepartment.id, directorTech).expect(
      403,
    );
    expect(toMemberWithoutDepartment.body).toMatchObject(FORBIDDEN_SCOPE_BODY);

    expect(await countEntries(dataSource)).toBe(0);
  });

  it("answers 403 FORBIDDEN to a member: hours.logForOthers is none for the member profile", async () => {
    const otherMemberTech = await createActor("Other Member Tech", Role.MEMBER, tech);

    const res = await logFor(otherMemberTech.id, memberTech).expect(403);

    expect(res.body.error).toBe("FORBIDDEN");
    expect(await countEntries(dataSource)).toBe(0);
  });

  it("lets the coordination and the superadmin log for a member of any department and for one without department", async () => {
    for (const actor of [coordinator, superadmin]) {
      for (const target of [memberTech, memberComms, memberWithoutDepartment, directorComms]) {
        const res = await logFor(target.id, actor).expect(201);

        expect(res.body).toMatchObject({
          personId: target.id,
          createdById: actor.id,
          origin: "on_behalf",
        });
      }
    }
    expect(await countEntries(dataSource)).toBe(8);
  });

  it("records the created event with the director as actor, and the entry shows up as pending in the member's statement", async () => {
    const events = collectEvents();

    const res = await logFor(memberTech.id, directorTech).expect(201);
    const entry = res.body as HourEntryBody;

    const history = await eventsOf(dataSource, entry.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: "created",
      actor_id: directorTech.id,
      from_status: null,
      to_status: "pending",
      to_minutes: 150,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: AuditableAction.HOUR_ENTRY_CREATED,
      actorId: directorTech.id,
      targetId: entry.id,
      after: { personId: memberTech.id, origin: "on_behalf" },
    });

    const statement = await statementOf(memberTech).expect(200);
    expect(statement.body.total).toBe(1);
    expect(statement.body.data[0]).toMatchObject({
      id: entry.id,
      status: "pending",
      origin: "on_behalf",
      createdById: directorTech.id,
    });
    const directorStatement = await statementOf(directorTech).expect(200);
    expect(directorStatement.body.total).toBe(0);
  });

  it("answers 404 MEMBER_NOT_FOUND for a pending registration, a rejected one, a student, a coordinator without member profile, an unknown id and a malformed id", async () => {
    const pending = await createApplicant("Pending", "pending");
    const rejected = await createApplicant("Rejected", "rejected");
    const student = await createApplicant("Student", null);

    for (const id of [pending, rejected, student, coordinator.id, UNKNOWN_ID, "not-a-uuid"]) {
      const res = await logFor(id, superadmin).expect(404);
      expect(res.body).toMatchObject(MEMBER_NOT_FOUND_BODY);
    }
    expect(await countEntries(dataSource)).toBe(0);
  });

  it("answers 404 before 403: a director of another department gets MEMBER_NOT_FOUND for an unknown id", async () => {
    const res = await logFor(UNKNOWN_ID, directorComms).expect(404);

    expect(res.body).toMatchObject(MEMBER_NOT_FOUND_BODY);
  });

  it("answers 400 SELF_ON_BEHALF_NOT_ALLOWED when the director logs for herself through this route", async () => {
    for (const id of [directorTech.id, directorTech.id.toUpperCase()]) {
      const res = await logFor(id, directorTech).expect(400);

      expect(res.body).toMatchObject({
        statusCode: 400,
        error: "SELF_ON_BEHALF_NOT_ALLOWED",
        message: "Log your own hours with POST /me/hour-entries.",
      });
    }
    expect(await countEntries(dataSource)).toBe(0);
  });

  it.each([
    { case: "the category lesson", overrides: { category: "lesson" }, field: "category" },
    { case: "0 minutes", overrides: { declaredMinutes: 0 }, field: "declaredMinutes" },
  ])(
    "answers 400 VALIDATION_FAILED for $case, like the route of the member",
    async ({ overrides, field }) => {
      const res = await logFor(memberTech.id, directorTech, hourEntryBody(overrides)).expect(400);

      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect(fieldsOf(res.body as { details?: FieldError[] })).toEqual([field]);
      expect(await countEntries(dataSource)).toBe(0);
    },
  );

  it("answers 400 HOUR_ENTRY_DATE_IN_FUTURE like the route of the member", async () => {
    const future = await logFor(
      memberTech.id,
      directorTech,
      hourEntryBody({ date: tomorrowInAppTimeZone() }),
    ).expect(400);
    expect(future.body).toMatchObject({
      error: "HOUR_ENTRY_DATE_IN_FUTURE",
      details: [{ field: "date", message: "date must not be after today" }],
    });

    expect(await countEntries(dataSource)).toBe(0);
  });

  it("ignores status, origin and validatedMinutes sent in the body: the entry is on_behalf and pending", async () => {
    const res = await logFor(
      memberTech.id,
      directorTech,
      hourEntryBody({ status: "approved", origin: "manual", validatedMinutes: 150 }),
    ).expect(201);

    expect(res.body).toMatchObject({
      origin: "on_behalf",
      status: "pending",
      validatedMinutes: null,
    });
  });

  it("answers 401 without a session cookie", async () => {
    await request(app.getHttpServer())
      .post(`/members/${memberTech.id}/hour-entries`)
      .send(hourEntryBody())
      .expect(401);

    expect(await countEntries(dataSource)).toBe(0);
  });
});
