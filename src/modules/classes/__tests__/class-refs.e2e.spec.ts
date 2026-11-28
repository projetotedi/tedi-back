import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource } from "typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { ClassesModule } from "../classes.module";
import { ClassRef, ClassesService, ClassStatus } from "../services/classes.service";
import { insertClass, insertCourse, insertEdition } from "./fixtures/classes.fixture";

config();

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

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

/** The code and the rank of each class, in the order the list answered them. */
function codesAndRanks(refs: ClassRef[]): Array<[string, number]> {
  return refs.map((ref) => [ref.code, ref.creationRank]);
}

describe("ClassesService.listClassRefs (e2e)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: ClassesService;
  let peopleService: PeopleService;

  let actorId: string;
  let editionId: string;
  let courseX: string;
  let courseY: string;
  /** How many classes the test has added: it is the second of `created_at` of the next one. */
  let created: number;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          // Every entity: the foreign keys of SchoolClass point to "courses" and "people" by table
          // name, and that only resolves when those entities are loaded too.
          entities: [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
        PeopleModule,
        CatalogModule,
        ClassesModule,
      ],
    }).compile();

    dataSource = module.get(DataSource);
    service = module.get(ClassesService);
    peopleService = module.get(PeopleService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE classes, editions, course_prerequisites, courses, people RESTART IDENTITY CASCADE`,
    );

    actorId = (await peopleService.save({ name: "Director" })).id;
    editionId = await insertEdition(dataSource, "2026.1");
    courseX = await insertCourse(dataSource, actorId, "Informática Básica");
    courseY = await insertCourse(dataSource, actorId, "Segurança Digital");
    created = 0;
  });

  /**
   * A class made by SQL, in the course X unless told otherwise. `created_at` is set by hand, one
   * second after the previous class: the rank follows `created_at`, and two inserts in a row could
   * share the same microsecond, which would leave the order to the random id of the fixture.
   */
  async function addClass(
    code: string,
    options: { courseId?: string; name?: string } = {},
  ): Promise<string> {
    const id = await insertClass(dataSource, {
      courseId: options.courseId ?? courseX,
      editionId,
      createdById: actorId,
      code,
      name: options.name,
    });
    created += 1;
    await dataSource.query(`UPDATE classes SET created_at = $2 WHERE id = $1`, [
      id,
      new Date(Date.UTC(2026, 0, 1, 12, 0, created)),
    ]);
    return id;
  }

  it("answers an empty list when there is no class", async () => {
    await expect(service.listClassRefs()).resolves.toEqual([]);
  });

  it("ranks the classes by creation, from 1, and answers them in that order", async () => {
    const a = await addClass("INFO-A", { name: "Informática Básica, turma A" });
    const b = await addClass("INFO-B", { courseId: courseY });
    const c = await addClass("INFO-C");

    const refs = await service.listClassRefs();

    expect(codesAndRanks(refs)).toEqual([
      ["INFO-A", 1],
      ["INFO-B", 2],
      ["INFO-C", 3],
    ]);
    expect(refs[0]).toEqual({
      id: a,
      code: "INFO-A",
      name: "Informática Básica, turma A",
      courseId: courseX,
      status: ClassStatus.PLANNED,
      archivedAt: null,
      creationRank: 1,
    });
    expect(refs[1]).toEqual({
      id: b,
      code: "INFO-B",
      name: null,
      courseId: courseY,
      status: ClassStatus.PLANNED,
      archivedAt: null,
      creationRank: 2,
    });
    expect(refs[2].id).toBe(c);
    // The rank is a number, not the text a bigint would arrive as.
    expect(typeof refs[2].creationRank).toBe("number");
  });

  it("includes the status of each class", async () => {
    await addClass("INFO-A");
    const inProgress = await addClass("INFO-B");
    const completed = await addClass("INFO-C");
    const cancelled = await addClass("INFO-D");
    await service.update(inProgress, { status: ClassStatus.IN_PROGRESS }, actorId);
    await service.update(completed, { status: ClassStatus.COMPLETED }, actorId);
    await service.update(cancelled, { status: ClassStatus.CANCELLED }, actorId);

    const refs = await service.listClassRefs();

    expect(refs.map((ref) => [ref.code, ref.status])).toEqual([
      ["INFO-A", ClassStatus.PLANNED],
      ["INFO-B", ClassStatus.IN_PROGRESS],
      ["INFO-C", ClassStatus.COMPLETED],
      ["INFO-D", ClassStatus.CANCELLED],
    ]);
  });

  it("keeps the rank of an archived class, and shows it only with includeArchived", async () => {
    await addClass("INFO-A");
    const b = await addClass("INFO-B");
    await addClass("INFO-C");

    const before = await service.listClassRefs();
    await service.archive(b, undefined, actorId);

    const active = await service.listClassRefs();
    const all = await service.listClassRefs({ includeArchived: true });

    expect(codesAndRanks(before)).toEqual([
      ["INFO-A", 1],
      ["INFO-B", 2],
      ["INFO-C", 3],
    ]);
    // INFO-C stays 3: archiving INFO-B does not move the classes after it.
    expect(codesAndRanks(active)).toEqual([
      ["INFO-A", 1],
      ["INFO-C", 3],
    ]);
    expect(codesAndRanks(all)).toEqual([
      ["INFO-A", 1],
      ["INFO-B", 2],
      ["INFO-C", 3],
    ]);
    expect(all[1].archivedAt).toBeInstanceOf(Date);
    expect(all[0].archivedAt).toBeNull();
  });

  it("gives a class created after the archived ones the next rank, not a free one", async () => {
    await addClass("INFO-A");
    const b = await addClass("INFO-B");
    await service.archive(b, undefined, actorId);

    await addClass("INFO-C");

    expect(codesAndRanks(await service.listClassRefs({ includeArchived: true }))).toEqual([
      ["INFO-A", 1],
      ["INFO-B", 2],
      ["INFO-C", 3],
    ]);
  });

  it("never shows a class that was soft-deleted, and does not reuse its rank", async () => {
    await addClass("INFO-A");
    const b = await addClass("INFO-B");
    await addClass("INFO-C");
    await dataSource.query(`UPDATE classes SET deleted_at = now() WHERE id = $1`, [b]);

    expect(codesAndRanks(await service.listClassRefs({ includeArchived: true }))).toEqual([
      ["INFO-A", 1],
      ["INFO-C", 3],
    ]);
    await expect(service.listClassRefs({ classId: b, includeArchived: true })).resolves.toEqual([]);
  });

  it("filters by course and keeps the rank each class has among all of them", async () => {
    await addClass("INFO-A");
    await addClass("SEG-B", { courseId: courseY });
    await addClass("INFO-C");
    await addClass("SEG-D", { courseId: courseY });

    expect(codesAndRanks(await service.listClassRefs({ courseId: courseY }))).toEqual([
      ["SEG-B", 2],
      ["SEG-D", 4],
    ]);
    expect(codesAndRanks(await service.listClassRefs({ courseId: courseX }))).toEqual([
      ["INFO-A", 1],
      ["INFO-C", 3],
    ]);
  });

  it("filters by class: one row, with the rank it has among all of them", async () => {
    await addClass("INFO-A");
    await addClass("INFO-B");
    const c = await addClass("INFO-C");

    const refs = await service.listClassRefs({ classId: c });

    expect(codesAndRanks(refs)).toEqual([["INFO-C", 3]]);
    expect(refs[0].id).toBe(c);
  });

  it("finds an archived class by its id only with includeArchived", async () => {
    await addClass("INFO-A");
    const b = await addClass("INFO-B");
    await service.archive(b, undefined, actorId);

    await expect(service.listClassRefs({ classId: b })).resolves.toEqual([]);
    await expect(service.listClassRefs({ classId: b, includeArchived: false })).resolves.toEqual(
      [],
    );
    expect(
      codesAndRanks(await service.listClassRefs({ classId: b, includeArchived: true })),
    ).toEqual([["INFO-B", 2]]);
  });

  it("combines the class and the course: both have to match", async () => {
    const a = await addClass("INFO-A");

    expect(codesAndRanks(await service.listClassRefs({ classId: a, courseId: courseX }))).toEqual([
      ["INFO-A", 1],
    ]);
    await expect(service.listClassRefs({ classId: a, courseId: courseY })).resolves.toEqual([]);
  });

  it("answers an empty list for a class or a course that does not exist", async () => {
    await addClass("INFO-A");

    await expect(service.listClassRefs({ classId: UNKNOWN_ID })).resolves.toEqual([]);
    await expect(service.listClassRefs({ courseId: UNKNOWN_ID })).resolves.toEqual([]);
  });

  it("answers an empty list, not an error, for an id that is not a UUID", async () => {
    await addClass("INFO-A");

    await expect(service.listClassRefs({ classId: "not-a-uuid" })).resolves.toEqual([]);
    await expect(service.listClassRefs({ courseId: "not-a-uuid" })).resolves.toEqual([]);
    await expect(service.listClassRefs({ classId: "" })).resolves.toEqual([]);
  });

  it("matches an id written in upper case, as the database writes it in lower case", async () => {
    const a = await addClass("INFO-A", { courseId: courseY });

    const byClass = await service.listClassRefs({ classId: a.toUpperCase() });
    const byCourse = await service.listClassRefs({ courseId: courseY.toUpperCase() });

    expect(byClass.map((ref) => ref.id)).toEqual([a]);
    expect(byCourse.map((ref) => ref.id)).toEqual([a]);
  });

  it("orders the classes created at the same instant by id, so the rank is always the same", async () => {
    const ids = [
      await addClass("INFO-A"),
      await addClass("INFO-B"),
      await addClass("INFO-C"),
      await addClass("INFO-D"),
    ];
    await dataSource.query(`UPDATE classes SET created_at = $1`, [
      new Date("2026-01-01T12:00:00.000Z"),
    ]);

    const refs = await service.listClassRefs();

    expect(refs.map((ref) => ref.id)).toEqual([...ids].sort());
    expect(refs.map((ref) => ref.creationRank)).toEqual([1, 2, 3, 4]);
  });

  it("writes nothing: the table is the same after the read", async () => {
    await addClass("INFO-A");
    const rowsBefore = await dataSource.query(`SELECT * FROM classes ORDER BY id`);

    await service.listClassRefs({ includeArchived: true });

    expect(await dataSource.query(`SELECT * FROM classes ORDER BY id`)).toEqual(rowsBefore);
  });
});
