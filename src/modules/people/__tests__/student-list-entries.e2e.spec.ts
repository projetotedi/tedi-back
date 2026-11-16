import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { join } from "node:path";
import { DataSource } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { PeopleModule } from "../people.module";
import { PeopleService } from "../services/people.service";
import { StudentsService } from "../services/students.service";
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

// 22:30 in São Paulo on 2026-10-01 is already 2026-10-02 in UTC: the age uses the São Paulo day.
const NOW = new Date("2026-10-02T01:30:00.000Z");

describe("StudentsService.listStudentEntries and findStudentSummaries (e2e)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let studentsService: StudentsService;
  let coordinatorId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          entities: [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
        PeopleModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue({ now: () => NOW })
      .compile();

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    studentsService = module.get(StudentsService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE TABLE student_profiles, people RESTART IDENTITY CASCADE`);
    coordinatorId = (await peopleService.save({ name: "Coordinator" })).id;
  });

  function student(name: string, input: Partial<Parameters<typeof insertStudent>[1]> = {}) {
    return insertStudent(dataSource, { name, createdById: coordinatorId, ...input });
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

  it("lists only the ids asked, ordered by name and id, with age, phone and accessibilityNeed", async () => {
    const maria = await student("Maria Silva", {
      birthDate: "1958-10-02",
      phone: "43999990000",
      accessibilityNeed: "visual",
    });
    const ana = await student("Ana Souza", { birthDate: "1958-10-01" });
    const otherAna = await student("Ana Souza", { birthDate: "1960-01-15" });
    await student("Not asked");

    const page = await studentsService.listStudentEntries(
      { onlyIds: [maria, ana, otherAna] },
      { page: 1, limit: 20 },
    );

    expect(page.total).toBe(3);
    const [firstAna, secondAna] = [ana, otherAna].sort();
    expect(page.data.map((item) => item.id)).toEqual([firstAna, secondAna, maria]);
    // São Paulo day 2026-10-01: born 1958-10-02 is still 67, born 1958-10-01 is 68 today.
    expect(page.data.find((item) => item.id === maria)).toEqual({
      id: maria,
      name: "Maria Silva",
      age: 67,
      phone: "43999990000",
      accessibilityNeed: "visual",
    });
    expect(page.data.find((item) => item.id === ana)).toEqual({
      id: ana,
      name: "Ana Souza",
      age: 68,
      phone: null,
      accessibilityNeed: "none",
    });
  });

  it("leaves out the excluded ids, archived students unless asked and soft-deleted people", async () => {
    const kept = await student("Kept");
    const excluded = await student("Excluded");
    const archived = await student("Archived", { archivedById: coordinatorId });
    const removed = await student("Removed");
    await dataSource.query(`UPDATE people SET deleted_at = now() WHERE id = $1`, [removed]);

    const others = await studentsService.listStudentEntries({ excludeIds: [excluded] }, {});
    expect(others.data.map((item) => item.id)).toEqual([kept]);
    expect(others.total).toBe(1);

    const withArchived = await studentsService.listStudentEntries(
      { onlyIds: [kept, archived, removed], includeArchived: true },
      {},
    );
    expect(withArchived.data.map((item) => item.name)).toEqual(["Archived", "Kept"]);

    // A member (a person without a student profile) is never a student.
    expect((await studentsService.listStudentEntries({ onlyIds: [coordinatorId] }, {})).total).toBe(
      0,
    );
  });

  it("searches by name ignoring case and accents, and counts the total of the filter", async () => {
    // The names differ before any accent, so the order is the same under any collation.
    await student("Ana José");
    await student("Bruno Jose");
    await student("Carla Josefina");
    await student("Maria");

    const first = await studentsService.listStudentEntries(
      { search: "JOSE" },
      { page: 1, limit: 2 },
    );
    expect(first.total).toBe(3);
    expect(first.data.map((item) => item.name)).toEqual(["Ana José", "Bruno Jose"]);

    const second = await studentsService.listStudentEntries(
      { search: "josé" },
      { page: 2, limit: 2 },
    );
    expect(second.data.map((item) => item.name)).toEqual(["Carla Josefina"]);
    expect(second.total).toBe(3);
  });

  it("findStudentSummaries takes FOR SHARE on student_profiles: it waits for a FOR UPDATE on the profile", async () => {
    const maria = await student("Maria Silva");

    // An archive (or an edit) of the student holds the profile FOR UPDATE until it commits.
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(`SELECT id FROM student_profiles WHERE person_id = $1 FOR UPDATE`, [maria]);

    let pending: Promise<unknown> | undefined;
    try {
      // Without forShare the read does not wait (MVCC).
      await expect(studentsService.findStudentSummaries([maria])).resolves.toEqual([
        { id: maria, name: "Maria Silva", archivedAt: null },
      ]);

      pending = dataSource.transaction((manager) =>
        studentsService.findStudentSummaries([maria], manager, { forShare: true }),
      );
      expect(await blockedStatement()).toMatch(/"StudentProfile"/);
      await holder.query(
        `UPDATE student_profiles SET archived_at = now(), archived_by_id = $2 WHERE person_id = $1`,
        [maria, coordinatorId],
      );
    } finally {
      await holder.commitTransaction();
      await holder.release();
    }

    // It reads the row as the archive committed it.
    const [summary] = (await pending) as Array<{ archivedAt: Date | null }>;
    expect(summary.archivedAt).toBeInstanceOf(Date);
  });
});
