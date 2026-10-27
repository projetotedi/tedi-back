import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource, EntityTarget } from "typeorm";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import {
  CLASS_CODE_MAX_LENGTH,
  CLASS_LOCATION_MAX_LENGTH,
  CLASS_NAME_MAX_LENGTH,
  EDITION_NAME_MAX_LENGTH,
} from "../dto/class-limits";
import { SchoolClass } from "../entities/class.entity";
import { Edition } from "../entities/edition.entity";
import { ClassStatus } from "../enums/class-status.enum";

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

// Postgres udt_name for each TypeORM column type used by the entities.
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

function byName(a: ColumnShape, b: ColumnShape): number {
  return a.name.localeCompare(b.name);
}

describe("classes repository (e2e)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;

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
      ],
    }).compile();

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE classes, editions, course_prerequisites, courses, people RESTART IDENTITY CASCADE`,
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

  async function createActor(name = "Director") {
    return peopleService.save({ name });
  }

  /** A course straight in the table: it is schema data here, not a rule of the catalog. */
  async function createCourse(createdById: string, name = "Informática Básica"): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO courses (id, name, description, category, created_by_id)
       VALUES (gen_random_uuid(), $2, 'Fundamentos do uso do computador.', 'basic', $1)
       RETURNING id`,
      [createdById, name],
    );
    return rows[0].id;
  }

  function createEdition(name = "2026.1") {
    const repository = dataSource.getRepository(Edition);
    return repository.save(repository.create({ name }));
  }

  function createClass(
    ids: { courseId: string; editionId: string; createdById: string },
    overrides: Partial<SchoolClass> = {},
  ) {
    const repository = dataSource.getRepository(SchoolClass);
    return repository.save(
      repository.create({
        code: "INFO-A",
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        capacity: 15,
        ...ids,
        ...overrides,
      }),
    );
  }

  /** The three rows a class needs: its author, its course and its edition. */
  async function setUp(editionName = "2026.1") {
    const actor = await createActor();
    const courseId = await createCourse(actor.id);
    const edition = await createEdition(editionName);
    return {
      actor,
      courseId,
      edition,
      ids: { courseId, editionId: edition.id, createdById: actor.id },
    };
  }

  describe("schema vs entities", () => {
    it("matches the entity metadata column by column (name, type, length, nullability)", async () => {
      expect(await actualColumns("classes")).toEqual(declaredColumns(SchoolClass));
      expect(await actualColumns("editions")).toEqual(declaredColumns(Edition));
    });

    it("has the enum type classes_status_enum with the values of ClassStatus, in order", async () => {
      const rows: Array<{ enumlabel: string }> = await dataSource.query(
        `SELECT e.enumlabel
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'classes_status_enum'
          ORDER BY e.enumsortorder`,
      );

      expect(rows.map((row) => row.enumlabel)).toEqual([
        "planned",
        "in_progress",
        "completed",
        "cancelled",
      ]);
      expect(rows.map((row) => row.enumlabel)).toEqual(Object.values(ClassStatus));
    });

    it("has the named foreign keys of classes to courses, editions and people", async () => {
      const declared = declaredForeignKeys(SchoolClass);

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_classes_archived_by_id",
        "fk_classes_course_id",
        "fk_classes_created_by_id",
        "fk_classes_edition_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.column_name)).toEqual([
        "archived_by_id",
        "course_id",
        "created_by_id",
        "edition_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "people",
        "courses",
        "people",
        "editions",
      ]);
      expect(await actualForeignKeys("classes")).toEqual(declared);
    });

    it("has no foreign key in editions", async () => {
      expect(declaredForeignKeys(Edition)).toEqual([]);
      expect(await actualForeignKeys("editions")).toEqual([]);
    });

    it("has the unique index uq_editions_name on (name) and idx_classes_course_id on (course_id), both declared by the entities", async () => {
      expect(
        dataSource.getMetadata(Edition).indices.map((index) => ({
          name: index.name,
          unique: index.isUnique,
          columns: index.columns.map((column) => column.databaseName),
        })),
      ).toEqual([{ name: "uq_editions_name", unique: true, columns: ["name"] }]);
      // The only index SchoolClass declares: the one on (edition_id, lower(code)) is an expression.
      expect(
        dataSource.getMetadata(SchoolClass).indices.map((index) => ({
          name: index.name,
          unique: index.isUnique,
          columns: index.columns.map((column) => column.databaseName),
        })),
      ).toEqual([{ name: "idx_classes_course_id", unique: false, columns: ["course_id"] }]);

      const unique = await indexDefinition("editions", "uq_editions_name");
      expect(unique).toHaveLength(1);
      expect(unique[0]).toContain("CREATE UNIQUE INDEX");
      expect(unique[0]).toMatch(/\(name\)/);

      const simple = await indexDefinition("classes", "idx_classes_course_id");
      expect(simple).toHaveLength(1);
      expect(simple[0]).not.toContain("UNIQUE");
      expect(simple[0]).toMatch(/\(course_id\)/);
    });

    it("has the unique index uq_classes_edition_id_code on (edition_id, lower(code))", async () => {
      // The code is unique inside its edition ignoring case: the index is on lower(code), not on
      // code. It is an expression index, which SchoolClass cannot declare (see its JSDoc), so this
      // is where it is checked.
      const definition = await indexDefinition("classes", "uq_classes_edition_id_code");

      expect(definition).toHaveLength(1);
      expect(definition[0]).toContain("CREATE UNIQUE INDEX");
      expect(definition[0]).toMatch(/\(edition_id, lower\(.*code.*\)\)/i);
    });

    it("has the check constraints ck_classes_capacity_positive and ck_classes_period declared by the entity", async () => {
      const declared = dataSource
        .getMetadata(SchoolClass)
        .checks.map((check) => ({ name: check.name, expression: check.expression }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      expect(declared).toEqual([
        { name: "ck_classes_capacity_positive", expression: '"capacity" > 0' },
        { name: "ck_classes_period", expression: '"end_date" >= "start_date"' },
      ]);

      const actual: Array<{ conname: string; definition: string }> = await dataSource.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'classes'::regclass AND contype = 'c'
          ORDER BY conname`,
      );
      expect(actual.map((check) => check.conname)).toEqual([
        "ck_classes_capacity_positive",
        "ck_classes_period",
      ]);
      expect(actual[0].definition).toMatch(/capacity\s*>\s*0/);
      expect(actual[1].definition).toMatch(/end_date\s*>=\s*start_date/);
    });

    it("keeps the limits of the DTOs equal to the length of the columns", async () => {
      // A DTO that accepts more than the column holds would turn into a 500 at the insert.
      const lengths = async (table: string) =>
        Object.fromEntries(
          (await actualColumns(table)).map((column) => [column.name, column.length]),
        );

      const classes = await lengths("classes");
      expect(classes.code).toBe(CLASS_CODE_MAX_LENGTH);
      expect(classes.name).toBe(CLASS_NAME_MAX_LENGTH);
      expect(classes.location).toBe(CLASS_LOCATION_MAX_LENGTH);
      expect((await lengths("editions")).name).toBe(EDITION_NAME_MAX_LENGTH);
    });
  });

  describe("constraints", () => {
    it("rejects two codes that differ only in case in the same edition with 23505 on uq_classes_edition_id_code", async () => {
      const { ids } = await setUp();
      await createClass(ids, { code: "INFO-A" });

      await expect(createClass(ids, { code: "INFO-A" })).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_classes_edition_id_code",
      });
      await expect(createClass(ids, { code: "info-a" })).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_classes_edition_id_code",
      });
      // A different code is fine.
      await createClass(ids, { code: "INFO-B" });
    });

    it("accepts the same code in another edition", async () => {
      const { ids } = await setUp("2026.1");
      const nextEdition = await createEdition("2026.2");
      await createClass(ids, { code: "INFO-A" });

      const other = await createClass({ ...ids, editionId: nextEdition.id }, { code: "INFO-A" });

      expect(other.editionId).toBe(nextEdition.id);
    });

    it("counts an archived class when it rejects a repeated code", async () => {
      const { actor, ids } = await setUp();
      await createClass(ids, {
        code: "INFO-A",
        archive: { archivedAt: new Date(), archivedById: actor.id, archiveReason: null },
      });

      await expect(createClass(ids, { code: "info-a" })).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_classes_edition_id_code",
      });
    });

    it("rejects an edition name that already exists with 23505 on uq_editions_name", async () => {
      await createEdition("2026.1");

      await expect(createEdition("2026.1")).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_editions_name",
      });
      await createEdition("2026.2");
    });

    it("rejects a period that ends before it starts with 23514 on ck_classes_period, and accepts one that starts and ends on the same day", async () => {
      const { ids } = await setUp();

      await expect(
        createClass(ids, { startDate: "2026-06-27", endDate: "2026-03-03" }),
      ).rejects.toMatchObject({ code: "23514", constraint: "ck_classes_period" });

      const oneDay = await createClass(ids, { startDate: "2026-03-03", endDate: "2026-03-03" });
      expect(oneDay.id).toBeDefined();
    });

    it("rejects zero or negative seats with 23514 on ck_classes_capacity_positive", async () => {
      const { ids } = await setUp();

      await expect(createClass(ids, { capacity: 0 })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_classes_capacity_positive",
      });
      await expect(createClass(ids, { capacity: -1 })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_classes_capacity_positive",
      });
      await createClass(ids, { capacity: 1 });
    });

    it("rejects a course that does not exist with 23503 on fk_classes_course_id", async () => {
      const { ids } = await setUp();

      await expect(createClass({ ...ids, courseId: UNKNOWN_ID })).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_classes_course_id",
      });
    });

    it("rejects an edition that does not exist with 23503 on fk_classes_edition_id", async () => {
      const { ids } = await setUp();

      await expect(createClass({ ...ids, editionId: UNKNOWN_ID })).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_classes_edition_id",
      });
    });

    it("rejects a class created by a person that does not exist with 23503 on fk_classes_created_by_id", async () => {
      const { ids } = await setUp();

      await expect(createClass({ ...ids, createdById: UNKNOWN_ID })).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_classes_created_by_id",
      });
    });

    it("rejects a class archived by a person that does not exist with 23503 on fk_classes_archived_by_id", async () => {
      const { ids } = await setUp();

      await expect(
        createClass(ids, {
          archive: { archivedAt: new Date(), archivedById: UNKNOWN_ID, archiveReason: null },
        }),
      ).rejects.toMatchObject({ code: "23503", constraint: "fk_classes_archived_by_id" });
    });

    it("defaults the status to planned when an insert does not say it", async () => {
      const { ids } = await setUp();

      const rows: Array<{ status: string }> = await dataSource.query(
        `INSERT INTO classes (id, code, course_id, edition_id, start_date, end_date, capacity, created_by_id)
         VALUES (gen_random_uuid(), 'INFO-A', $1, $2, '2026-03-03', '2026-06-27', 15, $3)
         RETURNING status`,
        [ids.courseId, ids.editionId, ids.createdById],
      );

      expect(rows[0].status).toBe("planned");
    });

    it("rejects a status outside the enum with 22P02", async () => {
      const { ids } = await setUp();

      await expect(
        dataSource.query(
          `INSERT INTO classes (id, code, course_id, edition_id, start_date, end_date, capacity, status, created_by_id)
           VALUES (gen_random_uuid(), 'INFO-A', $1, $2, '2026-03-03', '2026-06-27', 15, 'open', $3)`,
          [ids.courseId, ids.editionId, ids.createdById],
        ),
      ).rejects.toMatchObject({ code: "22P02" });
    });

    it("rejects a class without a code, a period or seats with 23502", async () => {
      const { ids } = await setUp();

      for (const column of ["code", "start_date", "end_date", "capacity"]) {
        const values: Record<string, string> = {
          code: "'INFO-A'",
          start_date: "'2026-03-03'",
          end_date: "'2026-06-27'",
          capacity: "15",
          [column]: "NULL",
        };

        await expect(
          dataSource.query(
            `INSERT INTO classes (id, code, course_id, edition_id, start_date, end_date, capacity, created_by_id)
             VALUES (gen_random_uuid(), ${values.code}, $1, $2, ${values.start_date}, ${values.end_date}, ${values.capacity}, $3)`,
            [ids.courseId, ids.editionId, ids.createdById],
          ),
        ).rejects.toMatchObject({ code: "23502", column });
      }
    });
  });

  describe("round trip", () => {
    it("round-trips every SchoolClass field, with the dates as YYYY-MM-DD strings and the archive columns", async () => {
      const { actor, ids, edition } = await setUp();
      const archivedAt = new Date("2026-10-10T12:00:00.000Z");

      const saved = await createClass(ids, {
        code: "INFO-A",
        name: "Informática Básica, turma A",
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        location: "Laboratório 3, bloco B",
        capacity: 15,
        status: ClassStatus.IN_PROGRESS,
        archive: { archivedAt, archivedById: actor.id, archiveReason: "Turma encerrada." },
      });

      const loaded = await dataSource.getRepository(SchoolClass).findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        code: "INFO-A",
        name: "Informática Básica, turma A",
        courseId: ids.courseId,
        editionId: edition.id,
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        location: "Laboratório 3, bloco B",
        capacity: 15,
        status: ClassStatus.IN_PROGRESS,
        createdById: actor.id,
        deletedAt: null,
      });
      expect(typeof loaded.startDate).toBe("string");
      expect(typeof loaded.endDate).toBe("string");
      expect(loaded.archive.archivedAt).toEqual(archivedAt);
      expect(loaded.archive.archivedById).toBe(actor.id);
      expect(loaded.archive.archiveReason).toBe("Turma encerrada.");
      expect(loaded.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("keeps name, location and the archive columns null and the status planned for a bare class", async () => {
      const { ids } = await setUp();

      const saved = await createClass(ids);

      const loaded = await dataSource.getRepository(SchoolClass).findOneByOrFail({ id: saved.id });
      expect(loaded.name).toBeNull();
      expect(loaded.location).toBeNull();
      expect(loaded.status).toBe(ClassStatus.PLANNED);
      expect(loaded.archive).toMatchObject({
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });
    });

    it("stores each status and reads it back as the enum value", async () => {
      const { ids } = await setUp();

      for (const status of Object.values(ClassStatus)) {
        const saved = await createClass(ids, { code: `INFO-${status}`, status });

        const loaded = await dataSource
          .getRepository(SchoolClass)
          .findOneByOrFail({ id: saved.id });
        expect(loaded.status).toBe(status);
      }
    });

    it("round-trips an edition", async () => {
      const saved = await createEdition("2026.2");

      const loaded = await dataSource.getRepository(Edition).findOneByOrFail({ id: saved.id });

      expect(loaded.name).toBe("2026.2");
      expect(loaded.deletedAt).toBeNull();
      expect(loaded.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });
});
