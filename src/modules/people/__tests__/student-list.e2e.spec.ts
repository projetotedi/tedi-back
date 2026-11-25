/**
 * E2e spec for GET /students (listStudents) — GUS-106 (list of students).
 *
 * CA1: search=maria and search=Mária bring the same students
 * CA2: search=98888 finds the phone even when it was stored with a mask
 * CA3: accessibilityNeed=any brings only the students with some need
 * CA4: ids=a,b brings only these students, with the normal pagination
 * CA5: age is computed; the archived only come with archived=true
 *
 * Cases of the card:
 *  1. 24 students -> limit=10&page=3 -> 4 items, total 24
 *  2. a visual student shows up for visual and any, not for hearing
 *  3. search=(11) 98888 and search=98888 -> the same result
 */
import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
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
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { PeopleModule } from "../people.module";
import { PeopleService } from "../services/people.service";
import { insertStudent } from "./fixtures/students.fixture";

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

process.env.JWT_SECRET = "e2e-student-list-secret";

// Name of the session cookie set by the auth module (kept local: tests do not import module internals).
const SESSION_COOKIE_NAME = "tedi_session";

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

interface StudentItem {
  id: string;
  name: string;
  birthDate: string;
  age: number;
  phone: string | null;
  email: string | null;
  accessibilityNeed: string;
  createdAt: string;
}

interface Page {
  data: StudentItem[];
  total: number;
  page: number;
  limit: number;
}

