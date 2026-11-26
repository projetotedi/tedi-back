import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource, EntityTarget } from "typeorm";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { insertStudent } from "@modules/people/__tests__/fixtures/students.fixture";
import { ENROLLMENT_STATUS_REASON_MAX_LENGTH } from "../dto/enrollment-limits";
import { Enrollment } from "../entities/enrollment.entity";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
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

// 23:00 in São Paulo on 2026-03-02 is already 2026-03-03 in UTC.
const ENROLLED_AT = new Date("2026-03-03T02:00:00.000Z");

// Postgres udt_name for each TypeORM column type used by the entity.
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
  actorId: string;
  classId: string;
  studentId: string;
}

function byName(a: ColumnShape, b: ColumnShape): number {
  return a.name.localeCompare(b.name);
}

describe("enrollments repository (e2e)", () => {
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
          // Every entity: the foreign keys of Enrollment point to "people" by table name, and that
          // only resolves when the entities of people are loaded too.
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
      `TRUNCATE TABLE enrollments, classes, editions, courses, student_profiles, people RESTART IDENTITY CASCADE`,
    );
  });

  /** What the entity declares. TypeORM keeps `length` as a string ("500") and "" when unset. */
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

  async function indexDefinition(name: string): Promise<string[]> {
    const rows: Array<{ indexdef: string }> = await dataSource.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'enrollments' AND indexname = $1`,
      [name],
    );
    return rows.map((row) => row.indexdef);
  }

  /** A class with its course and edition, a student and who enrolls her. */
  async function setUp(): Promise<Scenery> {
    const actorId = (await peopleService.save({ name: "Director" })).id;
    const courseId = await insertCourse(dataSource, actorId);
    const editionId = await insertEdition(dataSource, "2026.1");
    const classId = await insertClass(dataSource, { courseId, editionId, createdById: actorId });
    const studentId = await insertStudent(dataSource, { name: "Maria", createdById: actorId });
    return { actorId, classId, studentId };
  }

  function createEnrollment(scenery: Scenery, overrides: Partial<Enrollment> = {}) {
    const repository = dataSource.getRepository(Enrollment);
    return repository.save(
      repository.create({
        classId: scenery.classId,
        studentId: scenery.studentId,
        status: EnrollmentStatus.ACTIVE,
        enrolledAt: ENROLLED_AT,
        statusChangedAt: "2026-03-02",
        statusReason: null,
        createdById: scenery.actorId,
        ...overrides,
      }),
    );
  }

  describe("schema vs entities", () => {
    it("matches the entity metadata column by column (name, type, length, nullability)", async () => {
      expect(await actualColumns("enrollments")).toEqual(declaredColumns(Enrollment));
    });

    it("has the enum type enrollments_status_enum with the values of EnrollmentStatus, in order", async () => {
      const rows: Array<{ enumlabel: string }> = await dataSource.query(
        `SELECT e.enumlabel
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'enrollments_status_enum'
          ORDER BY e.enumsortorder`,
      );

      expect(rows.map((row) => row.enumlabel)).toEqual(["active", "dropped", "completed"]);
      expect(rows.map((row) => row.enumlabel)).toEqual(Object.values(EnrollmentStatus));
    });

    it("has the named foreign keys of enrollments to classes and people", async () => {
      const declared = declaredForeignKeys(Enrollment);

      expect(declared).toEqual([
        {
          constraint_name: "fk_enrollments_class_id",
          column_name: "class_id",
          referenced_table: "classes",
          referenced_column: "id",
          delete_rule: "NO ACTION",
          update_rule: "NO ACTION",
        },
        {
          constraint_name: "fk_enrollments_created_by_id",
          column_name: "created_by_id",
          referenced_table: "people",
          referenced_column: "id",
          delete_rule: "NO ACTION",
          update_rule: "NO ACTION",
        },
        {
          constraint_name: "fk_enrollments_student_id",
          column_name: "student_id",
          referenced_table: "people",
          referenced_column: "id",
          delete_rule: "NO ACTION",
          update_rule: "NO ACTION",
        },
      ]);
      expect(await actualForeignKeys("enrollments")).toEqual(declared);
    });

    it("has uq_enrollments_class_id_student_id as a unique index on (class_id, student_id) WHERE deleted_at IS NULL, as pg_indexes normalizes it", async () => {
      const declared = dataSource
        .getMetadata(Enrollment)
        .indices.find((index) => index.name === "uq_enrollments_class_id_student_id");
      expect({
        unique: declared?.isUnique,
        where: declared?.where,
        columns: declared?.columns.map((column) => column.databaseName),
      }).toEqual({
        unique: true,
        where: `"deleted_at" IS NULL`,
        columns: ["class_id", "student_id"],
      });

      // What the migration created, as Postgres normalizes it (pg_indexes.indexdef).
      expect(await indexDefinition("uq_enrollments_class_id_student_id")).toEqual([
        "CREATE UNIQUE INDEX uq_enrollments_class_id_student_id ON public.enrollments USING btree (class_id, student_id) WHERE (deleted_at IS NULL)",
      ]);
    });

    it("has idx_enrollments_student_id declared by the entity", async () => {
      expect(
        dataSource
          .getMetadata(Enrollment)
          .indices.map((index) => ({
            name: index.name,
            unique: index.isUnique,
            columns: index.columns.map((column) => column.databaseName),
          }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      ).toEqual([
        { name: "idx_enrollments_student_id", unique: false, columns: ["student_id"] },
        {
          name: "uq_enrollments_class_id_student_id",
          unique: true,
          columns: ["class_id", "student_id"],
        },
      ]);

      const byStudent = await indexDefinition("idx_enrollments_student_id");
      expect(byStudent).toHaveLength(1);
      expect(byStudent[0]).not.toContain("UNIQUE");
      expect(byStudent[0]).toMatch(/\(student_id\)/);
    });

    it("has ck_enrollments_status_changed_at declared by the entity and created by the migration", async () => {
      expect(
        dataSource
          .getMetadata(Enrollment)
          .checks.map((check) => ({ name: check.name, expression: check.expression })),
      ).toEqual([
        {
          name: "ck_enrollments_status_changed_at",
          expression: `"status_changed_at" >= ("enrolled_at" AT TIME ZONE 'America/Sao_Paulo')::date`,
        },
      ]);

      const rows: Array<{ conname: string; definition: string }> = await dataSource.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'enrollments'::regclass AND contype = 'c'`,
      );
      expect(rows.map((row) => row.conname)).toEqual(["ck_enrollments_status_changed_at"]);
      expect(rows[0].definition).toContain("America/Sao_Paulo");
      expect(rows[0].definition).toContain("status_changed_at >=");
    });
  });

  describe("constraints", () => {
    it("rejects a second live enrollment of the same student in the same class with 23505, and accepts it once the first is soft-deleted", async () => {
      const scenery = await setUp();
      const first = await createEnrollment(scenery);

      await expect(
        createEnrollment(scenery, { status: EnrollmentStatus.DROPPED }),
      ).rejects.toMatchObject({ code: "23505", constraint: "uq_enrollments_class_id_student_id" });

      await dataSource
        .getRepository(Enrollment)
        .update({ id: first.id }, { deletedAt: new Date("2026-03-10T12:00:00.000Z") });
      await createEnrollment(scenery);
    });

    it("rejects a statusChangedAt before the day of the enrollment in America/Sao_Paulo with 23514, and accepts the same day", async () => {
      const scenery = await setUp();

      // ENROLLED_AT is 2026-03-03 in UTC but 2026-03-02 in São Paulo.
      await expect(
        createEnrollment(scenery, { statusChangedAt: "2026-03-01" }),
      ).rejects.toMatchObject({ code: "23514", constraint: "ck_enrollments_status_changed_at" });
      const saved = await createEnrollment(scenery, { statusChangedAt: "2026-03-02" });
      expect(saved.statusChangedAt).toBe("2026-03-02");
    });

    it("rejects an unknown class, student and author with 23503 on their named foreign keys", async () => {
      const scenery = await setUp();

      const unknown: Array<[Partial<Enrollment>, string]> = [
        [{ classId: UNKNOWN_ID }, "fk_enrollments_class_id"],
        [{ studentId: UNKNOWN_ID }, "fk_enrollments_student_id"],
        [{ createdById: UNKNOWN_ID }, "fk_enrollments_created_by_id"],
      ];
      for (const [overrides, constraint] of unknown) {
        await expect(createEnrollment(scenery, overrides)).rejects.toMatchObject({
          code: "23503",
          constraint,
        });
      }
    });

    it("defaults the status to active", async () => {
      const scenery = await setUp();

      const rows: Array<{ status: string }> = await dataSource.query(
        `INSERT INTO enrollments (id, class_id, student_id, enrolled_at, status_changed_at, created_by_id)
         VALUES (gen_random_uuid(), $1, $2, $3, '2026-03-02', $4)
         RETURNING status`,
        [scenery.classId, scenery.studentId, ENROLLED_AT, scenery.actorId],
      );

      expect(rows[0].status).toBe(EnrollmentStatus.ACTIVE);
    });

    it("rejects a status outside the enum with 22P02", async () => {
      const scenery = await setUp();

      await expect(
        dataSource.query(
          `INSERT INTO enrollments (id, class_id, student_id, status, enrolled_at, status_changed_at, created_by_id)
           VALUES (gen_random_uuid(), $1, $2, 'paused', $3, '2026-03-02', $4)`,
          [scenery.classId, scenery.studentId, ENROLLED_AT, scenery.actorId],
        ),
      ).rejects.toMatchObject({ code: "22P02" });
    });

    it("rejects a row without class, student, enrolledAt, statusChangedAt or author with 23502", async () => {
      const scenery = await setUp();
      const values = {
        class_id: scenery.classId,
        student_id: scenery.studentId,
        enrolled_at: ENROLLED_AT,
        status_changed_at: "2026-03-02",
        created_by_id: scenery.actorId,
      };

      for (const column of Object.keys(values)) {
        const row: Record<string, unknown> = { ...values, [column]: null };
        await expect(
          dataSource.query(
            `INSERT INTO enrollments (id, class_id, student_id, enrolled_at, status_changed_at, created_by_id)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
            [
              row.class_id,
              row.student_id,
              row.enrolled_at,
              row.status_changed_at,
              row.created_by_id,
            ],
          ),
        ).rejects.toMatchObject({ code: "23502", column });
      }
    });
  });

  describe("round trip", () => {
    it("round-trips every Enrollment field, with statusChangedAt as a YYYY-MM-DD string", async () => {
      const scenery = await setUp();
      const now = new Date("2026-04-10T18:30:00.000Z");

      const saved = await createEnrollment(scenery, {
        status: EnrollmentStatus.DROPPED,
        statusChangedAt: "2026-04-10",
        statusReason: "Mudou de cidade.",
        createdAt: now,
        updatedAt: now,
      });

      const loaded = await dataSource.getRepository(Enrollment).findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        classId: scenery.classId,
        studentId: scenery.studentId,
        status: EnrollmentStatus.DROPPED,
        statusChangedAt: "2026-04-10",
        statusReason: "Mudou de cidade.",
        createdById: scenery.actorId,
        deletedAt: null,
      });
      expect(loaded.enrolledAt).toEqual(ENROLLED_AT);
      expect(loaded.createdAt).toEqual(now);
      expect(loaded.updatedAt).toEqual(now);
      expect(loaded.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("keeps ENROLLMENT_STATUS_REASON_MAX_LENGTH equal to the length of the column", async () => {
      const rows: Array<{ character_maximum_length: number }> = await dataSource.query(
        `SELECT character_maximum_length FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'enrollments'
            AND column_name = 'status_reason'`,
      );

      expect(rows[0].character_maximum_length).toBe(ENROLLMENT_STATUS_REASON_MAX_LENGTH);
      expect(
        Number(
          dataSource.getMetadata(Enrollment).findColumnWithDatabaseName("status_reason")?.length,
        ),
      ).toBe(ENROLLMENT_STATUS_REASON_MAX_LENGTH);
    });
  });
});
