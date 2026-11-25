/**
 * E2e spec for PATCH /members/:id (updateMember) — GUS-146.
 *
 * CA1: coordination edits any member; a director only the members of the own department; a member
 *      gets 403
 * CA2: a repeated RA or e-mail answers 409 with the field
 * CA3: the route changes neither role nor accessEnabled
 *
 * The members come from the real flow (POST /invites → POST /auth/invites/accept →
 * PATCH /member-registrations/:id/approve). Sessions are cookies signed with the JwtService (no
 * login), so the login throttler is not involved. No seedAdmin: it writes the ADMIN_* variables,
 * which would leak into the other files of the serial e2e run. Fictitious data: 111.444.777-35 is
 * the public example of a valid CPF.
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
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
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
import {
  buildRegistration,
  insertDepartment,
  insertMemberProfile,
  REGISTRATION_SENSITIVE_VALUES,
} from "./fixtures/member-registration.fixture";

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

process.env.JWT_SECRET = "e2e-member-update-secret";
process.env.APP_URL = "http://localhost:5173";

const SESSION_COOKIE_NAME = "tedi_session";

const PASSWORD = "Senha@123";
const MAIN_FUNCTION = "Monitora de informática";
const JOINED_AT = "2025-03-01";
const NEW_CPF = "111.444.777-35";
const NEW_CPF_DIGITS = "11144477735";

const FULL_EDIT = {
  name: "Ana T. Souza",
  ra: "A2219999",
  email: "Ana.Souza@Example.ORG",
  birthDate: "1998-01-15",
  cpf: NEW_CPF,
  phone: "(41) 99999-0000",
  address: "Rua das Araucárias, 10",
  city: "Curitiba",
  state: "pr",
  institutionalEmail: "ana.souza@utfpr.edu.br",
  course: "Engenharia de Software",
  semester: 8,
  className: "ES-2025",
  mainFunction: "Professora",
  joinedAt: "2025-02-01",
  volunteerTermUrl: "https://drive.google.com/file/d/novo/view",
};

const MEMBER_NOT_FOUND_BODY = {
  statusCode: 404,
  error: "MEMBER_NOT_FOUND",
  message: "Member not found.",
};
const FORBIDDEN_SCOPE_BODY = {
  statusCode: 403,
  error: "FORBIDDEN_SCOPE",
  message: "You do not have access to this resource.",
};
const DEPARTMENT_SCOPE_BODY = {
  statusCode: 403,
  error: "DEPARTMENT_SCOPE",
  message: "You cannot move a member to a department outside your scope.",
  details: [{ field: "departmentId", message: "departmentId must be a department of your scope" }],
};

interface Actor {
  id: string;
  cookie: string;
}

/** The Person and member profile columns of a member, read straight from the database. */
interface MemberRow {
  name: string;
  ra: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  role: string | null;
  access_enabled: boolean;
  person_updated_at: Date;
  cpf: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  institutional_email: string | null;
  course: string | null;
  semester: number | null;
  class_name: string | null;
  department_id: string | null;
  main_function: string | null;
  joined_at: string | null;
  volunteer_term_url: string | null;
  registration_status: string;
  status: string;
  exit_date: string | null;
  profile_updated_at: Date;
}

