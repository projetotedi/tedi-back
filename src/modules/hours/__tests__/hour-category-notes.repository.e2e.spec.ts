import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource, QueryFailedError } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import {
  HOUR_CATEGORY_NOTE_MAX_LENGTH,
  HourCategoryNote,
} from "../entities/hour-category-note.entity";

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

const UDT_NAME: Record<string, string> = {
  uuid: "uuid",
  varchar: "varchar",
  timestamptz: "timestamptz",
};

interface ColumnShape {
  name: string;
  type: string;
  length: number | null;
  nullable: boolean;
}

function byName(a: ColumnShape, b: ColumnShape): number {
  return a.name.localeCompare(b.name);
}

/** The Postgres error code and constraint of a failed query. */
async function failureOf(promise: Promise<unknown>): Promise<{ code: string; constraint: string }> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(QueryFailedError);
    const driverError = (error as QueryFailedError & { driverError: Record<string, string> })
      .driverError;
    return { code: driverError.code, constraint: driverError.constraint };
  }
  throw new Error("Expected the query to fail");
}

/**
 * The schema of `hour_category_notes` (GUS-173) against the entity: the guard entity × migration of
 * the table (docs/ARCHITECTURE.md section 14), plus the constraints that only the database proves.
 */
describe("hour category notes repository (e2e)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let personId: string;
  let coordinatorId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          entities: [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
      ],
    }).compile();
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE TABLE hour_category_notes, people RESTART IDENTITY CASCADE`);
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO people (id, name) VALUES
         ('01999a3e-0000-7000-8000-0000000000aa', 'Ana'),
         ('01999a3e-0000-7000-8000-0000000000ee', 'Coordinator')
       RETURNING id`,
    );
    [personId, coordinatorId] = rows.map((row) => row.id);
  });

  function insertNote(overrides: Record<string, unknown> = {}): Promise<unknown> {
    const row = {
      id: uuidv7(),
      person_id: personId,
      category: "planning",
      note: "Aguardando validação da coordenação.",
      updated_by_id: coordinatorId,
      deleted_at: null,
      ...overrides,
    };
    return dataSource.query(
      `INSERT INTO hour_category_notes (id, person_id, category, note, updated_by_id, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, row.person_id, row.category, row.note, row.updated_by_id, row.deleted_at],
    );
  }

  it("matches the entity metadata column by column (name, type, length, nullability)", async () => {
    const declared = dataSource
      .getMetadata(HourCategoryNote)
      .columns.map((column) => ({
        name: column.databaseName,
        type: column.type === "enum" ? (column.enumName ?? "") : UDT_NAME[String(column.type)],
        length: column.length ? Number(column.length) : null,
        nullable: column.isNullable,
      }))
      .sort(byName);
    const rows: Array<{
      column_name: string;
      udt_name: string;
      character_maximum_length: number | null;
      is_nullable: "YES" | "NO";
    }> = await dataSource.query(
      `SELECT column_name, udt_name, character_maximum_length, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'hour_category_notes'`,
    );
    const actual = rows
      .map((row) => ({
        name: row.column_name,
        type: row.udt_name,
        length: row.character_maximum_length ?? null,
        nullable: row.is_nullable === "YES",
      }))
      .sort(byName);

    expect(actual).toEqual(declared);
    expect(actual.find((column) => column.name === "note")?.length).toBe(
      HOUR_CATEGORY_NOTE_MAX_LENGTH,
    );
  });

  it("has the partial unique index on person and category, as the entity declares it", async () => {
    const [index] = dataSource.getMetadata(HourCategoryNote).indices;
    const rows: Array<{ indexdef: string }> = await dataSource.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'hour_category_notes'
          AND indexname = 'uq_hour_category_notes_person_id_category'`,
    );

    expect(index).toMatchObject({
      name: "uq_hour_category_notes_person_id_category",
      isUnique: true,
      where: `"deleted_at" IS NULL`,
    });
    expect(rows.map((row) => row.indexdef)).toEqual([
      "CREATE UNIQUE INDEX uq_hour_category_notes_person_id_category ON public.hour_category_notes USING btree (person_id, category) WHERE (deleted_at IS NULL)",
    ]);
  });

  it("has the check and the two named foreign keys to people", async () => {
    const checks: Array<{ conname: string }> = await dataSource.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'hour_category_notes'::regclass AND contype IN ('c', 'f')
        ORDER BY conname`,
    );

    expect(checks.map((check) => check.conname)).toEqual([
      "ck_hour_category_notes_note",
      "fk_hour_category_notes_person_id",
      "fk_hour_category_notes_updated_by_id",
    ]);
    expect(
      dataSource
        .getMetadata(HourCategoryNote)
        .foreignKeys.map((foreignKey) => [foreignKey.name, foreignKey.referencedTablePath])
        .sort(),
    ).toEqual([
      ["fk_hour_category_notes_person_id", "people"],
      ["fk_hour_category_notes_updated_by_id", "people"],
    ]);
  });

  it("rejects a second observation of the same person and category with 23505, and takes another category", async () => {
    await insertNote();
    await insertNote({ category: "event" });

    expect(await failureOf(insertNote())).toEqual({
      code: "23505",
      constraint: "uq_hour_category_notes_person_id_category",
    });
  });

  it("rejects a blank observation with 23514 and accepts null", async () => {
    expect(await failureOf(insertNote({ note: "   " }))).toEqual({
      code: "23514",
      constraint: "ck_hour_category_notes_note",
    });
    await insertNote({ note: null });
  });

  it("rejects an unknown person or author with 23503 on the named foreign keys", async () => {
    expect(await failureOf(insertNote({ person_id: UNKNOWN_ID }))).toEqual({
      code: "23503",
      constraint: "fk_hour_category_notes_person_id",
    });
    expect(await failureOf(insertNote({ updated_by_id: UNKNOWN_ID }))).toEqual({
      code: "23503",
      constraint: "fk_hour_category_notes_updated_by_id",
    });
  });
});
