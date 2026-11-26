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
import { CatalogModule } from "../catalog.module";

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

process.env.JWT_SECRET = "e2e-lesson-plans-list-secret";

const SESSION_COOKIE_NAME = "tedi_session";

interface Actor {
  id: string;
  cookie: string;
}

interface ListItem {
  id: string;
  title: string;
  contents: string[];
  expectedDurationMinutes: number;
  materialUrl: string | null;
  courseCount: number;
  status: string;
  archivedAt: string | null;
  updatedAt: string;
}

interface ListPage {
  data: ListItem[];
  total: number;
  page: number;
  limit: number;
}

describe("GET /lesson-plans (listLessonPlans, GUS-95) (e2e)", () => {
  let app: INestApplication;
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let jwtService: JwtService;

  let director: Actor;
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
        CatalogModule,
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
    await dataSource.query(
      "TRUNCATE TABLE course_lesson_plans, course_prerequisites, courses, lesson_plan_contents, lesson_plans, people RESTART IDENTITY CASCADE",
    );
    director = await createActor("Director", Role.DIRECTOR);
    member = await createActor("Member", Role.MEMBER);
  });

  async function createActor(name: string, role: Role): Promise<Actor> {
    const person = await peopleService.save({ name, role, accessEnabled: true });
    const token = await jwtService.signAsync({ sub: person.id });
    return { id: person.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  async function createPlan(
    title: string,
    { minutes = 90, contents = ["Conteúdo"] }: { minutes?: number; contents?: string[] } = {},
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/lesson-plans")
      .set("Cookie", director.cookie)
      .send({ title, expectedDurationMinutes: minutes, contents })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function createCourse(name: string, lessonPlanIds: string[]): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/courses")
      .set("Cookie", director.cookie)
      .send({ name, description: "Descrição.", category: "basic" })
      .expect(201);
    const id = (res.body as { id: string }).id;
    await request(app.getHttpServer())
      .put(`/courses/${id}/lesson-plans`)
      .set("Cookie", director.cookie)
      .send({ lessonPlanIds })
      .expect(200);
    return id;
  }

  async function archive(path: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`${path}/archive`)
      .set("Cookie", director.cookie)
      .expect(200);
  }

  async function list(query: Record<string, unknown> = {}, actor = director): Promise<ListPage> {
    const res = await request(app.getHttpServer())
      .get("/lesson-plans")
      .query(query)
      .set("Cookie", actor.cookie)
      .expect(200);
    return res.body as ListPage;
  }

  const titles = (page: ListPage) => page.data.map((item) => item.title);

  it("answers the first page by title, with the total, for a member too", async () => {
    await createPlan("Senhas");
    await createPlan("Áudio no celular");
    await createPlan("Teclado");

    const page = await list({}, member);

    expect(titles(page)).toEqual(["Senhas", "Teclado", "Áudio no celular"].sort());
    expect(page).toMatchObject({ total: 3, page: 1, limit: 20 });
  });

  it("paginates: 25 plans, limit=10&page=3 answers 5", async () => {
    for (let index = 0; index < 25; index += 1) {
      await createPlan(`Plano ${String(index).padStart(2, "0")}`);
    }

    const page = await list({ limit: 10, page: 3 });

    expect(page.data).toHaveLength(5);
    expect(page.total).toBe(25);
    expect(page.data[0].title).toBe("Plano 20");
  });

  it("counts the courses of a plan, archived ones included, and gives its contents in order", async () => {
    const plan = await createPlan("Teclado", { contents: ["Teclado", "Mouse", "Janelas"] });
    await createCourse("Informática Básica", [plan]);
    const archived = await createCourse("Informática Antiga", [plan]);
    await archive(`/courses/${archived}`);

    const [item] = (await list()).data;

    expect(item).toMatchObject({
      id: plan,
      title: "Teclado",
      contents: ["Teclado", "Mouse", "Janelas"],
      expectedDurationMinutes: 90,
      materialUrl: null,
      courseCount: 2,
      status: "in_use",
      archivedAt: null,
    });
  });

  it("does not count a course that was deleted", async () => {
    const plan = await createPlan("Teclado");
    const course = await createCourse("Informática Básica", [plan]);
    await dataSource.query("UPDATE courses SET deleted_at = now() WHERE id = $1", [course]);

    expect((await list()).data[0]).toMatchObject({ courseCount: 0, status: "unused" });
  });

  it("finds by title ignoring case and accents", async () => {
    await createPlan("Teclado e mouse");
    await createPlan("Senhas");

    expect(titles(await list({ search: "TECLÁDO" }))).toEqual(["Teclado e mouse"]);
  });

  it.each(["janela", "JANELA", "janéla"])(
    "finds content=%s by the text of a content",
    async (content) => {
      await createPlan("Windows", { contents: ["Janelas do sistema"] });
      await createPlan("Senhas", { contents: ["Senha forte"] });

      expect(titles(await list({ content }))).toEqual(["Windows"]);
    },
  );

  it("filters by usage, and leaves the archived out unless asked", async () => {
    const used = await createPlan("Usado");
    await createPlan("Livre");
    const archived = await createPlan("Arquivado");
    await createCourse("Curso", [used]);
    await archive(`/lesson-plans/${archived}`);

    expect(titles(await list())).toEqual(["Livre", "Usado"]);
    expect(titles(await list({ usage: "in_use" }))).toEqual(["Usado"]);
    expect(titles(await list({ usage: "unused" }))).toEqual(["Livre"]);
    const archivedPage = await list({ usage: "archived" });
    expect(titles(archivedPage)).toEqual(["Arquivado"]);
    expect(archivedPage.data[0].status).toBe("archived");
    expect(archivedPage.data[0].archivedAt).not.toBeNull();
  });

  it("filters by duration, the bounds included", async () => {
    await createPlan("Curto", { minutes: 60 });
    await createPlan("Médio", { minutes: 100 });
    await createPlan("Longo", { minutes: 150 });

    expect(titles(await list({ minDuration: 100 }))).toEqual(["Longo", "Médio"]);
    expect(titles(await list({ maxDuration: 60 }))).toEqual(["Curto"]);
    expect(titles(await list({ minDuration: 61, maxDuration: 120 }))).toEqual(["Médio"]);
  });

  it("leaves out the plans of the course of excludeCourseId", async () => {
    const inCourse = await createPlan("No curso A");
    const other = await createPlan("No curso B");
    await createPlan("Em nenhum");
    const courseA = await createCourse("Curso A", [inCourse]);
    await createCourse("Curso B", [other, inCourse]);

    expect(titles(await list({ excludeCourseId: courseA }))).toEqual(["Em nenhum", "No curso B"]);
  });

  it("orders by updatedAt, the one changed last first", async () => {
    const first = await createPlan("A primeiro");
    await createPlan("B segundo");
    await request(app.getHttpServer())
      .patch(`/lesson-plans/${first}`)
      .set("Cookie", director.cookie)
      .send({ objective: "Mudou." })
      .expect(200);

    expect(titles(await list({ sort: "updatedAt" }))).toEqual(["A primeiro", "B segundo"]);
  });

  it.each([
    [{ excludeCourseId: "curso-a" }, "excludeCourseId"],
    [{ minDuration: 120, maxDuration: 60 }, "maxDuration"],
    [{ usage: "all" }, "usage"],
  ])("refuses %o with 400 VALIDATION_FAILED", async (query, field) => {
    const res = await request(app.getHttpServer())
      .get("/lesson-plans")
      .query(query)
      .set("Cookie", director.cookie)
      .expect(400);

    expect(res.body).toMatchObject({ error: "VALIDATION_FAILED" });
    expect(
      (res.body as { details: Array<{ field: string }> }).details.map((d) => d.field),
    ).toContain(field);
  });

  it("answers 401 without a session", async () => {
    await request(app.getHttpServer()).get("/lesson-plans").expect(401);
    await request(app.getHttpServer()).get("/lesson-plans/contents").expect(401);
  });

  describe("GET /lesson-plans/contents (listLessonPlanContents)", () => {
    async function contents(search?: string): Promise<string[]> {
      const res = await request(app.getHttpServer())
        .get("/lesson-plans/contents")
        .query(search === undefined ? {} : { search })
        .set("Cookie", member.cookie)
        .expect(200);
      return res.body as string[];
    }

    it("is not taken for the id of a plan", async () => {
      await createPlan("Windows", { contents: ["Janelas"] });

      expect(await contents()).toEqual(["Janelas"]);
    });

    it("gives one suggestion for texts that differ only by accents or case, as most plans write it", async () => {
      await createPlan("A", { contents: ["Janela"] });
      await createPlan("B", { contents: ["janela"] });
      await createPlan("C", { contents: ["Janela", "Mouse"] });
      await createPlan("D", { contents: ["Jánela"] });

      expect(await contents("jan")).toEqual(["Janela"]);
      expect(await contents()).toEqual(["Janela", "Mouse"]);
    });

    it("leaves out the contents of archived plans and gives at most 20", async () => {
      const archived = await createPlan("Arquivado", { contents: ["Só no arquivado"] });
      await archive(`/lesson-plans/${archived}`);
      await createPlan("Muitos", {
        contents: Array.from(
          { length: 25 },
          (_, index) => `Item ${String(index).padStart(2, "0")}`,
        ),
      });

      const suggestions = await contents();

      expect(suggestions).toHaveLength(20);
      expect(suggestions).not.toContain("Só no arquivado");
      expect(suggestions[0]).toBe("Item 00");
    });
  });

  it("has the GIN indexes of the search", async () => {
    const rows: Array<{ indexname: string }> = await dataSource.query(
      `SELECT indexname FROM pg_indexes
        WHERE indexname IN ('idx_lesson_plans_title_search', 'idx_lesson_plan_contents_text_search')
        ORDER BY indexname`,
    );

    expect(rows.map((row) => row.indexname)).toEqual([
      "idx_lesson_plan_contents_text_search",
      "idx_lesson_plans_title_search",
    ]);
  });
});
