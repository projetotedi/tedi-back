import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource, EntityTarget } from "typeorm";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { LessonPlanContent } from "../entities/lesson-plan-content.entity";
import { LessonPlan } from "../entities/lesson-plan.entity";

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

const UDT_NAME: Record<string, string> = {
  uuid: "uuid",
  varchar: "varchar",
  text: "text",
  integer: "int4",
  timestamptz: "timestamptz",
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

describe("lesson plans repository (e2e)", () => {
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
      `TRUNCATE TABLE lesson_plan_contents, lesson_plans, people RESTART IDENTITY CASCADE`,
    );
  });

  function declaredColumns(entity: EntityTarget<unknown>): ColumnShape[] {
    return dataSource
      .getMetadata(entity)
      .columns.map((column) => ({
        name: column.databaseName,
        type: UDT_NAME[String(column.type)],
        length: column.length ? Number(column.length) : null,
        nullable: column.isNullable,
      }))
      .sort(byName);
  }

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

  async function createPlan(createdById: string, overrides: Partial<LessonPlan> = {}) {
    const repository = dataSource.getRepository(LessonPlan);
    return repository.save(
      repository.create({
        title: "Teclado, mouse e janelas",
        expectedDurationMinutes: 90,
        createdById,
        ...overrides,
      }),
    );
  }

  describe("schema vs entities", () => {
    it("matches the entity metadata column by column (name, type, length, nullability)", async () => {
      expect(await actualColumns("lesson_plans")).toEqual(declaredColumns(LessonPlan));
      expect(await actualColumns("lesson_plan_contents")).toEqual(
        declaredColumns(LessonPlanContent),
      );
    });

    it("stores contents as rows of lesson_plan_contents, never as an array column", async () => {
      const arrays: Array<{ table_name: string; column_name: string }> = await dataSource.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('lesson_plans', 'lesson_plan_contents')
            AND data_type = 'ARRAY'`,
      );

      expect(arrays).toEqual([]);
    });

    it("has the named foreign keys of lesson_plans to people", async () => {
      const declared = declaredForeignKeys(LessonPlan);

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_lesson_plans_archived_by_id",
        "fk_lesson_plans_created_by_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "people",
        "people",
      ]);
      expect(await actualForeignKeys("lesson_plans")).toEqual(declared);
    });

    it("has the named foreign key of lesson_plan_contents to lesson_plans", async () => {
      const declared = declaredForeignKeys(LessonPlanContent);

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_lesson_plan_contents_lesson_plan_id",
      ]);
      expect(declared[0].referenced_table).toBe("lesson_plans");
      expect(await actualForeignKeys("lesson_plan_contents")).toEqual(declared);
    });

    it("has the unique index on (lesson_plan_id, position) declared by the entity", async () => {
      const declared = dataSource.getMetadata(LessonPlanContent).indices.map((index) => ({
        name: index.name,
        unique: index.isUnique,
        columns: index.columns.map((column) => column.databaseName),
      }));
      expect(declared).toEqual([
        {
          name: "uq_lesson_plan_contents_lesson_plan_id_position",
          unique: true,
          columns: ["lesson_plan_id", "position"],
        },
      ]);

      const definition = await indexDefinition(
        "lesson_plan_contents",
        "uq_lesson_plan_contents_lesson_plan_id_position",
      );
      expect(definition).toHaveLength(1);
      expect(definition[0]).toContain("CREATE UNIQUE INDEX");
      expect(definition[0]).toMatch(/\(lesson_plan_id, "?position"?\)/);
    });

    it("has the check constraint on the duration declared by the entity", async () => {
      const declared = dataSource
        .getMetadata(LessonPlan)
        .checks.map((check) => ({ name: check.name, expression: check.expression }));
      expect(declared).toEqual([
        {
          name: "ck_lesson_plans_expected_duration_minutes",
          expression: '"expected_duration_minutes" > 0',
        },
      ]);

      const actual: Array<{ conname: string; definition: string }> = await dataSource.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'lesson_plans'::regclass AND contype = 'c'`,
      );
      expect(actual).toHaveLength(1);
      expect(actual[0].conname).toBe("ck_lesson_plans_expected_duration_minutes");
      expect(actual[0].definition).toMatch(/expected_duration_minutes\s*>\s*0/);
    });
  });

  describe("constraints", () => {
    it("rejects a duration of zero or less with 23514 on the check constraint", async () => {
      const actor = await createActor();

      for (const expectedDurationMinutes of [0, -30]) {
        await expect(createPlan(actor.id, { expectedDurationMinutes })).rejects.toMatchObject({
          code: "23514",
          constraint: "ck_lesson_plans_expected_duration_minutes",
        });
      }
    });

    it("rejects a lesson plan created by a person that does not exist with 23503", async () => {
      await expect(createPlan("01999a3e-0000-7000-8000-000000000000")).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_lesson_plans_created_by_id",
      });
    });

    it("rejects two contents in the same position of a lesson plan with 23505", async () => {
      const actor = await createActor();
      const plan = await createPlan(actor.id);
      const repository = dataSource.getRepository(LessonPlanContent);
      const newContent = (lessonPlanId: string, position: number, text: string) =>
        repository.save(repository.create({ lessonPlanId, position, text }));

      await newContent(plan.id, 0, "Teclado e mouse");

      await expect(newContent(plan.id, 0, "Janelas")).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_lesson_plan_contents_lesson_plan_id_position",
      });
      await newContent(plan.id, 1, "Janelas");
      const other = await createPlan(actor.id, { title: "Outro plano" });
      await newContent(other.id, 0, "Teclado e mouse");
    });

    it("rejects contents of a lesson plan that does not exist with 23503", async () => {
      const repository = dataSource.getRepository(LessonPlanContent);

      await expect(
        repository.save(
          repository.create({
            lessonPlanId: "01999a3e-0000-7000-8000-000000000000",
            position: 0,
            text: "Teclado e mouse",
          }),
        ),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_lesson_plan_contents_lesson_plan_id",
      });
    });
  });

  describe("round trip", () => {
    it("round-trips every LessonPlan field, with the archive columns", async () => {
      const actor = await createActor();
      const archivedAt = new Date("2026-10-10T12:00:00.000Z");

      const saved = await createPlan(actor.id, {
        objective: "Familiarizar o aluno com o teclado e o mouse.",
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        archive: { archivedAt, archivedById: actor.id, archiveReason: "Conteúdo revisado." },
      });

      const loaded = await dataSource.getRepository(LessonPlan).findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        title: "Teclado, mouse e janelas",
        objective: "Familiarizar o aluno com o teclado e o mouse.",
        expectedDurationMinutes: 90,
        materialUrl: "https://drive.google.com/file/d/exemplo/view",
        createdById: actor.id,
        deletedAt: null,
      });
      expect(loaded.archive.archivedAt).toEqual(archivedAt);
      expect(loaded.archive.archivedById).toBe(actor.id);
      expect(loaded.archive.archiveReason).toBe("Conteúdo revisado.");
      expect(loaded.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("keeps the optional columns and the archive columns null for an active lesson plan", async () => {
      const actor = await createActor();

      const saved = await createPlan(actor.id);

      const loaded = await dataSource.getRepository(LessonPlan).findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({ objective: null, materialUrl: null });
      expect(loaded.archive).toMatchObject({
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });
    });

    it("round-trips the contents and lists them by position", async () => {
      const actor = await createActor();
      const plan = await createPlan(actor.id);
      const repository = dataSource.getRepository(LessonPlanContent);
      await repository.save([
        repository.create({ lessonPlanId: plan.id, position: 2, text: "Pastas e arquivos" }),
        repository.create({ lessonPlanId: plan.id, position: 0, text: "Teclado e mouse" }),
        repository.create({ lessonPlanId: plan.id, position: 1, text: "Janelas" }),
      ]);

      const loaded = await repository.find({
        where: { lessonPlanId: plan.id },
        order: { position: "ASC" },
      });

      expect(loaded.map((content) => [content.position, content.text])).toEqual([
        [0, "Teclado e mouse"],
        [1, "Janelas"],
        [2, "Pastas e arquivos"],
      ]);
      expect(loaded.every((content) => content.deletedAt === null)).toBe(true);
    });
  });
});
