import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource, EntityTarget } from "typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { CoursesService } from "@modules/catalog/services/courses.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { LessonsService } from "@modules/lessons/services/lessons.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import { ASSIGNMENT_NOTE_MAX_LENGTH } from "../dto/assignment-limits";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatusReason } from "../enums/assignment-status-reason.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";

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

const ACTIVE_UNIQUE_INDEX = "uq_lesson_assignments_lesson_id_person_id_active";
const CONFIRMED_TEACHER_UNIQUE_INDEX = "uq_lesson_assignments_lesson_id_confirmed_teacher";

// Postgres udt_name for each TypeORM column type used by the entity.
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

interface ForeignKeyShape {
  constraint_name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
  delete_rule: string | undefined;
  update_rule: string | undefined;
}

interface AssignmentIds {
  lessonId: string;
  personId: string;
  createdById: string;
}

type CreateCourseInput = Parameters<CoursesService["create"]>[0];

function byName(a: ColumnShape, b: ColumnShape): number {
  return a.name.localeCompare(b.name);
}

describe("lesson assignments repository (e2e)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonsService: LessonsService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          // Every entity: the foreign keys of LessonAssignment point to "lessons" and "people" by
          // table name, and that only resolves when those entities are loaded too.
          entities: [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
        PeopleModule,
        CatalogModule,
        ClassesModule,
        LessonsModule,
      ],
    }).compile();

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    coursesService = module.get(CoursesService);
    classesService = module.get(ClassesService);
    lessonsService = module.get(LessonsService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE lesson_assignments, lessons, classes, editions, course_lesson_plans,
                      lesson_plan_contents, lesson_plans, course_prerequisites, courses, people
       RESTART IDENTITY CASCADE`,
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

  async function indexDefinition(table: string, name: string): Promise<string[]> {
    const rows: Array<{ indexdef: string }> = await dataSource.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2`,
      [table, name],
    );
    return rows.map((row) => row.indexdef);
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
   * The rows an assignment needs: its author and a member, and a lesson (with its class and
   * course). They come from the services the modules export, not from the tables of those
   * modules: it is scenery here, so the test depends on their contract and not on their schema.
   */
  async function setUp() {
    const actor = await peopleService.save({ name: "Director" });
    const member = await peopleService.save({
      name: "Monitor Um",
      role: Role.MEMBER,
      accessEnabled: true,
    });
    const otherMember = await peopleService.save({
      name: "Monitor Dois",
      role: Role.MEMBER,
      accessEnabled: true,
    });
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
    const lesson = await lessonsService.create(
      {
        classId: schoolClass.id,
        title: "Teclado, mouse e janelas",
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
      },
      actor.id,
    );
    const otherLesson = await lessonsService.create(
      {
        classId: schoolClass.id,
        title: "Pastas e arquivos",
        date: "2026-03-17",
        startTime: "14:00",
        endTime: "15:30",
      },
      actor.id,
    );

    return {
      actor,
      member,
      otherMember,
      lessonId: lesson.id,
      otherLessonId: otherLesson.id,
      ids: { lessonId: lesson.id, personId: member.id, createdById: actor.id },
    };
  }

  function createAssignment(ids: AssignmentIds, overrides: Partial<LessonAssignment> = {}) {
    const repository = dataSource.getRepository(LessonAssignment);
    return repository.save(
      repository.create({ role: AssignmentRole.MONITOR, ...ids, ...overrides }),
    );
  }

  /** What a confirmed assignment carries: who confirmed it and when (the checks demand it). */
  function confirmedBy(reviewerId: string): Partial<LessonAssignment> {
    return {
      status: AssignmentStatus.CONFIRMED,
      reviewedById: reviewerId,
      reviewedAt: new Date("2026-03-09T12:00:00.000Z"),
    };
  }

  /** What a cancelled assignment carries: who withdrew it and when (the checks demand it). */
  function cancelledBy(actorId: string): Partial<LessonAssignment> {
    return {
      status: AssignmentStatus.CANCELLED,
      cancelledById: actorId,
      cancelledAt: new Date("2026-03-09T13:00:00.000Z"),
    };
  }

  describe("schema vs entities", () => {
    it("matches the entity metadata column by column (name, type, length, nullability)", async () => {
      expect(await actualColumns("lesson_assignments")).toEqual(declaredColumns(LessonAssignment));
    });

    it("has the enum type lesson_assignments_role_enum with the values of AssignmentRole, in order", async () => {
      const labels = await enumLabels("lesson_assignments_role_enum");

      expect(labels).toEqual(["teacher", "monitor"]);
      expect(labels).toEqual(Object.values(AssignmentRole));
    });

    it("has the enum type lesson_assignments_status_enum with the values of AssignmentStatus, in order", async () => {
      const labels = await enumLabels("lesson_assignments_status_enum");

      expect(labels).toEqual(["pending", "confirmed", "declined", "cancelled", "expired"]);
      expect(labels).toEqual(Object.values(AssignmentStatus));
    });

    it("has the enum type lesson_assignments_status_reason_enum with the values of AssignmentStatusReason, in order (GUS-179)", async () => {
      const labels = await enumLabels("lesson_assignments_status_reason_enum");

      expect(labels).toEqual(["lesson_cancelled"]);
      expect(labels).toEqual(Object.values(AssignmentStatusReason));
    });

    it("has the enum type lesson_assignments_source_enum with the values of AssignmentSource, in order", async () => {
      const labels = await enumLabels("lesson_assignments_source_enum");

      expect(labels).toEqual(["direct", "application"]);
      expect(labels).toEqual(Object.values(AssignmentSource));
    });

    it("has the five named foreign keys of lesson_assignments to lessons and people", async () => {
      const declared = declaredForeignKeys(LessonAssignment);

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_lesson_assignments_cancelled_by_id",
        "fk_lesson_assignments_created_by_id",
        "fk_lesson_assignments_lesson_id",
        "fk_lesson_assignments_person_id",
        "fk_lesson_assignments_reviewed_by_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.column_name)).toEqual([
        "cancelled_by_id",
        "created_by_id",
        "lesson_id",
        "person_id",
        "reviewed_by_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "people",
        "people",
        "lessons",
        "people",
        "people",
      ]);
      expect(await actualForeignKeys("lesson_assignments")).toEqual(declared);
    });

    it("has the two partial unique indexes with their predicates, declared by the entity and created by the migration", async () => {
      const activeWhere = `"status" IN ('pending', 'confirmed') AND "deleted_at" IS NULL`;
      const confirmedTeacherWhere = `"role" = 'teacher' AND "status" = 'confirmed' AND "deleted_at" IS NULL`;

      // What the entity declares: the TypeORM metadata, with the predicate as written.
      expect(
        dataSource
          .getMetadata(LessonAssignment)
          .indices.map((index) => ({
            name: index.name,
            unique: index.isUnique,
            where: index.where,
            columns: index.columns.map((column) => column.databaseName),
          }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      ).toEqual([
        {
          name: "idx_lesson_assignments_lesson_id",
          unique: false,
          where: undefined,
          columns: ["lesson_id"],
        },
        {
          name: "idx_lesson_assignments_person_id",
          unique: false,
          where: undefined,
          columns: ["person_id"],
        },
        {
          name: CONFIRMED_TEACHER_UNIQUE_INDEX,
          unique: true,
          where: confirmedTeacherWhere,
          columns: ["lesson_id"],
        },
        {
          name: ACTIVE_UNIQUE_INDEX,
          unique: true,
          where: activeWhere,
          columns: ["lesson_id", "person_id"],
        },
      ]);

      // What the migration created, as Postgres normalizes it (pg_indexes.indexdef).
      expect(await indexDefinition("lesson_assignments", ACTIVE_UNIQUE_INDEX)).toEqual([
        "CREATE UNIQUE INDEX uq_lesson_assignments_lesson_id_person_id_active ON public.lesson_assignments USING btree (lesson_id, person_id) WHERE ((status = ANY (ARRAY['pending'::lesson_assignments_status_enum, 'confirmed'::lesson_assignments_status_enum])) AND (deleted_at IS NULL))",
      ]);
      expect(await indexDefinition("lesson_assignments", CONFIRMED_TEACHER_UNIQUE_INDEX)).toEqual([
        "CREATE UNIQUE INDEX uq_lesson_assignments_lesson_id_confirmed_teacher ON public.lesson_assignments USING btree (lesson_id) WHERE ((role = 'teacher'::lesson_assignments_role_enum) AND (status = 'confirmed'::lesson_assignments_status_enum) AND (deleted_at IS NULL))",
      ]);
    });

    it("has idx_lesson_assignments_lesson_id and idx_lesson_assignments_person_id as plain indexes", async () => {
      const lessonIndex = await indexDefinition(
        "lesson_assignments",
        "idx_lesson_assignments_lesson_id",
      );
      const personIndex = await indexDefinition(
        "lesson_assignments",
        "idx_lesson_assignments_person_id",
      );

      expect(lessonIndex).toHaveLength(1);
      expect(lessonIndex[0]).not.toContain("UNIQUE");
      expect(lessonIndex[0]).not.toContain("WHERE");
      expect(lessonIndex[0]).toMatch(/\(lesson_id\)/);
      expect(personIndex).toHaveLength(1);
      expect(personIndex[0]).not.toContain("UNIQUE");
      expect(personIndex[0]).not.toContain("WHERE");
      expect(personIndex[0]).toMatch(/\(person_id\)/);
    });

    it("has the four check constraints declared by the entity", async () => {
      const declared = dataSource
        .getMetadata(LessonAssignment)
        .checks.map((check) => ({ name: check.name, expression: check.expression }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      expect(declared).toEqual([
        {
          name: "ck_lesson_assignments_cancellation",
          expression: `("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)`,
        },
        {
          name: "ck_lesson_assignments_cancelled_by",
          expression: `("cancelled_at" IS NULL) = ("cancelled_by_id" IS NULL)`,
        },
        {
          name: "ck_lesson_assignments_confirmed_reviewed",
          expression: `"status" <> 'confirmed' OR "reviewed_at" IS NOT NULL`,
        },
        {
          name: "ck_lesson_assignments_reviewed_by",
          expression: `("reviewed_at" IS NULL) = ("reviewed_by_id" IS NULL)`,
        },
      ]);

      const actual: Array<{ conname: string; definition: string }> = await dataSource.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'lesson_assignments'::regclass AND contype = 'c'`,
      );
      actual.sort((a, b) => a.conname.localeCompare(b.conname));

      expect(actual.map((check) => check.conname)).toEqual(declared.map((check) => check.name));
      const definitions = Object.fromEntries(actual.map((c) => [c.conname, c.definition]));
      expect(definitions.ck_lesson_assignments_cancellation).toMatch(/status\s*=\s*'cancelled'/);
      expect(definitions.ck_lesson_assignments_cancellation).toMatch(/cancelled_at IS NOT NULL/);
      expect(definitions.ck_lesson_assignments_cancelled_by).toMatch(/cancelled_at IS NULL/);
      expect(definitions.ck_lesson_assignments_cancelled_by).toMatch(/cancelled_by_id IS NULL/);
      expect(definitions.ck_lesson_assignments_reviewed_by).toMatch(/reviewed_at IS NULL/);
      expect(definitions.ck_lesson_assignments_reviewed_by).toMatch(/reviewed_by_id IS NULL/);
      expect(definitions.ck_lesson_assignments_confirmed_reviewed).toMatch(
        /status\s*<>\s*'confirmed'/,
      );
      expect(definitions.ck_lesson_assignments_confirmed_reviewed).toMatch(
        /reviewed_at IS NOT NULL/,
      );
    });

    it("keeps ASSIGNMENT_NOTE_MAX_LENGTH equal to the column length", async () => {
      // A DTO that accepts more than the column holds would turn into a 500 at the insert.
      const lengths = Object.fromEntries(
        (await actualColumns("lesson_assignments")).map((column) => [column.name, column.length]),
      );

      expect(lengths.note).toBe(ASSIGNMENT_NOTE_MAX_LENGTH);
    });

    it("has no archive columns: an assignment ends cancelled, not archived", async () => {
      const columns = (await actualColumns("lesson_assignments")).map((column) => column.name);

      expect(columns).not.toContain("archived_at");
      expect(columns).not.toContain("archived_by_id");
      expect(columns).not.toContain("archive_reason");
    });
  });

  describe("partial unique indexes", () => {
    it("rejects a second active assignment of the same person in the lesson with 23505 on uq_lesson_assignments_lesson_id_person_id_active", async () => {
      const { actor, ids } = await setUp();
      await createAssignment(ids, { role: AssignmentRole.MONITOR });

      // The same role again, the other role, and a confirmed one: any active one holds the place.
      await expect(createAssignment(ids, { role: AssignmentRole.MONITOR })).rejects.toMatchObject({
        code: "23505",
        constraint: ACTIVE_UNIQUE_INDEX,
      });
      await expect(createAssignment(ids, { role: AssignmentRole.TEACHER })).rejects.toMatchObject({
        code: "23505",
        constraint: ACTIVE_UNIQUE_INDEX,
      });
      await expect(
        createAssignment(ids, { role: AssignmentRole.TEACHER, ...confirmedBy(actor.id) }),
      ).rejects.toMatchObject({ code: "23505", constraint: ACTIVE_UNIQUE_INDEX });
    });

    it("lets the same person hold a place in two different lessons, and two people hold one each in the same lesson", async () => {
      const { ids, otherLessonId, otherMember } = await setUp();
      await createAssignment(ids);

      await createAssignment({ ...ids, lessonId: otherLessonId });
      await createAssignment({ ...ids, personId: otherMember.id });
    });

    it("rejects a second confirmed teacher in the lesson with 23505 on uq_lesson_assignments_lesson_id_confirmed_teacher", async () => {
      const { actor, ids, otherMember } = await setUp();
      await createAssignment(ids, { role: AssignmentRole.TEACHER, ...confirmedBy(actor.id) });

      await expect(
        createAssignment(
          { ...ids, personId: otherMember.id },
          { role: AssignmentRole.TEACHER, ...confirmedBy(actor.id) },
        ),
      ).rejects.toMatchObject({ code: "23505", constraint: CONFIRMED_TEACHER_UNIQUE_INDEX });
    });

    it("accepts what is not a second confirmed teacher: pending teachers, confirmed monitors and a confirmed teacher in another lesson", async () => {
      const { actor, ids, otherLessonId, otherMember, member } = await setUp();
      await createAssignment(ids, { role: AssignmentRole.TEACHER, ...confirmedBy(actor.id) });

      // A candidate for the teacher is not the teacher yet.
      await createAssignment(
        { ...ids, personId: otherMember.id },
        { role: AssignmentRole.TEACHER, status: AssignmentStatus.PENDING },
      );
      // The monitors are not limited by it, and the other lesson has a teacher of its own.
      const monitor = await peopleService.save({
        name: "Monitor Três",
        role: Role.MEMBER,
        accessEnabled: true,
      });
      await createAssignment(
        { ...ids, personId: monitor.id },
        { role: AssignmentRole.MONITOR, ...confirmedBy(actor.id) },
      );
      await createAssignment(
        { ...ids, lessonId: otherLessonId, personId: member.id },
        { role: AssignmentRole.TEACHER, ...confirmedBy(actor.id) },
      );
    });

    it("accepts a new active assignment after the previous one is cancelled, declined or expired", async () => {
      const { actor, ids } = await setUp();
      const first = await createAssignment(ids, {
        role: AssignmentRole.TEACHER,
        ...confirmedBy(actor.id),
      });
      await dataSource
        .getRepository(LessonAssignment)
        .save(Object.assign(first, cancelledBy(actor.id)));

      // The cancelled one freed the place of the person and the place of the teacher.
      const second = await createAssignment(ids, {
        role: AssignmentRole.TEACHER,
        ...confirmedBy(actor.id),
      });
      expect(second.id).not.toBe(first.id);

      // A declined application (only GUS-160 writes it) frees the place too.
      const declined = await peopleService.save({
        name: "Monitor Quatro",
        role: Role.MEMBER,
        accessEnabled: true,
      });
      await createAssignment(
        { ...ids, personId: declined.id },
        {
          status: AssignmentStatus.DECLINED,
          source: AssignmentSource.APPLICATION,
          reviewedById: actor.id,
          reviewedAt: new Date(),
        },
      );
      await createAssignment({ ...ids, personId: declined.id });

      // An expired application (GUS-179) frees it as well.
      const expired = await peopleService.save({
        name: "Monitor Cinco",
        role: Role.MEMBER,
        accessEnabled: true,
      });
      await createAssignment(
        { ...ids, personId: expired.id },
        { status: AssignmentStatus.EXPIRED, source: AssignmentSource.APPLICATION },
      );
      await createAssignment({ ...ids, personId: expired.id });
    });

    it("ignores soft-deleted rows in both indexes", async () => {
      const { actor, ids } = await setUp();
      const removed = await createAssignment(ids, {
        role: AssignmentRole.TEACHER,
        ...confirmedBy(actor.id),
      });
      await dataSource.query(`UPDATE lesson_assignments SET deleted_at = now() WHERE id = $1`, [
        removed.id,
      ]);

      await createAssignment(ids, { role: AssignmentRole.TEACHER, ...confirmedBy(actor.id) });
    });

    it("lets a cancelled assignment sit next to an active one of the same person in the same lesson", async () => {
      const { actor, ids } = await setUp();
      const cancelled = await createAssignment(ids, cancelledBy(actor.id));
      const active = await createAssignment(ids);

      const rows: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM lesson_assignments WHERE lesson_id = $1 AND person_id = $2`,
        [ids.lessonId, ids.personId],
      );
      expect(rows.map((row) => row.id).sort()).toEqual([cancelled.id, active.id].sort());
    });
  });

  describe("constraints", () => {
    it("rejects status cancelled without cancelled_at, and the reverse, with 23514 on ck_lesson_assignments_cancellation", async () => {
      const { actor, ids } = await setUp();

      await expect(
        createAssignment(ids, { status: AssignmentStatus.CANCELLED }),
      ).rejects.toMatchObject({ code: "23514", constraint: "ck_lesson_assignments_cancellation" });
      for (const status of [
        AssignmentStatus.PENDING,
        AssignmentStatus.DECLINED,
        AssignmentStatus.EXPIRED,
      ]) {
        await expect(
          createAssignment(ids, {
            status,
            cancelledAt: new Date(),
            cancelledById: actor.id,
          }),
        ).rejects.toMatchObject({
          code: "23514",
          constraint: "ck_lesson_assignments_cancellation",
        });
      }

      const cancelled = await createAssignment(ids, cancelledBy(actor.id));
      expect(cancelled.status).toBe(AssignmentStatus.CANCELLED);
    });

    it("rejects cancelled_at without cancelled_by_id, and the reverse, with 23514 on ck_lesson_assignments_cancelled_by", async () => {
      const { actor, ids } = await setUp();

      await expect(
        createAssignment(ids, { status: AssignmentStatus.CANCELLED, cancelledAt: new Date() }),
      ).rejects.toMatchObject({ code: "23514", constraint: "ck_lesson_assignments_cancelled_by" });
      await expect(createAssignment(ids, { cancelledById: actor.id })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_lesson_assignments_cancelled_by",
      });
    });

    it("rejects reviewed_at without reviewed_by_id, and the reverse, with 23514 on ck_lesson_assignments_reviewed_by", async () => {
      const { actor, ids } = await setUp();

      await expect(createAssignment(ids, { reviewedAt: new Date() })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_lesson_assignments_reviewed_by",
      });
      await expect(createAssignment(ids, { reviewedById: actor.id })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_lesson_assignments_reviewed_by",
      });
    });

    it("rejects a confirmed assignment without reviewed_at with 23514 on ck_lesson_assignments_confirmed_reviewed", async () => {
      const { actor, ids } = await setUp();

      await expect(
        createAssignment(ids, { status: AssignmentStatus.CONFIRMED }),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_lesson_assignments_confirmed_reviewed",
      });

      // A pending one has no reviewer yet, and one cancelled after being confirmed keeps who
      // confirmed it next to who cancelled it.
      await createAssignment(ids, { status: AssignmentStatus.PENDING });
      const other = await peopleService.save({ name: "Outra pessoa" });
      const cancelledAfterConfirmed = await createAssignment(
        { ...ids, personId: other.id },
        { ...confirmedBy(actor.id), ...cancelledBy(actor.id) },
      );
      expect(cancelledAfterConfirmed.status).toBe(AssignmentStatus.CANCELLED);
      expect(cancelledAfterConfirmed.reviewedById).toBe(actor.id);
    });

    it("rejects a lesson that does not exist with 23503 on fk_lesson_assignments_lesson_id", async () => {
      const { ids } = await setUp();

      await expect(createAssignment({ ...ids, lessonId: UNKNOWN_ID })).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_lesson_assignments_lesson_id",
      });
    });

    it("rejects a person that does not exist with 23503 on fk_lesson_assignments_person_id", async () => {
      const { ids } = await setUp();

      await expect(createAssignment({ ...ids, personId: UNKNOWN_ID })).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_lesson_assignments_person_id",
      });
    });

    it("rejects an assignment made by a person that does not exist with 23503 on fk_lesson_assignments_created_by_id", async () => {
      const { ids } = await setUp();

      await expect(createAssignment({ ...ids, createdById: UNKNOWN_ID })).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_lesson_assignments_created_by_id",
      });
    });

    it("rejects an assignment reviewed by a person that does not exist with 23503 on fk_lesson_assignments_reviewed_by_id", async () => {
      const { ids } = await setUp();

      await expect(
        createAssignment(ids, { reviewedById: UNKNOWN_ID, reviewedAt: new Date() }),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_lesson_assignments_reviewed_by_id",
      });
    });

    it("rejects an assignment cancelled by a person that does not exist with 23503 on fk_lesson_assignments_cancelled_by_id", async () => {
      const { ids } = await setUp();

      await expect(createAssignment(ids, cancelledBy(UNKNOWN_ID))).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_lesson_assignments_cancelled_by_id",
      });
    });

    it("defaults the status to pending and the source to direct when an insert does not say them", async () => {
      const { ids } = await setUp();

      const rows: Array<{ status: string; source: string }> = await dataSource.query(
        `INSERT INTO lesson_assignments (id, lesson_id, person_id, role, created_by_id)
         VALUES (gen_random_uuid(), $1, $2, 'monitor', $3)
         RETURNING status, source`,
        [ids.lessonId, ids.personId, ids.createdById],
      );

      expect(rows[0]).toEqual({ status: "pending", source: "direct" });
    });

    it("rejects a role, a status and a source outside their enums with 22P02", async () => {
      const { ids } = await setUp();

      for (const [column, value] of [
        ["role", "student"],
        ["status", "open"],
        ["source", "import"],
      ] as const) {
        const values: Record<string, string> = {
          role: "monitor",
          status: "pending",
          source: "direct",
          [column]: value,
        };
        await expect(
          dataSource.query(
            `INSERT INTO lesson_assignments (id, lesson_id, person_id, role, status, source, created_by_id)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
            [
              ids.lessonId,
              ids.personId,
              values.role,
              values.status,
              values.source,
              ids.createdById,
            ],
          ),
        ).rejects.toMatchObject({ code: "22P02" });
      }
    });

    it("rejects a status reason outside its enum with 22P02 (GUS-179)", async () => {
      const { ids } = await setUp();

      await expect(
        dataSource.query(
          `INSERT INTO lesson_assignments (id, lesson_id, person_id, role, created_by_id, status_reason)
           VALUES (gen_random_uuid(), $1, $2, 'monitor', $3, 'aula cancelada')`,
          [ids.lessonId, ids.personId, ids.createdById],
        ),
      ).rejects.toMatchObject({ code: "22P02" });
    });

    it("rejects an assignment without a lesson, a person, a role or an author with 23502", async () => {
      const { ids } = await setUp();

      for (const column of ["lesson_id", "person_id", "role", "created_by_id"]) {
        const values: Record<string, string | null> = {
          lesson_id: ids.lessonId,
          person_id: ids.personId,
          role: "monitor",
          created_by_id: ids.createdById,
          [column]: null,
        };

        await expect(
          dataSource.query(
            `INSERT INTO lesson_assignments (id, lesson_id, person_id, role, created_by_id)
             VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
            [values.lesson_id, values.person_id, values.role, values.created_by_id],
          ),
        ).rejects.toMatchObject({ code: "23502", column });
      }
    });

    it("rejects a note longer than the column with 22001", async () => {
      const { ids } = await setUp();

      await expect(
        createAssignment(ids, { note: "x".repeat(ASSIGNMENT_NOTE_MAX_LENGTH + 1) }),
      ).rejects.toMatchObject({ code: "22001" });
      await createAssignment(ids, { note: "x".repeat(ASSIGNMENT_NOTE_MAX_LENGTH) });
    });
  });

  describe("round trip", () => {
    it("round-trips every LessonAssignment field", async () => {
      const { actor, ids, member } = await setUp();
      const reviewedAt = new Date("2026-03-09T12:00:00.000Z");
      const cancelledAt = new Date("2026-03-09T13:30:00.000Z");

      const saved = await createAssignment(ids, {
        role: AssignmentRole.TEACHER,
        status: AssignmentStatus.CANCELLED,
        source: AssignmentSource.APPLICATION,
        note: "Disponível só neste horário.",
        reviewedById: actor.id,
        reviewedAt,
        cancelledById: actor.id,
        cancelledAt,
        statusReason: AssignmentStatusReason.LESSON_CANCELLED,
      });

      const loaded = await dataSource
        .getRepository(LessonAssignment)
        .findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        lessonId: ids.lessonId,
        personId: member.id,
        role: AssignmentRole.TEACHER,
        status: AssignmentStatus.CANCELLED,
        source: AssignmentSource.APPLICATION,
        note: "Disponível só neste horário.",
        createdById: actor.id,
        reviewedById: actor.id,
        cancelledById: actor.id,
        statusReason: AssignmentStatusReason.LESSON_CANCELLED,
        deletedAt: null,
      });
      expect(loaded.reviewedAt).toEqual(reviewedAt);
      expect(loaded.cancelledAt).toEqual(cancelledAt);
      expect(loaded.createdAt).toBeInstanceOf(Date);
      expect(loaded.updatedAt).toBeInstanceOf(Date);
      expect(loaded.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("keeps the optional columns null, the status pending and the source direct for a bare assignment", async () => {
      const { ids } = await setUp();

      const saved = await createAssignment(ids);

      const loaded = await dataSource
        .getRepository(LessonAssignment)
        .findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        role: AssignmentRole.MONITOR,
        status: AssignmentStatus.PENDING,
        source: AssignmentSource.DIRECT,
        note: null,
        reviewedById: null,
        reviewedAt: null,
        cancelledById: null,
        cancelledAt: null,
        statusReason: null,
      });
    });

    it("stores each role, status and source and reads them back as the enum value", async () => {
      const { actor, ids } = await setUp();

      for (const role of Object.values(AssignmentRole)) {
        const person = await peopleService.save({ name: `Pessoa ${role}` });
        const saved = await createAssignment({ ...ids, personId: person.id }, { role });

        const loaded = await dataSource
          .getRepository(LessonAssignment)
          .findOneByOrFail({ id: saved.id });
        expect(loaded.role).toBe(role);
      }

      for (const source of Object.values(AssignmentSource)) {
        const person = await peopleService.save({ name: `Pessoa ${source}` });
        const saved = await createAssignment({ ...ids, personId: person.id }, { source });

        const loaded = await dataSource
          .getRepository(LessonAssignment)
          .findOneByOrFail({ id: saved.id });
        expect(loaded.source).toBe(source);
      }

      for (const status of Object.values(AssignmentStatus)) {
        // Each status carries what its checks demand: the reviewer of a confirmed one, the
        // instant of a cancelled one. They go to the same lesson as people that were cancelled
        // or declined, so only the active ones hold a place.
        const extras: Partial<LessonAssignment> =
          status === AssignmentStatus.CONFIRMED
            ? confirmedBy(actor.id)
            : status === AssignmentStatus.CANCELLED
              ? cancelledBy(actor.id)
              : {};
        const person = await peopleService.save({ name: `Pessoa ${status}` });
        const saved = await createAssignment(
          { ...ids, personId: person.id },
          { status, ...extras },
        );

        const loaded = await dataSource
          .getRepository(LessonAssignment)
          .findOneByOrFail({ id: saved.id });
        expect(loaded.status).toBe(status);
      }
    });

    it("lists the assignments of a lesson and of a person through their indexes", async () => {
      const { ids, otherLessonId, otherMember } = await setUp();
      await createAssignment(ids);
      await createAssignment({ ...ids, personId: otherMember.id });
      await createAssignment({ ...ids, lessonId: otherLessonId });

      const ofLesson = await dataSource
        .getRepository(LessonAssignment)
        .find({ where: { lessonId: ids.lessonId } });
      const ofPerson = await dataSource
        .getRepository(LessonAssignment)
        .find({ where: { personId: ids.personId } });

      expect(ofLesson).toHaveLength(2);
      expect(ofPerson).toHaveLength(2);
    });
  });
});