describe("GET /students (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;

  let director: Actor;
  let coordinator: Actor;
  let member: Actor;

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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  /** A student straight in the tables: the phone goes in as given, a mask included. */
  function student(
    name: string,
    input: {
      phone?: string;
      email?: string;
      accessibilityNeed?: string;
      archived?: boolean;
    } = {},
  ): Promise<string> {
    return insertStudent(dataSource, {
      name,
      createdById: director.id,
      phone: input.phone,
      email: input.email,
      accessibilityNeed: input.accessibilityNeed,
      archivedById: input.archived === true ? coordinator.id : undefined,
    });
  }

  /** GET /students with the query string as written (a repeated parameter stays repeated). */
  function list(query = "", actor: Actor | null = member) {
    const req = request(app.getHttpServer()).get(`/students${query}`);
    return actor === null ? req : req.set("Cookie", actor.cookie);
  }

  async function names(query: string): Promise<string[]> {
    const res = await list(query).expect(200);
    return (res.body as Page).data.map((item) => item.name);
  }

  // ---------------------------------------------------------------------------
  // GET /students
  // ---------------------------------------------------------------------------

  it("pages 24 students: limit=10&page=3 answers 4 items and total 24", async () => {
    for (let index = 1; index <= 24; index++) {
      await student(`Student ${String(index).padStart(2, "0")}`);
    }

    const res = await list("?limit=10&page=3").expect(200);

    const page = res.body as Page;
    expect(page.total).toBe(24);
    expect(page.page).toBe(3);
    expect(page.limit).toBe(10);
    expect(page.data.map((item) => item.name)).toEqual([
      "Student 21",
      "Student 22",
      "Student 23",
      "Student 24",
    ]);
  });

  it("answers each item with exactly id, name, birthDate, age, phone, email, accessibilityNeed and createdAt", async () => {
    const created = await request(app.getHttpServer())
      .post("/students")
      .set("Cookie", director.cookie)
      .send(MARIA)
      .expect(201);
    const { id, createdAt } = created.body as { id: string; createdAt: string };

    const res = await list().expect(200);

    // toEqual on the whole page: the emergency contact, the support resource and the class needs
    // stay in the record (GET /students/:id), and the actors (no student profile) are not students.
    expect(res.body).toEqual({
      data: [
        {
          id,
          name: "Maria Silva Santos",
          birthDate: "1958-04-12",
          age: ageOn("1958-04-12", todayInAppTimeZone()),
          phone: "43999990000",
          email: "maria.santos@example.com",
          accessibilityNeed: "visual",
          createdAt,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
  });

  it("finds the same students for search=maria and search=Mária", async () => {
    await student("Maria Silva");
    await student("Ana Mária");
    await student("Bruno Lima");

    const plain = await names("?search=maria");
    const accented = await names(`?search=${encodeURIComponent("Mária")}`);

    expect(plain).toEqual(["Ana Mária", "Maria Silva"]);
    expect(accented).toEqual(plain);
  });

  it("finds a student by part of the e-mail", async () => {
    await student("Ana", { email: "ana.souza@example.com" });
    await student("Bruno", { email: "bruno@example.com" });

    expect(await names(`?search=${encodeURIComponent("SOUZA@exa")}`)).toEqual(["Ana"]);
    expect(await names("?search=example")).toEqual(["Ana", "Bruno"]);
  });

  it("finds a phone stored with a mask by search=98888 and by search=(11) 98888", async () => {
    // The API stores digits only; a mask only comes in by SQL (an import, a fix).
    const masked = await student("Ana", { phone: "(11) 98888-7777" });
    await student("Bruno", { phone: "43999990000" });

    const digits = await list("?search=98888").expect(200);
    const formatted = await list(`?search=${encodeURIComponent("(11) 98888")}`).expect(200);

    expect((digits.body as Page).data.map((item) => [item.id, item.phone])).toEqual([
      [masked, "(11) 98888-7777"],
    ]);
    expect(formatted.body).toEqual(digits.body);
  });

  it("does not read a term with letters as a phone", async () => {
    await student("Ana", { email: "ana2@x.com" });
    await student("Bruno", { phone: "22222222222" });

    expect(await names("?search=ana2")).toEqual(["Ana"]);
    // The same digits alone are a phone.
    expect(await names("?search=2222")).toEqual(["Bruno"]);
  });

  it("filters by accessibilityNeed: visual, any and hearing", async () => {
    await student("Ana", { accessibilityNeed: "none" });
    await student("Bruno", { accessibilityNeed: "visual" });
    await student("Carla", { accessibilityNeed: "hearing" });

    expect(await names("?accessibilityNeed=visual")).toEqual(["Bruno"]);
    expect(await names("?accessibilityNeed=any")).toEqual(["Bruno", "Carla"]);
    expect(await names("?accessibilityNeed=hearing")).toEqual(["Carla"]);
    expect(await names("?accessibilityNeed=visual,none")).toEqual(["Ana", "Bruno"]);
    expect(await names("?accessibilityNeed=visual&accessibilityNeed=hearing")).toEqual([
      "Bruno",
      "Carla",
    ]);
    // Empty filters nothing.
    expect(await names("?accessibilityNeed=")).toEqual(["Ana", "Bruno", "Carla"]);
  });

  it("lists only the ids asked, with the normal pagination", async () => {
    const ana = await student("Ana");
    await student("Bruno");
    const carla = await student("Carla");

    const first = await list(`?ids=${ana},${carla}&limit=1`).expect(200);
    expect((first.body as Page).total).toBe(2);
    expect((first.body as Page).data.map((item) => item.name)).toEqual(["Ana"]);

    const second = await list(`?ids=${ana},${carla}&limit=1&page=2`).expect(200);
    expect((second.body as Page).data.map((item) => item.name)).toEqual(["Carla"]);

    // A person that is not a student (an actor) is simply not there.
    const withActor = await list(`?ids=${carla}&ids=${member.id}`).expect(200);
    expect((withActor.body as Page).data.map((item) => item.id)).toEqual([carla]);
    expect((withActor.body as Page).total).toBe(1);
  });

  it("leaves the archived out unless archived=true, which lists only them", async () => {
    await student("Ana");
    const bruno = await student("Bruno", { archived: true });

    expect(await names("")).toEqual(["Ana"]);
    expect(await names("?archived=false")).toEqual(["Ana"]);
    expect(await names("?archived=true")).toEqual(["Bruno"]);
    // ids does not bring an archived student back without archived=true.
    expect(await names(`?ids=${bruno}`)).toEqual([]);
    expect(await names(`?ids=${bruno}&archived=true`)).toEqual(["Bruno"]);
  });

  it("orders by name by default and by registration, newest first, with sort=createdAt", async () => {
    const registeredAt = async (name: string, at: string): Promise<void> => {
      const id = await student(name);
      await dataSource.query(`UPDATE student_profiles SET created_at = $2 WHERE person_id = $1`, [
        id,
        at,
      ]);
    };
    await registeredAt("Ana", "2026-01-10T12:00:00.000Z");
    await registeredAt("Bruno", "2026-03-10T12:00:00.000Z");
    await registeredAt("Carla", "2026-02-10T12:00:00.000Z");

    expect(await names("")).toEqual(["Ana", "Bruno", "Carla"]);
    expect(await names("?sort=name")).toEqual(["Ana", "Bruno", "Carla"]);
    expect(await names("?sort=createdAt")).toEqual(["Bruno", "Carla", "Ana"]);

    const res = await list("?sort=createdAt&limit=1").expect(200);
    expect((res.body as Page).data[0].createdAt).toBe("2026-03-10T12:00:00.000Z");
  });

  it("lets a member list the students and answers 401 without a session", async () => {
    await student("Ana");

    for (const actor of [member, director, coordinator]) {
      const res = await list("", actor).expect(200);
      expect((res.body as Page).total).toBe(1);
    }
    await list("", null).expect(401);
  });

  it("answers 400 VALIDATION_FAILED for a bad filter", async () => {
    for (const query of [
      "?ids=not-a-uuid",
      "?ids=",
      "?accessibilityNeed=blind",
      "?sort=age",
      "?limit=101",
    ]) {
      const res = await list(query).expect(400);
      expect(res.body.error).toBe("VALIDATION_FAILED");
    }
  });
});
