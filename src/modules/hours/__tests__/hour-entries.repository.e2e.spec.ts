import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource, EntityTarget } from "typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { CourseCategory, CoursesService } from "@modules/catalog/services/courses.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { HOUR_ENTRY_ACTIVITY_MAX_LENGTH, HOUR_ENTRY_MAX_MINUTES } from "../dto/hour-entry-limits";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";

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

/**
 * Every entity: the foreign keys of HourEntry point to "people", "classes" and "lessons" by table
 * name, and that only resolves when those entities are loaded too.
 */
const ALL_ENTITIES = [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")];

/** Attendance takes any author, so an unknown person or author breaks only its foreign key. */
const ATTENDANCE = { origin: HourEntryOrigin.ATTENDANCE };

/** Postgres udt_name for each TypeORM column type used by the entities. */
const UDT_NAME: Record<string, string> = {
  uuid: "uuid",
  varchar: "varchar",
  text: "text",
  timestamptz: "timestamptz",
  date: "date",
  integer: "int4",
};

interface ColumnShape {
  name: string;
  type: string;
  length: number | null;
  nullable: boolean;
}

interface ForeignKeyShape {
  constraint_name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
  delete_rule: string | undefined;
  update_rule: string | undefined;
}

interface Scenery {
  memberId: string;
  directorId: string;
  classId: string;
}

function byName(a: ColumnShape, b: ColumnShape): number {
  return a.name.localeCompare(b.name);
}

describe("hour entries repository (e2e)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let coursesService: CoursesService;
  let classesService: ClassesService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          entities: ALL_ENTITIES,
          synchronize: false,
          migrationsRun: false,
        }),
        PeopleModule,
        CatalogModule,
        ClassesModule,
      ],
    }).compile();

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    coursesService = module.get(CoursesService);
    classesService = module.get(ClassesService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE hour_entry_events, hour_entries, lessons, classes, editions,
                      course_lesson_plans, lesson_plan_contents, lesson_plans,
                      course_prerequisites, courses, people
       RESTART IDENTITY CASCADE`,
    );
  });

  /** What the entity declares. TypeORM keeps `length` as a string ("200") and "" when unset. */
  function declaredColumns(entity: EntityTarget<unknown>): ColumnShape[] {
    return dataSource
      .getMetadata(entity)
      .columns.map((column) => ({
        name: column.databaseName,
        type: column.type === "enum" ? (column.enumName ?? "") : UDT_NAME[String(column.type)],
        length: column.length ? Number(column.length) : null,
        nullable: column.isNullable,
      }))
      .sort(byName);
  }

  /** What the migrations created. is_nullable is YES or NO and the length may be null. */
  async function actualColumns(table: string): Promise<ColumnShape[]> {
    const rows: Array<{
      column_name: string;
      udt_name: string;
      character_maximum_length: number | null;
      is_nullable: "YES" | "NO";
    }> = await dataSource.query(
      `SELECT column_name, udt_name, character_maximum_length, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    return rows
      .map((row) => ({
        name: row.column_name,
        type: row.udt_name,
        length: row.character_maximum_length ?? null,
        nullable: row.is_nullable === "YES",
      }))
      .sort(byName);
  }

  async function actualForeignKeys(table: string): Promise<ForeignKeyShape[]> {
    return dataSource.query(
      `SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS referenced_table,
              ccu.column_name AS referenced_column, rc.delete_rule, rc.update_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
          AND tc.table_name = $1
        ORDER BY tc.constraint_name`,
      [table],
    );
  }

  function declaredForeignKeys(entity: EntityTarget<unknown>): ForeignKeyShape[] {
    return dataSource
      .getMetadata(entity)
      .foreignKeys.map((foreignKey) => ({
        constraint_name: foreignKey.name,
        column_name: foreignKey.columnNames[0],
        referenced_table: foreignKey.referencedTablePath,
        referenced_column: foreignKey.referencedColumnNames[0],
        delete_rule: foreignKey.onDelete,
        update_rule: foreignKey.onUpdate,
      }))
      .sort((a, b) => a.constraint_name.localeCompare(b.constraint_name));
  }

  async function indexDefinition(table: string, name: string): Promise<string[]> {
    const rows: Array<{ indexdef: string }> = await dataSource.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2`,
      [table, name],
    );
    return rows.map((row) => row.indexdef);
  }

  async function checkDefinitions(table: string): Promise<Record<string, string>> {
    const rows: Array<{ conname: string; definition: string }> = await dataSource.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = $1::regclass AND contype = 'c'`,
      [table],
    );
    return Object.fromEntries(rows.map((row) => [row.conname, row.definition]));
  }

  async function enumLabels(typeName: string): Promise<string[]> {
    const rows: Array<{ enumlabel: string }> = await dataSource.query(
      `SELECT e.enumlabel
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1
        ORDER BY e.enumsortorder`,
      [typeName],
    );
    return rows.map((row) => row.enumlabel);
  }

  /**
   * The people of an entry (the member and a director who logs on her behalf) and a class. They
   * come from the services the other modules export, not from their tables: it is scenery here. No
   * lesson: the lessons module exports nothing, so `lesson_id` is only exercised by its foreign key.
   */
  async function setUp(): Promise<Scenery> {
    const member = await peopleService.save({ name: "Member" });
    const director = await peopleService.save({ name: "Director" });
    const course = await coursesService.create(
      {
        name: "Informática Básica",
        description: "Fundamentos do uso do computador.",
        category: CourseCategory.BASIC,
      },
      director.id,
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
      director.id,
    );

    return { memberId: member.id, directorId: director.id, classId: schoolClass.id };
  }

  /** A pending manual entry of the member, logged by herself, unless `overrides` says otherwise. */
  function createEntry(scenery: Scenery, overrides: Partial<HourEntry> = {}): Promise<HourEntry> {
    const repository = dataSource.getRepository(HourEntry);
    return repository.save(
      repository.create({
        personId: scenery.memberId,
        createdById: scenery.memberId,
        origin: HourEntryOrigin.MANUAL,
        activity: "Planejamento da aula de teclado e mouse",
        category: HourEntryCategory.PLANNING,
        date: "2026-03-10",
        declaredMinutes: 150,
        ...overrides,
      }),
    );
  }

  function createEvent(
    entry: HourEntry,
    overrides: Partial<HourEntryEvent> = {},
  ): Promise<HourEntryEvent> {
    const repository = dataSource.getRepository(HourEntryEvent);
    return repository.save(
      repository.create({
        hourEntryId: entry.id,
        type: HourEntryEventType.CREATED,
        actorId: entry.createdById,
        toStatus: HourEntryStatus.PENDING,
        toMinutes: entry.declaredMinutes,
        ...overrides,
      }),
    );
  }

  describe("schema vs entities", () => {
    it("matches the entity metadata column by column for hour_entries (name, type, length, nullability)", async () => {
      expect(await actualColumns("hour_entries")).toEqual(declaredColumns(HourEntry));
    });

    it("matches the entity metadata column by column for hour_entry_events", async () => {
      expect(await actualColumns("hour_entry_events")).toEqual(declaredColumns(HourEntryEvent));
    });

    it("has the four enum types with the values of the TypeScript enums, in order", async () => {
      expect(await enumLabels("hour_entries_category_enum")).toEqual(
        Object.values(HourEntryCategory),
      );
      expect(await enumLabels("hour_entries_status_enum")).toEqual(Object.values(HourEntryStatus));
      expect(await enumLabels("hour_entries_origin_enum")).toEqual(Object.values(HourEntryOrigin));
      expect(await enumLabels("hour_entry_events_type_enum")).toEqual(
        Object.values(HourEntryEventType),
      );
    });

    it("has the named foreign keys of hour_entries to people, classes and lessons", async () => {
      const declared = declaredForeignKeys(HourEntry);

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_hour_entries_class_id",
        "fk_hour_entries_created_by_id",
        "fk_hour_entries_lesson_id",
        "fk_hour_entries_person_id",
        "fk_hour_entries_reviewed_by_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "classes",
        "people",
        "lessons",
        "people",
        "people",
      ]);
      expect(await actualForeignKeys("hour_entries")).toEqual(declared);
    });

    it("has the named foreign keys of hour_entry_events to hour_entries and people", async () => {
      const declared = declaredForeignKeys(HourEntryEvent);

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_hour_entry_events_actor_id",
        "fk_hour_entry_events_hour_entry_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "people",
        "hour_entries",
      ]);
      expect(await actualForeignKeys("hour_entry_events")).toEqual(declared);
    });

    it("has idx_hour_entries_person_id_date and idx_hour_entry_events_hour_entry_id, declared by the entities", async () => {
      const indicesOf = (entity: EntityTarget<unknown>) =>
        dataSource.getMetadata(entity).indices.map((index) => ({
          name: index.name,
          unique: index.isUnique,
          columns: index.columns.map((column) => column.databaseName),
        }));

      expect(indicesOf(HourEntry)).toEqual([
        { name: "idx_hour_entries_person_id_date", unique: false, columns: ["person_id", "date"] },
      ]);
      expect(indicesOf(HourEntryEvent)).toEqual([
        {
          name: "idx_hour_entry_events_hour_entry_id",
          unique: false,
          columns: ["hour_entry_id"],
        },
      ]);

      const entries = await indexDefinition("hour_entries", "idx_hour_entries_person_id_date");
      expect(entries).toHaveLength(1);
      expect(entries[0]).not.toContain("UNIQUE");
      expect(entries[0]).toMatch(/\(person_id, date\)/);

      const events = await indexDefinition(
        "hour_entry_events",
        "idx_hour_entry_events_hour_entry_id",
      );
      expect(events).toHaveLength(1);
      expect(events[0]).not.toContain("UNIQUE");
      expect(events[0]).toMatch(/\(hour_entry_id\)/);
    });

    it("has the four check constraints declared by HourEntry", async () => {
      const declared = dataSource
        .getMetadata(HourEntry)
        .checks.map((check) => ({ name: check.name, expression: check.expression }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      expect(declared).toEqual([
        {
          name: "ck_hour_entries_declared_minutes",
          expression: '"declared_minutes" > 0 AND "declared_minutes" <= 1440',
        },
        {
          name: "ck_hour_entries_origin_author",
          expression: `"origin" = 'attendance' OR (("origin" = 'manual') = ("created_by_id" = "person_id"))`,
        },
        {
          name: "ck_hour_entries_pending_not_validated",
          expression: `"status" <> 'pending' OR "validated_minutes" IS NULL`,
        },
        {
          name: "ck_hour_entries_validated_minutes",
          expression:
            '"validated_minutes" IS NULL OR ("validated_minutes" >= 0 AND "validated_minutes" <= 1440)',
        },
      ]);
      expect(dataSource.getMetadata(HourEntryEvent).checks).toEqual([]);

      const definitions = await checkDefinitions("hour_entries");
      expect(Object.keys(definitions).sort()).toEqual(declared.map((check) => check.name));
      expect(definitions.ck_hour_entries_declared_minutes).toMatch(/declared_minutes > 0/);
      expect(definitions.ck_hour_entries_declared_minutes).toMatch(/declared_minutes <= 1440/);
      expect(definitions.ck_hour_entries_validated_minutes).toMatch(/validated_minutes IS NULL/);
      expect(definitions.ck_hour_entries_validated_minutes).toMatch(/validated_minutes >= 0/);
      expect(definitions.ck_hour_entries_pending_not_validated).toMatch(/'pending'/);
      expect(definitions.ck_hour_entries_origin_author).toMatch(/'attendance'/);
      expect(definitions.ck_hour_entries_origin_author).toMatch(/created_by_id = person_id/);
      expect(await checkDefinitions("hour_entry_events")).toEqual({});
    });

    it("keeps the limits of the DTO equal to the columns and the checks, so the DTO never lets through what the database refuses", async () => {
      const entryLengths = Object.fromEntries(
        (await actualColumns("hour_entries")).map((column) => [column.name, column.length]),
      );
      const eventLengths = Object.fromEntries(
        (await actualColumns("hour_entry_events")).map((column) => [column.name, column.length]),
      );

      expect(entryLengths.activity).toBe(HOUR_ENTRY_ACTIVITY_MAX_LENGTH);
      expect(entryLengths.notes).toBeNull();
      expect(entryLengths.review_note).toBeNull();
      expect(eventLengths.note).toBeNull();

      const definitions = await checkDefinitions("hour_entries");
      expect(definitions.ck_hour_entries_declared_minutes).toContain(
        `<= ${HOUR_ENTRY_MAX_MINUTES}`,
      );
      expect(definitions.ck_hour_entries_validated_minutes).toContain(
        `<= ${HOUR_ENTRY_MAX_MINUTES}`,
      );
    });

    it("has the append-only trigger on hour_entry_events", async () => {
      const triggersOf = async (table: string): Promise<string[]> => {
        const rows: Array<{ tgname: string }> = await dataSource.query(
          `SELECT tgname FROM pg_trigger
            WHERE tgrelid = $1::regclass AND NOT tgisinternal
            ORDER BY tgname`,
          [table],
        );
        return rows.map((row) => row.tgname);
      };

      expect(await triggersOf("hour_entry_events")).toEqual(["trg_hour_entry_events_append_only"]);
      expect(await triggersOf("hour_entries")).toEqual([]);
    });
  });

  describe("constraints", () => {
    it("rejects declared minutes of 0 or above 1440 with 23514 on ck_hour_entries_declared_minutes", async () => {
      const scenery = await setUp();

      for (const declaredMinutes of [0, -1, 1441]) {
        await expect(createEntry(scenery, { declaredMinutes })).rejects.toMatchObject({
          code: "23514",
          constraint: "ck_hour_entries_declared_minutes",
        });
      }
      await createEntry(scenery, { declaredMinutes: 1 });
      await createEntry(scenery, { declaredMinutes: 1440 });
    });

    it("rejects validated minutes below 0 or above 1440 with 23514 on ck_hour_entries_validated_minutes", async () => {
      const scenery = await setUp();
      const reviewed = {
        status: HourEntryStatus.ADJUSTED,
        reviewedById: scenery.directorId,
        reviewedAt: new Date(),
      };

      for (const validatedMinutes of [-1, 1441]) {
        await expect(createEntry(scenery, { ...reviewed, validatedMinutes })).rejects.toMatchObject(
          { code: "23514", constraint: "ck_hour_entries_validated_minutes" },
        );
      }
      await createEntry(scenery, { ...reviewed, validatedMinutes: 0 });
      await createEntry(scenery, { ...reviewed, validatedMinutes: 1440 });
    });

    it("rejects a pending entry with validated minutes with 23514 on ck_hour_entries_pending_not_validated", async () => {
      const scenery = await setUp();

      await expect(
        createEntry(scenery, { status: HourEntryStatus.PENDING, validatedMinutes: 150 }),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_hour_entries_pending_not_validated",
      });

      for (const status of [
        HourEntryStatus.APPROVED,
        HourEntryStatus.ADJUSTED,
        HourEntryStatus.REJECTED,
      ]) {
        await createEntry(scenery, { status, validatedMinutes: 150 });
      }
    });

    it("rejects a manual entry created by someone else, and an on_behalf entry created by the person herself, with 23514 on ck_hour_entries_origin_author; attendance takes either", async () => {
      const scenery = await setUp();

      await expect(
        createEntry(scenery, { origin: HourEntryOrigin.MANUAL, createdById: scenery.directorId }),
      ).rejects.toMatchObject({ code: "23514", constraint: "ck_hour_entries_origin_author" });
      await expect(
        createEntry(scenery, { origin: HourEntryOrigin.ON_BEHALF, createdById: scenery.memberId }),
      ).rejects.toMatchObject({ code: "23514", constraint: "ck_hour_entries_origin_author" });

      await createEntry(scenery, { origin: HourEntryOrigin.MANUAL, createdById: scenery.memberId });
      await createEntry(scenery, {
        origin: HourEntryOrigin.ON_BEHALF,
        createdById: scenery.directorId,
      });
      await createEntry(scenery, {
        origin: HourEntryOrigin.ATTENDANCE,
        createdById: scenery.directorId,
      });
      await createEntry(scenery, {
        origin: HourEntryOrigin.ATTENDANCE,
        createdById: scenery.memberId,
      });
    });

    it("rejects an unknown person, author, reviewer, class and lesson with 23503 on their named foreign keys", async () => {
      const scenery = await setUp();

      await expect(
        createEntry(scenery, { ...ATTENDANCE, personId: UNKNOWN_ID }),
      ).rejects.toMatchObject({ code: "23503", constraint: "fk_hour_entries_person_id" });
      await expect(
        createEntry(scenery, { ...ATTENDANCE, createdById: UNKNOWN_ID }),
      ).rejects.toMatchObject({ code: "23503", constraint: "fk_hour_entries_created_by_id" });
      await expect(
        createEntry(scenery, {
          status: HourEntryStatus.APPROVED,
          validatedMinutes: 150,
          reviewedById: UNKNOWN_ID,
          reviewedAt: new Date(),
        }),
      ).rejects.toMatchObject({ code: "23503", constraint: "fk_hour_entries_reviewed_by_id" });
      await expect(
        createEntry(scenery, { ...ATTENDANCE, classId: UNKNOWN_ID }),
      ).rejects.toMatchObject({ code: "23503", constraint: "fk_hour_entries_class_id" });
      await expect(
        createEntry(scenery, { ...ATTENDANCE, lessonId: UNKNOWN_ID }),
      ).rejects.toMatchObject({ code: "23503", constraint: "fk_hour_entries_lesson_id" });
    });

    it("rejects an event of an unknown entry or by an unknown actor with 23503 on their named foreign keys", async () => {
      const scenery = await setUp();
      const entry = await createEntry(scenery);

      await expect(createEvent(entry, { hourEntryId: UNKNOWN_ID })).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_hour_entry_events_hour_entry_id",
      });
      await expect(createEvent(entry, { actorId: UNKNOWN_ID })).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_hour_entry_events_actor_id",
      });
    });

    it("defaults the status to pending when an insert does not say it", async () => {
      const scenery = await setUp();

      const rows: Array<{ status: string; validated_minutes: number | null }> =
        await dataSource.query(
          `INSERT INTO hour_entries
             (id, person_id, activity, category, date, declared_minutes, origin, created_by_id)
           VALUES (gen_random_uuid(), $1, 'Planejamento', 'planning', '2026-03-10', 150, 'manual', $1)
           RETURNING status, validated_minutes`,
          [scenery.memberId],
        );

      expect(rows[0]).toEqual({ status: "pending", validated_minutes: null });
    });

    it("rejects UPDATE and DELETE on hour_entry_events with 23001: the history is append-only", async () => {
      const scenery = await setUp();
      const entry = await createEntry(scenery);
      const event = await createEvent(entry);

      await expect(
        dataSource.query(`UPDATE hour_entry_events SET note = 'edited' WHERE id = $1`, [event.id]),
      ).rejects.toMatchObject({ code: "23001" });
      await expect(
        dataSource.query(`DELETE FROM hour_entry_events WHERE id = $1`, [event.id]),
      ).rejects.toMatchObject({ code: "23001" });
      await expect(
        dataSource.getRepository(HourEntryEvent).softDelete({ id: event.id }),
      ).rejects.toMatchObject({ code: "23001" });

      const rows: Array<{ note: string | null; deleted_at: Date | null }> = await dataSource.query(
        `SELECT note, deleted_at FROM hour_entry_events WHERE id = $1`,
        [event.id],
      );
      expect(rows).toEqual([{ note: null, deleted_at: null }]);
    });

    it("rejects deleting an hour entry that has events with 23503: the history keeps its entry", async () => {
      const scenery = await setUp();
      const entry = await createEntry(scenery);
      await createEvent(entry);

      await expect(
        dataSource.query(`DELETE FROM hour_entries WHERE id = $1`, [entry.id]),
      ).rejects.toMatchObject({ code: "23503", constraint: "fk_hour_entry_events_hour_entry_id" });
    });
  });

  describe("round trip", () => {
    it("round-trips every HourEntry field, with the date as YYYY-MM-DD and the minutes as numbers", async () => {
      const scenery = await setUp();
      const reviewedAt = new Date("2026-03-12T13:00:00.000Z");

      const saved = await createEntry(scenery, {
        createdById: scenery.directorId,
        origin: HourEntryOrigin.ON_BEHALF,
        activity: "Reunião de planejamento do semestre",
        category: HourEntryCategory.MEETING,
        date: "2026-03-11",
        declaredMinutes: 90,
        validatedMinutes: 60,
        notes: "Pauta: calendário das turmas.",
        status: HourEntryStatus.ADJUSTED,
        classId: scenery.classId,
        reviewNote: "A reunião durou uma hora.",
        reviewedById: scenery.directorId,
        reviewedAt,
      });

      const loaded = await dataSource.getRepository(HourEntry).findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        personId: scenery.memberId,
        createdById: scenery.directorId,
        origin: HourEntryOrigin.ON_BEHALF,
        activity: "Reunião de planejamento do semestre",
        category: HourEntryCategory.MEETING,
        date: "2026-03-11",
        declaredMinutes: 90,
        validatedMinutes: 60,
        notes: "Pauta: calendário das turmas.",
        status: HourEntryStatus.ADJUSTED,
        classId: scenery.classId,
        lessonId: null,
        reviewNote: "A reunião durou uma hora.",
        reviewedById: scenery.directorId,
        deletedAt: null,
      });
      expect(typeof loaded.date).toBe("string");
      expect(typeof loaded.declaredMinutes).toBe("number");
      expect(typeof loaded.validatedMinutes).toBe("number");
      expect(loaded.reviewedAt).toEqual(reviewedAt);
      expect(loaded.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("keeps the optional columns null and the status pending for a bare entry", async () => {
      const scenery = await setUp();

      const saved = await createEntry(scenery);

      const loaded = await dataSource.getRepository(HourEntry).findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        status: HourEntryStatus.PENDING,
        validatedMinutes: null,
        notes: null,
        classId: null,
        lessonId: null,
        reviewNote: null,
        reviewedById: null,
        reviewedAt: null,
      });
    });

    it("round-trips every HourEntryEvent field, with the instant given by the caller and not the now() of the database", async () => {
      const scenery = await setUp();
      const entry = await createEntry(scenery);
      const createdAt = new Date("2026-03-12T13:00:00.000Z");

      const saved = await createEvent(entry, {
        type: HourEntryEventType.ADJUSTED,
        actorId: scenery.directorId,
        fromStatus: HourEntryStatus.PENDING,
        toStatus: HourEntryStatus.ADJUSTED,
        fromMinutes: 150,
        toMinutes: 120,
        note: "A reunião durou duas horas.",
        createdAt,
        updatedAt: createdAt,
      });

      const loaded = await dataSource
        .getRepository(HourEntryEvent)
        .findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        hourEntryId: entry.id,
        type: HourEntryEventType.ADJUSTED,
        actorId: scenery.directorId,
        fromStatus: HourEntryStatus.PENDING,
        toStatus: HourEntryStatus.ADJUSTED,
        fromMinutes: 150,
        toMinutes: 120,
        note: "A reunião durou duas horas.",
        deletedAt: null,
      });
      expect(loaded.createdAt).toEqual(createdAt);
      expect(loaded.updatedAt).toEqual(createdAt);
    });

    it("hides a soft-deleted entry from find and query builders, and shows it with withDeleted", async () => {
      const scenery = await setUp();
      const entry = await createEntry(scenery);
      const deletedAt = new Date("2026-03-12T13:00:00.000Z");
      const repository = dataSource.getRepository(HourEntry);

      await repository.update({ id: entry.id }, { deletedAt });

      expect(await repository.findOneBy({ id: entry.id })).toBeNull();
      expect(
        await repository
          .createQueryBuilder("entry")
          .where("entry.id = :id", { id: entry.id })
          .getMany(),
      ).toEqual([]);

      const withDeleted = await repository.findOne({ where: { id: entry.id }, withDeleted: true });
      expect(withDeleted?.deletedAt).toEqual(deletedAt);
    });
  });
});