/** Overrides of buildRegistration with a name, an RA and e-mails that are unique per applicant. */
function applicant(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Membro ${n}`,
    ra: `u22101${n}`,
    personalEmail: `membro${n}@example.com`,
    ...overrides,
  };
}

/** Next calendar day of a "YYYY-MM-DD" date, computed on the string (no local time zone). */
function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe("PATCH /members/:id (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;

  let coordinator: Actor;
  let superadmin: Actor;
  let director: Actor;
  let directorComms: Actor;
  let member: Actor;
  let tech: string;
  let comms: string;

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
    await dataSource.query("TRUNCATE TABLE invites, departments, people RESTART IDENTITY CASCADE");

    tech = await insertDepartment(dataSource, "Tecnologia");
    comms = await insertDepartment(dataSource, "Comunicação");

    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    superadmin = await createActor("Superadmin", Role.SUPERADMIN);
    director = await createActor("Director Tech", Role.DIRECTOR);
    await insertMemberProfile(dataSource, {
      personId: director.id,
      status: "approved",
      departmentId: tech,
    });
    directorComms = await createActor("Director Comms", Role.DIRECTOR);
    await insertMemberProfile(dataSource, {
      personId: directorComms.id,
      status: "approved",
      departmentId: comms,
    });
    member = await createActor("Member", Role.MEMBER);
  });

  afterEach(() => {
    eventEmitter.removeAllListeners(AUDITABLE_ACTION_EVENT);
  });

  /** A session cookie for a person, signed without a login. */
  async function cookieOf(personId: string): Promise<string> {
    const token = await jwtService.signAsync({ sub: personId });
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  /** A Person with a role and no member profile, with a session cookie. */
  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    return { id: person.id, cookie: await cookieOf(person.id) };
  }

  async function personIdOf(ra: string): Promise<string> {
    const rows = (await dataSource.query("SELECT id FROM people WHERE ra = $1", [ra])) as Array<{
      id: string;
    }>;
    return rows[0].id;
  }

  /**
   * Registers a member through the real flow: coordination creates an invite, the applicant
   * accepts it with the registration form and coordination approves it in `departmentId` (tech by
   * default) with JOINED_AT. Returns the Person id. Without `approve` the registration stays
   * pending.
   */
  async function registerMember(
    registration: Record<string, unknown>,
    options: { approve?: boolean; departmentId?: string } = {},
  ): Promise<string> {
    const { approve = true, departmentId = tech } = options;

    const created = await request(app.getHttpServer())
      .post("/invites")
      .set("Cookie", coordinator.cookie)
      .send({ role: "member" })
      .expect(201);
    const token = new URL(created.body.url as string).searchParams.get("token") ?? "";

    const form = buildRegistration({ departmentId, ...registration });
    await request(app.getHttpServer())
      .post("/auth/invites/accept")
      .send({ token, password: PASSWORD, registration: form })
      .expect(204);

    const personId = await personIdOf(String(form.ra).toLowerCase());

    if (approve) {
      await request(app.getHttpServer())
        .patch(`/member-registrations/${personId}/approve`)
        .set("Cookie", coordinator.cookie)
        .send({ role: "member", departmentId, mainFunction: MAIN_FUNCTION, joinedAt: JOINED_AT })
        .expect(200);
    }
    return personId;
  }

  function update(id: string, actor: Actor, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/members/${id}`)
      .set("Cookie", actor.cookie)
      .send(body);
  }

  function getMember(id: string, actor: Actor) {
    return request(app.getHttpServer()).get(`/members/${id}`).set("Cookie", actor.cookie);
  }

  async function memberRow(personId: string): Promise<MemberRow> {
    const rows = (await dataSource.query(
      `SELECT p.name, p.ra, p.email, p.phone, p.birth_date::text AS birth_date, p.role,
              p.access_enabled, p.updated_at AS person_updated_at,
              m.cpf, m.address, m.city, m.state, m.institutional_email, m.course, m.semester,
              m.class_name, m.department_id, m.main_function, m.joined_at::text AS joined_at,
              m.volunteer_term_url, m.registration_status, m.status, m.exit_date::text AS exit_date,
              m.updated_at AS profile_updated_at
         FROM people p
         JOIN member_profiles m ON m.person_id = p.id
        WHERE p.id = $1`,
      [personId],
    )) as MemberRow[];
    return rows[0];
  }

  async function nameOf(personId: string): Promise<string> {
    const rows = (await dataSource.query("SELECT name FROM people WHERE id = $1", [
      personId,
    ])) as Array<{ name: string }>;
    return rows[0].name;
  }

  it("coordinator edits every field of the modal: Person fields on people, the rest on member_profiles, and answers the member record (200)", async () => {
    const personId = await registerMember(applicant(1));

    const res = await update(personId, coordinator, { ...FULL_EDIT, departmentId: comms }).expect(
      200,
    );

    expect(res.body).toMatchObject({
      id: personId,
      name: "Ana T. Souza",
      ra: "a2219999",
      email: "ana.souza@example.org",
      birthDate: "1998-01-15",
      phone: "41999990000",
      cpfMasked: "***.***.777-35",
      address: "Rua das Araucárias, 10",
      city: "Curitiba",
      state: "PR",
      institutionalEmail: "ana.souza@utfpr.edu.br",
      course: "Engenharia de Software",
      semester: 8,
      className: "ES-2025",
      department: { id: comms, name: "Comunicação" },
      mainFunction: "Professora",
      joinedAt: "2025-02-01",
      volunteerTermUrl: "https://drive.google.com/file/d/novo/view",
      role: "member",
      accessEnabled: true,
      registrationStatus: "approved",
      status: "active",
    });
    expect(res.body).not.toHaveProperty("cpf");
    expect(JSON.stringify(res.body)).not.toContain(NEW_CPF_DIGITS);
    expect(JSON.stringify(res.body)).not.toContain(NEW_CPF);

    expect(await memberRow(personId)).toMatchObject({
      name: "Ana T. Souza",
      ra: "a2219999",
      email: "ana.souza@example.org",
      phone: "41999990000",
      birth_date: "1998-01-15",
      cpf: NEW_CPF_DIGITS,
      address: "Rua das Araucárias, 10",
      city: "Curitiba",
      state: "PR",
      institutional_email: "ana.souza@utfpr.edu.br",
      course: "Engenharia de Software",
      semester: 8,
      class_name: "ES-2025",
      department_id: comms,
      main_function: "Professora",
      joined_at: "2025-02-01",
      volunteer_term_url: "https://drive.google.com/file/d/novo/view",
      role: "member",
      access_enabled: true,
      status: "active",
    });
  });

  it("keeps omitted fields and clears address, city, state and volunteerTermUrl with null (200)", async () => {
    const personId = await registerMember(applicant(1));
    const before = await memberRow(personId);

    const res = await update(personId, coordinator, {
      address: null,
      city: null,
      state: null,
      volunteerTermUrl: null,
    }).expect(200);

    expect(res.body).toMatchObject({
      address: null,
      city: null,
      state: null,
      volunteerTermUrl: null,
      name: "Membro 1",
      cpfMasked: "***.***.247-25",
    });
    expect(await memberRow(personId)).toEqual({
      ...before,
      address: null,
      city: null,
      state: null,
      volunteer_term_url: null,
      profile_updated_at: expect.any(Date),
    });
  });

  it("superadmin edits a member (200)", async () => {
    const personId = await registerMember(applicant(1));

    const res = await update(personId, superadmin, { course: "Engenharia de Software" }).expect(
      200,
    );

    expect(res.body).toMatchObject({ id: personId, course: "Engenharia de Software" });
    expect((await memberRow(personId)).course).toBe("Engenharia de Software");
  });

  it("director edits a member of the own department, the own record included (200)", async () => {
    const personId = await registerMember(applicant(1));

    const res = await update(personId, director, {
      phone: "(41) 99999-0000",
      mainFunction: "Professora",
    }).expect(200);
    expect(res.body).toMatchObject({
      id: personId,
      phone: "41999990000",
      mainFunction: "Professora",
    });
    expect(await memberRow(personId)).toMatchObject({
      phone: "41999990000",
      main_function: "Professora",
    });

    const own = await update(director.id, director, { name: "Diretora de Tecnologia" }).expect(200);
    expect(own.body).toMatchObject({ id: director.id, name: "Diretora de Tecnologia" });
    expect(await nameOf(director.id)).toBe("Diretora de Tecnologia");
  });

  it("director gets 403 FORBIDDEN_SCOPE for a member of another department, and a director without department for anyone", async () => {
    const techMember = await registerMember(applicant(1));
    const commsMember = await registerMember(applicant(2), { departmentId: comms });
    const withoutDepartment = await createActor("Director Without Department", Role.DIRECTOR);

    const other = await update(commsMember, director, { name: "Outro Nome" }).expect(403);
    expect(other.body).toStrictEqual(FORBIDDEN_SCOPE_BODY);

    for (const target of [techMember, commsMember]) {
      const res = await update(target, withoutDepartment, { name: "Outro Nome" }).expect(403);
      expect(res.body).toStrictEqual(FORBIDDEN_SCOPE_BODY);
    }

    expect(await nameOf(techMember)).toBe("Membro 1");
    expect(await nameOf(commsMember)).toBe("Membro 2");
  });

  it("director gets 403 DEPARTMENT_SCOPE moving the member to another department, and nothing changes", async () => {
    const personId = await registerMember(applicant(1));
    const before = await memberRow(personId);

    for (const body of [
      { departmentId: comms },
      { departmentId: comms, name: "Outro Nome", phone: "(41) 99999-0000" },
    ]) {
      const res = await update(personId, director, body).expect(403);
      expect(res.body).toStrictEqual(DEPARTMENT_SCOPE_BODY);
    }

    expect(await memberRow(personId)).toEqual(before);
  });

  it("director keeps the department of the member, sent in upper case (200)", async () => {
    const personId = await registerMember(applicant(1));

    const res = await update(personId, director, {
      departmentId: tech.toUpperCase(),
      name: "Membro Um",
    }).expect(200);

    expect(res.body).toMatchObject({
      name: "Membro Um",
      department: { id: tech, name: "Tecnologia" },
    });
    expect(await memberRow(personId)).toMatchObject({ name: "Membro Um", department_id: tech });
  });

  it("coordinator moves a member to another department: the director of the new department reads and edits it and the old one gets 403", async () => {
    const personId = await registerMember(applicant(1));

    await update(personId, coordinator, { departmentId: comms }).expect(200);

    await getMember(personId, directorComms).expect(200);
    const edited = await update(personId, directorComms, { mainFunction: "Redatora" }).expect(200);
    expect(edited.body).toMatchObject({
      mainFunction: "Redatora",
      department: { id: comms, name: "Comunicação" },
    });

    const read = await getMember(personId, director).expect(403);
    expect(read.body).toStrictEqual(FORBIDDEN_SCOPE_BODY);
    const write = await update(personId, director, { mainFunction: "Outra" }).expect(403);
    expect(write.body).toStrictEqual(FORBIDDEN_SCOPE_BODY);

    expect(await memberRow(personId)).toMatchObject({
      department_id: comms,
      main_function: "Redatora",
    });
  });

  it("member gets 403 FORBIDDEN, also with an invalid body", async () => {
    const personId = await registerMember(applicant(1));

    for (const body of [{ name: "Outro Nome" }, { name: null, cpf: "123" }]) {
      const res = await update(personId, member, body).expect(403);
      expect(res.body.error).toBe("FORBIDDEN");
    }

    expect(await nameOf(personId)).toBe("Membro 1");
  });

  it("requires authentication (401)", async () => {
    const personId = await registerMember(applicant(1));

    const res = await request(app.getHttpServer())
      .patch(`/members/${personId}`)
      .send({ name: "Outro Nome" })
      .expect(401);

    expect(res.body.statusCode).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
    expect(await nameOf(personId)).toBe("Membro 1");
  });

  it("never changes role, accessEnabled nor the participation: they are dropped from the body (200)", async () => {
    const personId = await registerMember(applicant(1));

    const res = await update(personId, coordinator, {
      name: "Membro Um",
      role: "coordinator",
      accessEnabled: false,
      status: "inactive",
      exitDate: "2026-01-01",
      registrationStatus: "pending",
    }).expect(200);

    expect(res.body).toMatchObject({
      name: "Membro Um",
      role: "member",
      accessEnabled: true,
      status: "active",
      exitDate: null,
      registrationStatus: "approved",
    });
    expect(await memberRow(personId)).toMatchObject({
      name: "Membro Um",
      role: "member",
      access_enabled: true,
      status: "active",
      exit_date: null,
      registration_status: "approved",
    });
  });

  it("409 RA_ALREADY_IN_USE with details on ra when the RA belongs to another member; nothing is written", async () => {
    const target = await registerMember(applicant(1));
    await registerMember(applicant(2));
    const before = await memberRow(target);

    const res = await update(target, coordinator, {
      ra: "U221012",
      name: "Outro Nome",
      course: "Engenharia de Software",
    }).expect(409);

    expect(res.body).toStrictEqual({
      statusCode: 409,
      error: "RA_ALREADY_IN_USE",
      message: "RA already in use.",
      details: [{ field: "ra", message: "ra is already in use" }],
    });
    expect(await memberRow(target)).toEqual(before);
  });

  it("409 EMAIL_ALREADY_IN_USE with details on email when the personal e-mail belongs to another person, a student included; nothing is written", async () => {
    const target = await registerMember(applicant(1));
    await registerMember(applicant(2));
    await peopleService.save({
      name: "Aluna",
      email: "aluna@example.com",
      role: null,
      accessEnabled: false,
    });
    const before = await memberRow(target);

    for (const email of ["MEMBRO2@EXAMPLE.COM", "Aluna@Example.com"]) {
      const res = await update(target, coordinator, {
        email,
        name: "Outro Nome",
        city: "Curitiba",
      }).expect(409);

      expect(res.body).toStrictEqual({
        statusCode: 409,
        error: "EMAIL_ALREADY_IN_USE",
        message: "Email already in use.",
        details: [{ field: "email", message: "email is already in use" }],
      });
    }

    expect(await memberRow(target)).toEqual(before);
  });

  it("accepts a CPF and an institutional e-mail that another member already has, as the sign-up does (200)", async () => {
    const first = await registerMember(applicant(1));
    const second = await registerMember(
      applicant(2, { cpf: NEW_CPF, institutionalEmail: "membro2@utfpr.edu.br" }),
    );

    await update(second, coordinator, {
      cpf: "529.982.247-25",
      institutionalEmail: "ana.torres@example.edu",
    }).expect(200);

    expect(await memberRow(second)).toMatchObject({
      cpf: "52998224725",
      institutional_email: "ana.torres@example.edu",
    });
    expect(await memberRow(first)).toMatchObject({
      cpf: "52998224725",
      institutional_email: "ana.torres@example.edu",
    });
  });

  it("409 MEMBER_INACTIVE for an inactive member; 409 REGISTRATION_NOT_APPROVED for a pending registration; 409 NO_MEMBER_PROFILE for a superadmin and a coordinator without profile", async () => {
    const inactive = await registerMember(applicant(1));
    await request(app.getHttpServer())
      .patch(`/members/${inactive}/deactivate`)
      .set("Cookie", coordinator.cookie)
      .send({ exitDate: "2025-12-15", reason: "Formou-se." })
      .expect(200);

    for (const body of [{ name: "Outro Nome" }, {}]) {
      const res = await update(inactive, coordinator, body).expect(409);
      expect(res.body).toStrictEqual({
        statusCode: 409,
        error: "MEMBER_INACTIVE",
        message: "The member is inactive.",
      });
    }
    expect(await nameOf(inactive)).toBe("Membro 1");

    const pending = await registerMember(applicant(2), { approve: false });
    const notApproved = await update(pending, coordinator, { name: "Outro Nome" }).expect(409);
    expect(notApproved.body).toStrictEqual({
      statusCode: 409,
      error: "REGISTRATION_NOT_APPROVED",
      message: "Only members with an approved registration can be edited.",
    });
    expect(await nameOf(pending)).toBe("Membro 2");

    const otherCoordinator = await createActor("Other Coordinator", Role.COORDINATOR);
    for (const { target, name } of [
      { target: superadmin, name: "Superadmin" },
      { target: otherCoordinator, name: "Other Coordinator" },
    ]) {
      const res = await update(target.id, coordinator, { name: "Outro Nome" }).expect(409);
      expect(res.body).toStrictEqual({
        statusCode: 409,
        error: "NO_MEMBER_PROFILE",
        message: "This person has no member profile.",
      });
      expect(await nameOf(target.id)).toBe(name);
    }
  });

  it("400 DEPARTMENT_NOT_FOUND for an unknown department sent by coordination", async () => {
    const personId = await registerMember(applicant(1));

    const res = await update(personId, coordinator, {
      departmentId: randomUUID(),
      name: "Outro Nome",
    }).expect(400);

    expect(res.body).toStrictEqual({
      statusCode: 400,
      error: "DEPARTMENT_NOT_FOUND",
      message: "Department not found.",
    });
    expect(await memberRow(personId)).toMatchObject({ name: "Membro 1", department_id: tech });
  });

  it("400 VALIDATION_FAILED with details[].field for null in a never-null field, an invalid CPF, a phone with letters, an unknown UF, a future joinedAt and an http term link", async () => {
    const personId = await registerMember(applicant(1));
    const before = await memberRow(personId);

    const res = await update(personId, coordinator, {
      name: null,
      cpf: "123.456.789-00",
      phone: "(11) 9abc1-3030",
      state: "XX",
      joinedAt: nextDay(todayInAppTimeZone()),
      volunteerTermUrl: "http://drive.google.com/file/d/exemplo/view",
    }).expect(400);

    expect(res.body.error).toBe("VALIDATION_FAILED");
    expect(res.body.details.map((detail: { field: string }) => detail.field).sort()).toEqual([
      "cpf",
      "joinedAt",
      "name",
      "phone",
      "state",
      "volunteerTermUrl",
    ]);
    expect(await memberRow(personId)).toEqual(before);
  });

  it("404 MEMBER_NOT_FOUND for an unknown id, a malformed id and a person without role nor profile", async () => {
    const student = await peopleService.save({ name: "Aluno", role: null, accessEnabled: false });

    for (const id of [randomUUID(), "not-a-uuid", student.id]) {
      const res = await update(id, coordinator, { name: "Outro Nome" }).expect(404);
      expect(res.body).toStrictEqual(MEMBER_NOT_FOUND_BODY);
    }
  });

  it("an empty body or the same values answer 200 without writing (updated_at unchanged)", async () => {
    const personId = await registerMember(applicant(1));
    const before = await memberRow(personId);

    for (const body of [
      {},
      { name: "Membro 1", departmentId: tech, phone: "(11) 98181-3030", city: "São Paulo" },
    ]) {
      const res = await update(personId, coordinator, body).expect(200);
      expect(res.body).toMatchObject({ id: personId, name: "Membro 1", phone: "11981813030" });
    }

    expect(await memberRow(personId)).toEqual(before);
  });

  it("coordination with a member profile edits the own record: no OWN_ACCOUNT on the edit (200)", async () => {
    const self = await createActor("Coordinator With Profile", Role.COORDINATOR);
    await insertMemberProfile(dataSource, { personId: self.id, status: "approved" });

    const res = await update(self.id, self, { name: "Coordenadora Editada" }).expect(200);

    expect(res.body).toMatchObject({
      id: self.id,
      name: "Coordenadora Editada",
      role: "coordinator",
      accessEnabled: true,
    });
    expect(await nameOf(self.id)).toBe("Coordenadora Editada");
  });

  it("emits one MEMBER_UPDATED with changedFields and no personal value", async () => {
    const personId = await registerMember(applicant(1));
    const events: AuditableActionEvent[] = [];
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => events.push(event));

    await update(personId, coordinator, {
      name: "Membro Um",
      phone: "(41) 99999-0000",
      cpf: NEW_CPF,
      address: null,
      mainFunction: "Professora",
      departmentId: comms,
    }).expect(200);

    const updated = events.filter((event) => event.action === AuditableAction.MEMBER_UPDATED);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      actorId: coordinator.id,
      targetType: "member",
      targetId: personId,
    });
    expect(updated[0].before).toStrictEqual({ departmentId: tech, mainFunction: MAIN_FUNCTION });
    expect(updated[0].after).toStrictEqual({
      departmentId: comms,
      mainFunction: "Professora",
      changedFields: ["name", "phone", "cpf", "address", "departmentId", "mainFunction"],
    });
    const serialized = JSON.stringify(updated[0]);
    for (const value of [
      ...REGISTRATION_SENSITIVE_VALUES,
      NEW_CPF_DIGITS,
      "41999990000",
      "Membro Um",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });
});
