import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource, EntityTarget } from "typeorm";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { CoursePrerequisite } from "../entities/course-prerequisite.entity";
import { Course } from "../entities/course.entity";
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

describe("courses repository (e2e)", () => {
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
          // Every entity: the foreign keys of Course point to "people" by table name.
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
      `TRUNCATE TABLE course_prerequisites, courses, people RESTART IDENTITY CASCADE`,
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

  function link(courseId: string, prerequisiteId: string) {
    const repository = dataSource.getRepository(CoursePrerequisite);
    return repository.save(repository.create({ courseId, prerequisiteId }));
  }

  describe("schema vs entities", () => {
    it("matches the entity metadata column by column (name, type, length, nullability)", async () => {
      expect(await actualColumns("courses")).toEqual(declaredColumns(Course));
      expect(await actualColumns("course_prerequisites")).toEqual(
        declaredColumns(CoursePrerequisite),
      );
    });

    it("has the enum type courses_category_enum with the values of CourseCategory, in order", async () => {
      const rows: Array<{ enumlabel: string }> = await dataSource.query(
        `SELECT e.enumlabel
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'courses_category_enum'
          ORDER BY e.enumsortorder`,
      );

      expect(rows.map((row) => row.enumlabel)).toEqual(["basic", "intermediate", "advanced"]);
      expect(rows.map((row) => row.enumlabel)).toEqual(Object.values(CourseCategory));
    });

    it("has the named foreign keys of courses to people", async () => {
      const declared = declaredForeignKeys(Course);

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_courses_archived_by_id",
        "fk_courses_created_by_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "people",
        "people",
      ]);
      expect(await actualForeignKeys("courses")).toEqual(declared);
    });

    it("has the named foreign keys of course_prerequisites to courses", async () => {
      const declared = declaredForeignKeys(CoursePrerequisite);

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_course_prerequisites_course_id",
        "fk_course_prerequisites_prerequisite_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.column_name)).toEqual([
        "course_id",
        "prerequisite_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "courses",
        "courses",
      ]);
      expect(await actualForeignKeys("course_prerequisites")).toEqual(declared);
    });

    it("has the unique index on (course_id, prerequisite_id) and the index on prerequisite_id declared by the entity", async () => {
      const declared = dataSource
        .getMetadata(CoursePrerequisite)
        .indices.map((index) => ({
          name: index.name,
          unique: index.isUnique,
          columns: index.columns.map((column) => column.databaseName),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      expect(declared).toEqual([
        {
          name: "idx_course_prerequisites_prerequisite_id",
          unique: false,
          columns: ["prerequisite_id"],
        },
        {
          name: "uq_course_prerequisites_course_id_prerequisite_id",
          unique: true,
          columns: ["course_id", "prerequisite_id"],
        },
      ]);

      const unique = await indexDefinition(
        "course_prerequisites",
        "uq_course_prerequisites_course_id_prerequisite_id",
      );
      expect(unique).toHaveLength(1);
      expect(unique[0]).toContain("CREATE UNIQUE INDEX");
      expect(unique[0]).toMatch(/\(course_id, prerequisite_id\)/);

      const simple = await indexDefinition(
        "course_prerequisites",
        "idx_course_prerequisites_prerequisite_id",
      );
      expect(simple).toHaveLength(1);
      expect(simple[0]).not.toContain("UNIQUE");
      expect(simple[0]).toMatch(/\(prerequisite_id\)/);
    });

    it("has the unique index uq_courses_name on lower(name)", async () => {
      // The name is unique ignoring case: the index is on lower(name), not on name. It is an
      // expression index, which the Course entity cannot declare (see its JSDoc), so this is
      // where it is checked.
      const definition = await indexDefinition("courses", "uq_courses_name");

      expect(definition).toHaveLength(1);
      expect(definition[0]).toContain("CREATE UNIQUE INDEX");
      expect(definition[0]).toMatch(/lower\(.*name.*\)/i);
      expect(dataSource.getMetadata(Course).indices).toEqual([]);
    });

    it("has the check constraint ck_course_prerequisites_not_self declared by the entity", async () => {
      const declared = dataSource
        .getMetadata(CoursePrerequisite)
        .checks.map((check) => ({ name: check.name, expression: check.expression }));
      expect(declared).toEqual([
        {
          name: "ck_course_prerequisites_not_self",
          expression: '"course_id" <> "prerequisite_id"',
        },
      ]);

      const actual: Array<{ conname: string; definition: string }> = await dataSource.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'course_prerequisites'::regclass AND contype = 'c'`,
      );
      expect(actual).toHaveLength(1);
      expect(actual[0].conname).toBe("ck_course_prerequisites_not_self");
      expect(actual[0].definition).toMatch(/course_id\s*<>\s*prerequisite_id/);
    });
  });

  describe("constraints", () => {
    it("rejects two course names that differ only in case with 23505 on uq_courses_name", async () => {
      const actor = await createActor();
      await createCourse(actor.id, { name: "Informática Básica" });

      // The accented capitals prove that lower() folds the case of accented letters in this
      // database too (the musl Postgres of the CI could behave differently).
      await expect(createCourse(actor.id, { name: "INFORMÁTICA BÁSICA" })).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_courses_name",
      });
      await expect(createCourse(actor.id, { name: "informática básica" })).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_courses_name",
      });
      // A different name is fine.
      await createCourse(actor.id, { name: "Informática Intermediária" });
    });

    it("counts an archived course when it rejects a repeated name", async () => {
      const actor = await createActor();
      await createCourse(actor.id, {
        name: "Informática Básica",
        archive: { archivedAt: new Date(), archivedById: actor.id, archiveReason: null },
      });

      await expect(createCourse(actor.id, { name: "informática básica" })).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_courses_name",
      });
    });

    it("rejects a course that requires itself with 23514", async () => {
      const actor = await createActor();
      const course = await createCourse(actor.id);

      await expect(link(course.id, course.id)).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_course_prerequisites_not_self",
      });
    });

    it("rejects the same prerequisite twice with 23505", async () => {
      const actor = await createActor();
      const basic = await createCourse(actor.id);
      const intermediate = await createCourse(actor.id, {
        name: "Informática Intermediária",
        category: CourseCategory.INTERMEDIATE,
      });
      await link(intermediate.id, basic.id);

      await expect(link(intermediate.id, basic.id)).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_course_prerequisites_course_id_prerequisite_id",
      });
      // The pair is ordered: the database does not refuse the reverse (a longer cycle is refused
      // by CoursesService, not by a constraint), and the same course may be required by others.
      const advanced = await createCourse(actor.id, {
        name: "Informática Avançada",
        category: CourseCategory.ADVANCED,
      });
      await link(advanced.id, basic.id);
    });

    it("rejects a category outside the enum with 22P02", async () => {
      const actor = await createActor();

      await expect(
        dataSource.query(
          `INSERT INTO courses (id, name, description, category, created_by_id)
           VALUES (gen_random_uuid(), 'Curso', 'Descrição', 'expert', $1)`,
          [actor.id],
        ),
      ).rejects.toMatchObject({ code: "22P02" });
    });

    it("rejects a course without a category with 23502", async () => {
      const actor = await createActor();

      await expect(
        dataSource.query(
          `INSERT INTO courses (id, name, description, created_by_id)
           VALUES (gen_random_uuid(), 'Curso', 'Descrição', $1)`,
          [actor.id],
        ),
      ).rejects.toMatchObject({ code: "23502" });
    });

    it("rejects a course created by a person that does not exist with 23503", async () => {
      await expect(createCourse(UNKNOWN_ID)).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_courses_created_by_id",
      });
    });

    it("rejects prerequisites of a course that does not exist with 23503", async () => {
      const actor = await createActor();
      const course = await createCourse(actor.id);

      await expect(link(UNKNOWN_ID, course.id)).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_course_prerequisites_course_id",
      });
      await expect(link(course.id, UNKNOWN_ID)).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_course_prerequisites_prerequisite_id",
      });
    });
  });

  describe("round trip", () => {
    it("round-trips every Course field, with the archive columns", async () => {
      const actor = await createActor();
      const archivedAt = new Date("2026-10-10T12:00:00.000Z");

      const saved = await createCourse(actor.id, {
        name: "Informática Intermediária",
        description: "Planilhas, textos e apresentações.",
        objective: "Preparar o aluno para as ferramentas de escritório.",
        category: CourseCategory.INTERMEDIATE,
        archive: { archivedAt, archivedById: actor.id, archiveReason: "Conteúdo revisado." },
      });

      const loaded = await dataSource.getRepository(Course).findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        name: "Informática Intermediária",
        description: "Planilhas, textos e apresentações.",
        objective: "Preparar o aluno para as ferramentas de escritório.",
        category: CourseCategory.INTERMEDIATE,
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

    it("keeps objective and the archive columns null for an active course", async () => {
      const actor = await createActor();

      const saved = await createCourse(actor.id);

      const loaded = await dataSource.getRepository(Course).findOneByOrFail({ id: saved.id });
      expect(loaded.objective).toBeNull();
      expect(loaded.archive).toMatchObject({
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });
    });

    it("stores each category and reads it back as the enum value", async () => {
      const actor = await createActor();

      for (const category of Object.values(CourseCategory)) {
        const saved = await createCourse(actor.id, { name: `Curso ${category}`, category });

        const loaded = await dataSource.getRepository(Course).findOneByOrFail({ id: saved.id });
        expect(loaded.category).toBe(category);
      }
    });

    it("round-trips the prerequisites of a course", async () => {
      const actor = await createActor();
      const basic = await createCourse(actor.id);
      const intermediate = await createCourse(actor.id, {
        name: "Informática Intermediária",
        category: CourseCategory.INTERMEDIATE,
      });
      await link(intermediate.id, basic.id);

      const loaded = await dataSource
        .getRepository(CoursePrerequisite)
        .find({ where: { courseId: intermediate.id } });

      expect(loaded.map((row) => [row.courseId, row.prerequisiteId])).toEqual([
        [intermediate.id, basic.id],
      ]);
      expect(loaded[0].deletedAt).toBeNull();
    });
  });
});
