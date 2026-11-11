import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource, EntityTarget } from "typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { CoursesService } from "@modules/catalog/services/courses.service";
import { LessonPlansService } from "@modules/catalog/services/lesson-plans.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";

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

// Postgres udt_name for each TypeORM column type used by the entity.
const UDT_NAME: Record<string, string> = {
  uuid: "uuid",
  varchar: "varchar",
  text: "text",
  timestamptz: "timestamptz",
  date: "date",
  time: "time",
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

type CreateCourseInput = Parameters<CoursesService["create"]>[0];

function byName(a: ColumnShape, b: ColumnShape): number {
  return a.name.localeCompare(b.name);
}

describe("lessons repository (e2e)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonPlansService: LessonPlansService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          // Every entity: the foreign keys of Lesson point to "classes", "lesson_plans" and
          // "people" by table name, and that only resolves when those entities are loaded too.
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
    peopleService = module.get(PeopleService);
    coursesService = module.get(CoursesService);
    classesService = module.get(ClassesService);
    lessonPlansService = module.get(LessonPlansService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE lessons, classes, editions, course_lesson_plans, lesson_plan_contents,
                      lesson_plans, course_prerequisites, courses, people
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

  /**
   * The rows a lesson needs: its author, a class (with its course and edition) and a lesson plan.
   * They come from the services the modules export, not from the tables of those modules: it is
   * scenery here, so the test depends on their contract and not on their schema.
   */
  async function setUp() {
    const actor = await peopleService.save({ name: "Director" });
    const course = await coursesService.create(
      {
        name: "Informática Básica",
        description: "Fundamentos do uso do computador.",
        category: "basic",
      } as unknown as CreateCourseInput,
      actor.id,
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
      actor.id,
    );
    const plan = await lessonPlansService.create(
      {
        title: "Teclado, mouse e janelas",
        objective: "Familiarizar o aluno com o teclado.",
        expectedDurationMinutes: 90,
        contents: ["Teclado e mouse"],
      },
      actor.id,
    );

    return {
      actor,
      classId: schoolClass.id,
      lessonPlanId: plan.id,
      ids: { classId: schoolClass.id, createdById: actor.id },
    };
  }

  function createLesson(
    ids: { classId: string; createdById: string },
    overrides: Partial<Lesson> = {},
  ) {
    const repository = dataSource.getRepository(Lesson);
    return repository.save(
      repository.create({
        title: "Teclado, mouse e janelas",
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
        ...ids,
        ...overrides,
      }),
    );
  }

  describe("schema vs entities", () => {
    it("matches the entity metadata column by column (name, type, length, nullability)", async () => {
      expect(await actualColumns("lessons")).toEqual(declaredColumns(Lesson));
    });

    it("has the enum type lessons_status_enum with the values of LessonStatus, in order", async () => {
      const rows: Array<{ enumlabel: string }> = await dataSource.query(
        `SELECT e.enumlabel
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'lessons_status_enum'
          ORDER BY e.enumsortorder`,
      );

      expect(rows.map((row) => row.enumlabel)).toEqual([
        "planned",
        "confirmed",
        "done",
        "cancelled",
      ]);
      expect(rows.map((row) => row.enumlabel)).toEqual(Object.values(LessonStatus));
    });

    it("has the named foreign keys of lessons to classes, lesson_plans and people", async () => {
      const declared = declaredForeignKeys(Lesson);

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_lessons_cancelled_by_id",
        "fk_lessons_class_id",
        "fk_lessons_created_by_id",
        "fk_lessons_lesson_plan_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.column_name)).toEqual([
        "cancelled_by_id",
        "class_id",
        "created_by_id",
        "lesson_plan_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "people",
        "classes",
        "people",
        "lesson_plans",
      ]);
      expect(await actualForeignKeys("lessons")).toEqual(declared);
    });

    it("has idx_lessons_class_id_date on (class_id, date), declared by the entity", async () => {
      expect(
        dataSource.getMetadata(Lesson).indices.map((index) => ({
          name: index.name,
          unique: index.isUnique,
          columns: index.columns.map((column) => column.databaseName),
        })),
      ).toEqual([
        { name: "idx_lessons_class_id_date", unique: false, columns: ["class_id", "date"] },
      ]);

      const definition = await indexDefinition("lessons", "idx_lessons_class_id_date");
      expect(definition).toHaveLength(1);
      expect(definition[0]).not.toContain("UNIQUE");
      expect(definition[0]).toMatch(/\(class_id, date\)/);
    });

    it("has the six check constraints declared by the entity", async () => {
      const declared = dataSource
        .getMetadata(Lesson)
        .checks.map((check) => ({ name: check.name, expression: check.expression }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      expect(declared).toEqual([
        {
          name: "ck_lessons_cancellation",
          expression: `("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)`,
        },
        {
          name: "ck_lessons_expected_monitors",
          expression: '"expected_monitors" IS NULL OR "expected_monitors" >= 0',
        },
        {
          name: "ck_lessons_expected_students",
          expression: '"expected_students" IS NULL OR "expected_students" >= 0',
        },
        {
          name: "ck_lessons_sequence_order",
          expression: '"sequence_order" IS NULL OR "sequence_order" >= 1',
        },
        {
          name: "ck_lessons_sequence_requires_plan",
          expression: '"sequence_order" IS NULL OR "lesson_plan_id" IS NOT NULL',
        },
        { name: "ck_lessons_time_range", expression: '"end_time" > "start_time"' },
      ]);

      const actual: Array<{ conname: string; definition: string }> = await dataSource.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'lessons'::regclass AND contype = 'c'`,
      );
      actual.sort((a, b) => a.conname.localeCompare(b.conname));

      expect(actual.map((check) => check.conname)).toEqual(declared.map((check) => check.name));
      const definitions = Object.fromEntries(actual.map((c) => [c.conname, c.definition]));
      expect(definitions.ck_lessons_time_range).toMatch(/end_time\s*>\s*start_time/);
      expect(definitions.ck_lessons_sequence_order).toMatch(/sequence_order\s*>=\s*1/);
      expect(definitions.ck_lessons_sequence_requires_plan).toMatch(/lesson_plan_id IS NOT NULL/);
      expect(definitions.ck_lessons_expected_students).toMatch(/expected_students\s*>=\s*0/);
      expect(definitions.ck_lessons_expected_monitors).toMatch(/expected_monitors\s*>=\s*0/);
      expect(definitions.ck_lessons_cancellation).toMatch(/status\s*=\s*'cancelled'/);
      expect(definitions.ck_lessons_cancellation).toMatch(/cancelled_at IS NOT NULL/);
    });

    it("has no archive columns: a lesson ends cancelled, not archived", async () => {
      const columns = (await actualColumns("lessons")).map((column) => column.name);

      expect(columns).not.toContain("archived_at");
      expect(columns).not.toContain("archived_by_id");
      expect(columns).not.toContain("archive_reason");
    });
  });

  describe("constraints", () => {
    it("rejects an end time that is not after the start time with 23514 on ck_lessons_time_range", async () => {
      const { ids } = await setUp();

      await expect(
        createLesson(ids, { startTime: "14:00", endTime: "14:00" }),
      ).rejects.toMatchObject({ code: "23514", constraint: "ck_lessons_time_range" });
      await expect(
        createLesson(ids, { startTime: "15:30", endTime: "14:00" }),
      ).rejects.toMatchObject({ code: "23514", constraint: "ck_lessons_time_range" });

      // One minute is enough, and so is the whole day.
      await createLesson(ids, { startTime: "14:00", endTime: "14:01" });
      await createLesson(ids, { startTime: "00:00", endTime: "23:59" });
    });

    it("rejects a sequence_order below 1 with 23514 on ck_lessons_sequence_order", async () => {
      const { ids, lessonPlanId } = await setUp();

      await expect(createLesson(ids, { lessonPlanId, sequenceOrder: 0 })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_lessons_sequence_order",
      });
      await expect(createLesson(ids, { lessonPlanId, sequenceOrder: -1 })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_lessons_sequence_order",
      });
      await createLesson(ids, { lessonPlanId, sequenceOrder: 1 });
    });

    it("rejects a sequence_order without a lesson plan with 23514 on ck_lessons_sequence_requires_plan", async () => {
      const { ids, lessonPlanId } = await setUp();

      await expect(createLesson(ids, { sequenceOrder: 1 })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_lessons_sequence_requires_plan",
      });
      // A plan without a position is a lesson outside the sequence, and a lesson with neither is
      // a lesson on its own: both are fine.
      await createLesson(ids, { lessonPlanId });
      await createLesson(ids);
    });

    it("rejects a negative head count with 23514, and accepts zero and null", async () => {
      const { ids } = await setUp();

      await expect(createLesson(ids, { expectedStudents: -1 })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_lessons_expected_students",
      });
      await expect(createLesson(ids, { expectedMonitors: -1 })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_lessons_expected_monitors",
      });

      const zero = await createLesson(ids, { expectedStudents: 0, expectedMonitors: 0 });
      expect(zero.expectedStudents).toBe(0);
      expect(zero.expectedMonitors).toBe(0);
      await createLesson(ids, { expectedStudents: null, expectedMonitors: null });
    });

    it("rejects status cancelled without cancelled_at, and the reverse, with 23514 on ck_lessons_cancellation", async () => {
      const { actor, ids } = await setUp();

      await expect(createLesson(ids, { status: LessonStatus.CANCELLED })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_lessons_cancellation",
      });
      for (const status of [LessonStatus.PLANNED, LessonStatus.CONFIRMED, LessonStatus.DONE]) {
        await expect(createLesson(ids, { status, cancelledAt: new Date() })).rejects.toMatchObject({
          code: "23514",
          constraint: "ck_lessons_cancellation",
        });
      }

      const cancelled = await createLesson(ids, {
        status: LessonStatus.CANCELLED,
        cancelReason: "Feriado.",
        cancelledAt: new Date(),
        cancelledById: actor.id,
      });
      expect(cancelled.status).toBe(LessonStatus.CANCELLED);
    });

    it("rejects a class that does not exist with 23503 on fk_lessons_class_id", async () => {
      const { ids } = await setUp();

      await expect(createLesson({ ...ids, classId: UNKNOWN_ID })).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_lessons_class_id",
      });
    });

    it("rejects a lesson plan that does not exist with 23503 on fk_lessons_lesson_plan_id", async () => {
      const { ids } = await setUp();

      await expect(createLesson(ids, { lessonPlanId: UNKNOWN_ID })).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_lessons_lesson_plan_id",
      });
    });

    it("rejects a lesson created by a person that does not exist with 23503 on fk_lessons_created_by_id", async () => {
      const { ids } = await setUp();

      await expect(createLesson({ ...ids, createdById: UNKNOWN_ID })).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_lessons_created_by_id",
      });
    });

    it("rejects a lesson cancelled by a person that does not exist with 23503 on fk_lessons_cancelled_by_id", async () => {
      const { ids } = await setUp();

      await expect(
        createLesson(ids, {
          status: LessonStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: UNKNOWN_ID,
        }),
      ).rejects.toMatchObject({ code: "23503", constraint: "fk_lessons_cancelled_by_id" });
    });

    it("accepts two lessons of the same class on the same day and time: nothing here forbids a clash", async () => {
      const { ids } = await setUp();

      const first = await createLesson(ids);
      const second = await createLesson(ids);

      expect(second.id).not.toBe(first.id);
    });

    it("defaults the status to planned when an insert does not say it", async () => {
      const { ids } = await setUp();

      const rows: Array<{ status: string }> = await dataSource.query(
        `INSERT INTO lessons (id, class_id, title, date, start_time, end_time, created_by_id)
         VALUES (gen_random_uuid(), $1, 'Teclado', '2026-03-10', '14:00', '15:30', $2)
         RETURNING status`,
        [ids.classId, ids.createdById],
      );

      expect(rows[0].status).toBe("planned");
    });

    it("rejects a status outside the enum with 22P02", async () => {
      const { ids } = await setUp();

      await expect(
        dataSource.query(
          `INSERT INTO lessons (id, class_id, title, date, start_time, end_time, status, created_by_id)
           VALUES (gen_random_uuid(), $1, 'Teclado', '2026-03-10', '14:00', '15:30', 'open', $2)`,
          [ids.classId, ids.createdById],
        ),
      ).rejects.toMatchObject({ code: "22P02" });
    });

    it("rejects a lesson without a class, a title, a day, a time or an author with 23502", async () => {
      const { ids } = await setUp();

      for (const column of [
        "class_id",
        "title",
        "date",
        "start_time",
        "end_time",
        "created_by_id",
      ]) {
        const values: Record<string, string | null> = {
          class_id: ids.classId,
          title: "Teclado",
          date: "2026-03-10",
          start_time: "14:00",
          end_time: "15:30",
          created_by_id: ids.createdById,
          [column]: null,
        };

        await expect(
          dataSource.query(
            `INSERT INTO lessons (id, class_id, title, date, start_time, end_time, created_by_id)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
            [
              values.class_id,
              values.title,
              values.date,
              values.start_time,
              values.end_time,
              values.created_by_id,
            ],
          ),
        ).rejects.toMatchObject({ code: "23502", column });
      }
    });
  });

  describe("round trip", () => {
    it("round-trips every Lesson field, with the days as YYYY-MM-DD strings and the times as HH:mm", async () => {
      const { actor, ids, lessonPlanId } = await setUp();
      const cancelledAt = new Date("2026-03-09T12:00:00.000Z");

      const saved = await createLesson(ids, {
        lessonPlanId,
        sequenceOrder: 1,
        title: "Teclado, mouse e janelas",
        objective: "Familiarizar o aluno com o teclado.",
        date: "2026-03-17",
        startTime: "08:05",
        endTime: "10:45",
        location: "Laboratório 3, bloco B",
        expectedStudents: 15,
        expectedMonitors: 2,
        subject: "Primeiro contato com o computador",
        postNotes: "A turma terminou o exercício antes do previsto.",
        status: LessonStatus.CANCELLED,
        cancelReason: "Feriado municipal.",
        cancelledAt,
        cancelledById: actor.id,
        originalDate: "2026-03-10",
        rescheduleReason: "Laboratório em manutenção.",
        rescheduleNote: "Avisar a turma pelo grupo.",
      });

      const loaded = await dataSource.getRepository(Lesson).findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        classId: ids.classId,
        lessonPlanId,
        sequenceOrder: 1,
        title: "Teclado, mouse e janelas",
        objective: "Familiarizar o aluno com o teclado.",
        date: "2026-03-17",
        startTime: "08:05",
        endTime: "10:45",
        location: "Laboratório 3, bloco B",
        expectedStudents: 15,
        expectedMonitors: 2,
        subject: "Primeiro contato com o computador",
        postNotes: "A turma terminou o exercício antes do previsto.",
        status: LessonStatus.CANCELLED,
        cancelReason: "Feriado municipal.",
        cancelledById: actor.id,
        originalDate: "2026-03-10",
        rescheduleReason: "Laboratório em manutenção.",
        rescheduleNote: "Avisar a turma pelo grupo.",
        createdById: actor.id,
        deletedAt: null,
      });
      expect(typeof loaded.date).toBe("string");
      expect(typeof loaded.originalDate).toBe("string");
      expect(loaded.cancelledAt).toEqual(cancelledAt);
      expect(loaded.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("keeps the optional columns null and the status planned for a bare lesson", async () => {
      const { ids } = await setUp();

      const saved = await createLesson(ids);

      const loaded = await dataSource.getRepository(Lesson).findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        lessonPlanId: null,
        sequenceOrder: null,
        objective: null,
        location: null,
        expectedStudents: null,
        expectedMonitors: null,
        subject: null,
        postNotes: null,
        status: LessonStatus.PLANNED,
        cancelReason: null,
        cancelledAt: null,
        cancelledById: null,
        originalDate: null,
        rescheduleReason: null,
        rescheduleNote: null,
      });
    });

    it("reads start_time and end_time back as HH:mm, though Postgres stores and prints them with seconds", async () => {
      const { ids } = await setUp();

      const saved = await createLesson(ids, { startTime: "09:05", endTime: "11:30" });

      const raw: Array<{ start_time: string; end_time: string }> = await dataSource.query(
        `SELECT start_time::text AS start_time, end_time::text AS end_time FROM lessons WHERE id = $1`,
        [saved.id],
      );
      expect(raw[0]).toEqual({ start_time: "09:05:00", end_time: "11:30:00" });

      const loaded = await dataSource.getRepository(Lesson).findOneByOrFail({ id: saved.id });
      expect(loaded.startTime).toBe("09:05");
      expect(loaded.endTime).toBe("11:30");
    });

    it("finds a lesson by the HH:mm time it was saved with: the transformer writes it as it is", async () => {
      const { ids } = await setUp();
      const saved = await createLesson(ids, { startTime: "14:00", endTime: "15:30" });

      const found = await dataSource
        .getRepository(Lesson)
        .findOneBy({ id: saved.id, startTime: "14:00", endTime: "15:30" });

      expect(found?.id).toBe(saved.id);
    });

    it("stores each status and reads it back as the enum value", async () => {
      const { actor, ids } = await setUp();

      for (const status of Object.values(LessonStatus)) {
        const cancelled =
          status === LessonStatus.CANCELLED
            ? { cancelledAt: new Date(), cancelledById: actor.id }
            : {};
        const saved = await createLesson(ids, { status, ...cancelled });

        const loaded = await dataSource.getRepository(Lesson).findOneByOrFail({ id: saved.id });
        expect(loaded.status).toBe(status);
      }
    });

    it("lists the lessons of a class by day through the index on (class_id, date)", async () => {
      const { ids } = await setUp();
      await createLesson(ids, { title: "Terceira", date: "2026-03-24" });
      await createLesson(ids, { title: "Primeira", date: "2026-03-10" });
      await createLesson(ids, { title: "Segunda", date: "2026-03-17" });

      const lessons = await dataSource.getRepository(Lesson).find({
        where: { classId: ids.classId },
        order: { date: "ASC" },
      });

      expect(lessons.map((lesson) => lesson.title)).toEqual(["Primeira", "Segunda", "Terceira"]);
    });
  });
});
