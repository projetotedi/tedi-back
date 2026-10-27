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
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { ClassesModule } from "../classes.module";
import { insertClass, insertCourse, insertEdition } from "./fixtures/classes.fixture";

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

process.env.JWT_SECRET = "e2e-editions-secret";

const SESSION_COOKIE_NAME = "tedi_session";

interface Actor {
  id: string;
  cookie: string;
}

interface EditionBody {
  id: string;
  name: string;
}

describe("EditionsController (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;

  let director: Actor;
  let coordinator: Actor;
  let member: Actor;

  beforeAll(async () => {
    // No override of the enrollments here: the real count (always 0 for now) is enough.
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
        ClassesModule,
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      "TRUNCATE TABLE classes, editions, course_prerequisites, courses, people RESTART IDENTITY CASCADE",
    );

    director = await createActor("Director", Role.DIRECTOR);
    coordinator = await createActor("Coordinator", Role.COORDINATOR);
    member = await createActor("Member", Role.MEMBER);
  });

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  function getEditions(actor: Actor) {
    return request(app.getHttpServer()).get("/editions").set("Cookie", actor.cookie);
  }

  async function namesFor(actor: Actor): Promise<string[]> {
    const res = await getEditions(actor).expect(200);
    return (res.body as EditionBody[]).map((edition) => edition.name);
  }

  describe("GET /editions (listEditions)", () => {
    it("lists the editions most recent first: ['2026.2', '2026.1']", async () => {
      await insertEdition(dataSource, "2026.1");
      await insertEdition(dataSource, "2026.2");

      const res = await getEditions(director).expect(200);

      expect((res.body as EditionBody[]).map((edition) => edition.name)).toEqual([
        "2026.2",
        "2026.1",
      ]);
    });

    it("orders by name, not by creation: 2026.2 created before 2026.1 still comes first", async () => {
      await insertEdition(dataSource, "2026.2");
      await insertEdition(dataSource, "2026.1");

      expect(await namesFor(director)).toEqual(["2026.2", "2026.1"]);
    });

    it("puts a later year before an earlier one, whatever the term", async () => {
      for (const name of ["2026.2", "2027.1", "2025.2", "2026.1", "2025.1", "2026.9"]) {
        await insertEdition(dataSource, name);
      }

      expect(await namesFor(director)).toEqual([
        "2027.1",
        "2026.9",
        "2026.2",
        "2026.1",
        "2025.2",
        "2025.1",
      ]);
    });

    it("answers { id, name } for each edition and nothing else", async () => {
      const id = await insertEdition(dataSource, "2026.1");

      const res = await getEditions(director).expect(200);

      expect(res.body).toEqual([{ id, name: "2026.1" }]);
    });

    it("answers an empty list when there is no edition", async () => {
      const res = await getEditions(director).expect(200);

      expect(res.body).toEqual([]);
    });

    it("answers 200 for a director, a coordinator and a member", async () => {
      await insertEdition(dataSource, "2026.1");

      for (const actor of [director, coordinator, member]) {
        expect(await namesFor(actor)).toEqual(["2026.1"]);
      }
    });

    it("returns 401 without a session cookie", async () => {
      const res = await request(app.getHttpServer()).get("/editions").expect(401);

      expect(res.body.error).toBe("UNAUTHORIZED");
    });

    it("keeps the edition of an archived class in the list", async () => {
      const courseId = await insertCourse(dataSource, director.id);
      const editionId = await insertEdition(dataSource, "2026.1");
      await insertClass(dataSource, {
        courseId,
        editionId,
        createdById: director.id,
        archivedById: coordinator.id,
      });

      expect(await namesFor(member)).toEqual(["2026.1"]);
    });

    it("lists the editions that POST /classes creates on demand", async () => {
      const courseId = await insertCourse(dataSource, director.id);
      const post = (editionName: string, code: string) =>
        request(app.getHttpServer()).post("/classes").set("Cookie", director.cookie).send({
          courseId,
          code,
          editionName,
          startDate: "2026-03-03",
          endDate: "2026-06-27",
          capacity: 15,
        });
      expect(await namesFor(director)).toEqual([]);

      await post("2026.1", "INFO-A").expect(201);
      await post("2026.2", "INFO-A").expect(201);
      // A second class in an edition that exists does not repeat it in the list.
      await post("2026.2", "INFO-B").expect(201);

      expect(await namesFor(member)).toEqual(["2026.2", "2026.1"]);
    });

    it("has no route to create, rename or delete an edition", async () => {
      const id = await insertEdition(dataSource, "2026.1");

      for (const [method, path] of [
        ["post", "/editions"],
        ["patch", `/editions/${id}`],
        ["delete", `/editions/${id}`],
      ] as const) {
        const res = await request(app.getHttpServer())
          [method](path)
          .set("Cookie", coordinator.cookie)
          .send({ name: "2026.2" })
          .expect(404);

        expect(res.body.error).toBe("NOT_FOUND");
      }
      expect(await namesFor(coordinator)).toEqual(["2026.1"]);
    });
  });
});
