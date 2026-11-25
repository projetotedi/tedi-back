import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource, EntityTarget } from "typeorm";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { CourseLessonPlan } from "../entities/course-lesson-plan.entity";
import { Course } from "../entities/course.entity";
import { LessonPlan } from "../entities/lesson-plan.entity";
import { CourseCategory } from "../enums/course-category.enum";

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

describe("course lesson plans repository (e2e)", () => {
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
          // Every entity: the foreign keys of Course and LessonPlan point to "people" by table name.
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
      `TRUNCATE TABLE course_lesson_plans, course_prerequisites, courses, lesson_plan_contents, lesson_plans, people RESTART IDENTITY CASCADE`,
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

  async function createCourse(createdById: string, overrides: Partial<Course> = {}) {
    const repository = dataSource.getRepository(Course);
    return repository.save(
      repository.create({
        name: "Informática Básica",
        description: "Fundamentos do uso do computador.",
        category: CourseCategory.BASIC,
        createdById,
        ...overrides,
      }),
    );
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

  function link(courseId: string, lessonPlanId: string, position: number) {
    const repository = dataSource.getRepository(CourseLessonPlan);
    return repository.save(repository.create({ courseId, lessonPlanId, position }));
  }

  describe("schema vs entities", () => {
    it("matches the entity metadata column by column (name, type, length, nullability)", async () => {
      expect(await actualColumns("course_lesson_plans")).toEqual(declaredColumns(CourseLessonPlan));
    });

    it("has the named foreign keys of course_lesson_plans to courses and lesson_plans", async () => {
      const declared = declaredForeignKeys(CourseLessonPlan);

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_course_lesson_plans_course_id",
        "fk_course_lesson_plans_lesson_plan_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.column_name)).toEqual([
        "course_id",
        "lesson_plan_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "courses",
        "lesson_plans",
      ]);
      expect(await actualForeignKeys("course_lesson_plans")).toEqual(declared);
    });

    it("has the unique indexes on (course_id, lesson_plan_id) and (course_id, position) and the index on lesson_plan_id declared by the entity", async () => {
      const declared = dataSource
        .getMetadata(CourseLessonPlan)
        .indices.map((index) => ({
          name: index.name,
          unique: index.isUnique,
          columns: index.columns.map((column) => column.databaseName),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      expect(declared).toEqual([
        {
          name: "idx_course_lesson_plans_lesson_plan_id",
          unique: false,
          columns: ["lesson_plan_id"],
        },
        {
          name: "uq_course_lesson_plans_course_id_lesson_plan_id",
          unique: true,
          columns: ["course_id", "lesson_plan_id"],
        },
        {
          name: "uq_course_lesson_plans_course_id_position",
          unique: true,
          columns: ["course_id", "position"],
        },
      ]);

      const uniquePlan = await indexDefinition(
        "course_lesson_plans",
        "uq_course_lesson_plans_course_id_lesson_plan_id",
      );
      expect(uniquePlan).toHaveLength(1);
      expect(uniquePlan[0]).toContain("CREATE UNIQUE INDEX");
      expect(uniquePlan[0]).toMatch(/\(course_id, lesson_plan_id\)/);

      const uniquePosition = await indexDefinition(
        "course_lesson_plans",
        "uq_course_lesson_plans_course_id_position",
      );
      expect(uniquePosition).toHaveLength(1);
      expect(uniquePosition[0]).toContain("CREATE UNIQUE INDEX");
      expect(uniquePosition[0]).toMatch(/\(course_id, "?position"?\)/);

      const simple = await indexDefinition(
        "course_lesson_plans",
        "idx_course_lesson_plans_lesson_plan_id",
      );
      expect(simple).toHaveLength(1);
      expect(simple[0]).not.toContain("UNIQUE");
      expect(simple[0]).toMatch(/\(lesson_plan_id\)/);
    });

    it("has the check constraint ck_course_lesson_plans_position declared by the entity", async () => {
      const declared = dataSource
        .getMetadata(CourseLessonPlan)
        .checks.map((check) => ({ name: check.name, expression: check.expression }));
      expect(declared).toEqual([
        { name: "ck_course_lesson_plans_position", expression: '"position" >= 1' },
      ]);

      const actual: Array<{ conname: string; definition: string }> = await dataSource.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'course_lesson_plans'::regclass AND contype = 'c'`,
      );
      expect(actual).toHaveLength(1);
      expect(actual[0].conname).toBe("ck_course_lesson_plans_position");
      expect(actual[0].definition).toMatch(/"?position"?\s*>=\s*1/);
    });
  });

  describe("constraints", () => {
    it("rejects the same lesson plan twice in a course with 23505 on uq_course_lesson_plans_course_id_lesson_plan_id", async () => {
      const actor = await createActor();
      const course = await createCourse(actor.id);
      const plan = await createPlan(actor.id);
      await link(course.id, plan.id, 1);

      await expect(link(course.id, plan.id, 2)).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_course_lesson_plans_course_id_lesson_plan_id",
      });
    });

    it("rejects two links at the same position of a course with 23505 on uq_course_lesson_plans_course_id_position", async () => {
      const actor = await createActor();
      const course = await createCourse(actor.id);
      const first = await createPlan(actor.id, { title: "Primeiro" });
      const second = await createPlan(actor.id, { title: "Segundo" });
      await link(course.id, first.id, 1);

      await expect(link(course.id, second.id, 1)).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_course_lesson_plans_course_id_position",
      });
      // A free position is fine, and so is a gap: the database does not demand 1..n.
      await link(course.id, second.id, 2);
    });

    it("accepts the same lesson plan in two courses at different positions", async () => {
      const actor = await createActor();
      const courseA = await createCourse(actor.id, { name: "Informática Básica" });
      const courseB = await createCourse(actor.id, { name: "Informática Intermediária" });
      const plan = await createPlan(actor.id);

      await link(courseA.id, plan.id, 1);
      await link(courseB.id, plan.id, 4);

      const rows: Array<{ course_id: string; position: number }> = await dataSource.query(
        `SELECT course_id, position FROM course_lesson_plans WHERE lesson_plan_id = $1 ORDER BY position`,
        [plan.id],
      );
      expect(rows).toEqual([
        { course_id: courseA.id, position: 1 },
        { course_id: courseB.id, position: 4 },
      ]);
      // The same position in another course is no conflict either: the index is per course.
      const other = await createPlan(actor.id, { title: "Outro plano" });
      await link(courseB.id, other.id, 1);
    });

    it("rejects position 0 with 23514", async () => {
      const actor = await createActor();
      const course = await createCourse(actor.id);
      const plan = await createPlan(actor.id);

      for (const position of [0, -1]) {
        await expect(link(course.id, plan.id, position)).rejects.toMatchObject({
          code: "23514",
          constraint: "ck_course_lesson_plans_position",
        });
      }
      await link(course.id, plan.id, 1);
    });

    it("rejects a lesson plan that does not exist with 23503", async () => {
      const actor = await createActor();
      const course = await createCourse(actor.id);

      await expect(link(course.id, UNKNOWN_ID, 1)).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_course_lesson_plans_lesson_plan_id",
      });
    });

    it("rejects a course that does not exist with 23503", async () => {
      const actor = await createActor();
      const plan = await createPlan(actor.id);

      await expect(link(UNKNOWN_ID, plan.id, 1)).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_course_lesson_plans_course_id",
      });
    });
  });

  describe("round trip", () => {
    it("round-trips every CourseLessonPlan field", async () => {
      const actor = await createActor();
      const course = await createCourse(actor.id);
      const plan = await createPlan(actor.id);

      const saved = await link(course.id, plan.id, 3);

      const loaded = await dataSource
        .getRepository(CourseLessonPlan)
        .findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        courseId: course.id,
        lessonPlanId: plan.id,
        position: 3,
        deletedAt: null,
      });
      // An integer column comes back as a number, not as a string.
      expect(typeof loaded.position).toBe("number");
      expect(loaded.createdAt).toBeInstanceOf(Date);
      expect(loaded.updatedAt).toBeInstanceOf(Date);
      expect(loaded.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("lists the sequence of a course by position, whatever the order of insertion", async () => {
      const actor = await createActor();
      const course = await createCourse(actor.id);
      const plans = [
        await createPlan(actor.id, { title: "Terceiro" }),
        await createPlan(actor.id, { title: "Primeiro" }),
        await createPlan(actor.id, { title: "Segundo" }),
      ];
      await link(course.id, plans[0].id, 3);
      await link(course.id, plans[1].id, 1);
      await link(course.id, plans[2].id, 2);

      const loaded = await dataSource
        .getRepository(CourseLessonPlan)
        .find({ where: { courseId: course.id }, order: { position: "ASC" } });

      expect(loaded.map((row) => [row.position, row.lessonPlanId])).toEqual([
        [1, plans[1].id],
        [2, plans[2].id],
        [3, plans[0].id],
      ]);
    });
  });
});
