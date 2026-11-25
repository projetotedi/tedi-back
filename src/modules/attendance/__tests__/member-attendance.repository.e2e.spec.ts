import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource } from "typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { CourseCategory, CoursesService } from "@modules/catalog/services/courses.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { LessonsService } from "@modules/lessons/services/lessons.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import { MemberAttendance } from "../entities/member-attendance.entity";
import { MemberAttendanceStatus } from "../enums/member-attendance-status.enum";
import {
  CLASS_PERIOD,
  insertAssignment,
  insertAttendanceHourEntry,
  lessonBody,
} from "./fixtures/attendance.fixture";

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
 * Every entity: the foreign keys of MemberAttendance point to "lesson_assignments", "lessons",
 * "people" and "hour_entries" by table name, and that only resolves when those entities are loaded.
 */
const ALL_ENTITIES = [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")];

/** Postgres udt_name for each TypeORM column type used by the entity. */
const UDT_NAME: Record<string, string> = {
  uuid: "uuid",
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

/** A confirmed teacher assignment of a lesson, its member, who signs and an hour entry of hers. */
interface Scenery {
  memberId: string;
  coordinatorId: string;
  classId: string;
  lessonId: string;
  assignmentId: string;
  hourEntryId: string;
}

function byName(a: ColumnShape, b: ColumnShape): number {
  return a.name.localeCompare(b.name);
}

describe("member attendance repository (e2e)", () => {
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
          entities: ALL_ENTITIES,
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
      `TRUNCATE TABLE member_attendance, hour_entry_events, hour_entries, lesson_assignments,
                      lessons, classes, editions, course_lesson_plans, lesson_plan_contents,
                      lesson_plans, course_prerequisites, courses, people
       RESTART IDENTITY CASCADE`,
    );
  });

  /** What the entity declares. TypeORM keeps `length` as "" when unset. */
  function declaredColumns(): ColumnShape[] {
    return dataSource
      .getMetadata(MemberAttendance)
      .columns.map((column) => ({
        name: column.databaseName,
        type: column.type === "enum" ? (column.enumName ?? "") : UDT_NAME[String(column.type)],
        length: column.length ? Number(column.length) : null,
        nullable: column.isNullable,
      }))
      .sort(byName);
  }

  /** What the migration created. is_nullable is YES or NO and the length may be null. */
  async function actualColumns(): Promise<ColumnShape[]> {
    const rows: Array<{
      column_name: string;
      udt_name: string;
      character_maximum_length: number | null;
      is_nullable: "YES" | "NO";
    }> = await dataSource.query(
      `SELECT column_name, udt_name, character_maximum_length, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'member_attendance'`,
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

  async function actualForeignKeys(): Promise<ForeignKeyShape[]> {
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
          AND tc.table_name = 'member_attendance'
        ORDER BY tc.constraint_name`,
    );
  }

  function declaredForeignKeys(): ForeignKeyShape[] {
    return dataSource
      .getMetadata(MemberAttendance)
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
        WHERE schemaname = 'public' AND tablename = 'member_attendance' AND indexname = $1`,
      [name],
    );
    return rows.map((row) => row.indexdef);
  }

  /**
   * The member (a teacher confirmed in a lesson of 2026-03-10) and the coordinator who confirmed the
   * assignment and signs the attendance, with an attendance hour entry of the member in the lesson.
   * Through the services the other modules export and the fixtures they own, not their tables.
   */
  async function setUp(): Promise<Scenery> {
    const member = await peopleService.save({ name: "Member" });
    const coordinator = await peopleService.save({ name: "Coordinator" });
    const course = await coursesService.create(
      {
        name: "Informática Básica",
        description: "Fundamentos do uso do computador.",
        category: CourseCategory.BASIC,
      },
      coordinator.id,
    );
    const schoolClass = await classesService.create(
      {
        courseId: course.id,
        code: "INFO-A",
        editionName: "2026.1",
        startDate: CLASS_PERIOD.startDate,
        endDate: CLASS_PERIOD.endDate,
        capacity: 15,
      },
      coordinator.id,
    );
    const body = lessonBody();
    const lesson = await lessonsService.create(
      {
        classId: schoolClass.id,
        title: String(body.title),
        date: String(body.date),
        startTime: String(body.startTime),
        endTime: String(body.endTime),
      },
      coordinator.id,
    );
    const assignmentId = await insertAssignment(dataSource, {
      lessonId: lesson.id,
      personId: member.id,
      createdById: coordinator.id,
      role: "teacher",
      status: "confirmed",
      reviewedById: coordinator.id,
      reviewedAt: new Date("2026-03-09T12:00:00.000Z"),
    });
    const hourEntryId = await insertAttendanceHourEntry(dataSource, {
      personId: member.id,
      createdById: coordinator.id,
      lessonId: lesson.id,
      classId: schoolClass.id,
    });

    return {
      memberId: member.id,
      coordinatorId: coordinator.id,
      classId: schoolClass.id,
      lessonId: lesson.id,
      assignmentId,
      hourEntryId,
    };
  }

  /** A presence of the member signed by the coordinator, unless `overrides` says otherwise. */
  function createAttendance(
    scenery: Scenery,
    overrides: Partial<MemberAttendance> = {},
  ): Promise<MemberAttendance> {
    const repository = dataSource.getRepository(MemberAttendance);
    return repository.save(
      repository.create({
        assignmentId: scenery.assignmentId,
        lessonId: scenery.lessonId,
        personId: scenery.memberId,
        status: MemberAttendanceStatus.PRESENT,
        confirmedById: scenery.coordinatorId,
        confirmedAt: new Date("2026-03-10T18:30:00.000Z"),
        hourEntryId: scenery.hourEntryId,
        ...overrides,
      }),
    );
  }

  describe("schema vs entity", () => {
    it("matches the entity metadata column by column (name, type, length, nullability)", async () => {
      expect(await actualColumns()).toEqual(declaredColumns());
    });

    it("has the enum type member_attendance_status_enum with the values of MemberAttendanceStatus, in order", async () => {
      const rows: Array<{ enumlabel: string }> = await dataSource.query(
        `SELECT e.enumlabel
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'member_attendance_status_enum'
          ORDER BY e.enumsortorder`,
      );
      expect(rows.map((row) => row.enumlabel)).toEqual(Object.values(MemberAttendanceStatus));
    });

    it("has the five named foreign keys of member_attendance to lesson_assignments, lessons, people and hour_entries", async () => {
      const declared = declaredForeignKeys();

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_member_attendance_assignment_id",
        "fk_member_attendance_confirmed_by_id",
        "fk_member_attendance_hour_entry_id",
        "fk_member_attendance_lesson_id",
        "fk_member_attendance_person_id",
      ]);
      expect(declared.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "lesson_assignments",
        "people",
        "hour_entries",
        "lessons",
        "people",
      ]);
      expect(await actualForeignKeys()).toEqual(declared);
    });

    it("has uq_member_attendance_lesson_id_person_id with its predicate and idx_member_attendance_person_id, declared by the entity and created by the migration", async () => {
      // Sorted by name: class decorators apply bottom up, so the metadata is not in code order.
      expect(
        dataSource
          .getMetadata(MemberAttendance)
          .indices.map((index) => ({
            name: index.name,
            unique: index.isUnique,
            where: index.where,
            columns: index.columns.map((column) => column.databaseName),
          }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      ).toEqual([
        {
          name: "idx_member_attendance_person_id",
          unique: false,
          where: undefined,
          columns: ["person_id"],
        },
        {
          name: "uq_member_attendance_lesson_id_person_id",
          unique: true,
          where: `"deleted_at" IS NULL`,
          columns: ["lesson_id", "person_id"],
        },
      ]);

      // What the migration created, as Postgres normalizes it (pg_indexes.indexdef).
      expect(await indexDefinition("uq_member_attendance_lesson_id_person_id")).toEqual([
        "CREATE UNIQUE INDEX uq_member_attendance_lesson_id_person_id ON public.member_attendance USING btree (lesson_id, person_id) WHERE (deleted_at IS NULL)",
      ]);
      const byPerson = await indexDefinition("idx_member_attendance_person_id");
      expect(byPerson).toHaveLength(1);
      expect(byPerson[0]).not.toContain("UNIQUE");
      expect(byPerson[0]).toMatch(/\(person_id\)/);
    });

    it("has ck_member_attendance_hour_entry declared by the entity and created by the migration", async () => {
      expect(
        dataSource
          .getMetadata(MemberAttendance)
          .checks.map((check) => ({ name: check.name, expression: check.expression })),
      ).toEqual([
        {
          name: "ck_member_attendance_hour_entry",
          expression: `("status" = 'present') = ("hour_entry_id" IS NOT NULL)`,
        },
      ]);

      const rows: Array<{ conname: string; definition: string }> = await dataSource.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'member_attendance'::regclass AND contype = 'c'`,
      );
      expect(rows.map((row) => row.conname)).toEqual(["ck_member_attendance_hour_entry"]);
      expect(rows[0].definition).toMatch(/'present'/);
      expect(rows[0].definition).toMatch(/hour_entry_id IS NOT NULL/);
    });
  });

  describe("constraints", () => {
    it("rejects a presence without hour entry and an absence with one with 23514 on ck_member_attendance_hour_entry", async () => {
      const scenery = await setUp();

      await expect(createAttendance(scenery, { hourEntryId: null })).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_member_attendance_hour_entry",
      });
      await expect(
        createAttendance(scenery, { status: MemberAttendanceStatus.ABSENT }),
      ).rejects.toMatchObject({ code: "23514", constraint: "ck_member_attendance_hour_entry" });

      await createAttendance(scenery, { status: MemberAttendanceStatus.ABSENT, hourEntryId: null });
    });

    it("rejects a second row of the same person in the same lesson with 23505, and accepts it once the first is soft-deleted", async () => {
      const scenery = await setUp();
      const first = await createAttendance(scenery);

      await expect(
        createAttendance(scenery, { status: MemberAttendanceStatus.ABSENT, hourEntryId: null }),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_member_attendance_lesson_id_person_id",
      });

      await dataSource
        .getRepository(MemberAttendance)
        .update({ id: first.id }, { deletedAt: new Date("2026-03-11T12:00:00.000Z") });
      await createAttendance(scenery, { status: MemberAttendanceStatus.ABSENT, hourEntryId: null });
    });

    it("rejects an unknown assignment, lesson, person, signer and hour entry with 23503 on their named foreign keys", async () => {
      const scenery = await setUp();

      const unknown: Array<[Partial<MemberAttendance>, string]> = [
        [{ assignmentId: UNKNOWN_ID }, "fk_member_attendance_assignment_id"],
        [{ lessonId: UNKNOWN_ID }, "fk_member_attendance_lesson_id"],
        [{ personId: UNKNOWN_ID }, "fk_member_attendance_person_id"],
        [{ confirmedById: UNKNOWN_ID }, "fk_member_attendance_confirmed_by_id"],
        [{ hourEntryId: UNKNOWN_ID }, "fk_member_attendance_hour_entry_id"],
      ];
      for (const [overrides, constraint] of unknown) {
        await expect(createAttendance(scenery, overrides)).rejects.toMatchObject({
          code: "23503",
          constraint,
        });
      }
    });
  });

  describe("round trip", () => {
    it("round-trips every field, with the instant given by the caller", async () => {
      const scenery = await setUp();
      const now = new Date("2026-03-10T18:30:00.000Z");

      const saved = await createAttendance(scenery, {
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const loaded = await dataSource
        .getRepository(MemberAttendance)
        .findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        assignmentId: scenery.assignmentId,
        lessonId: scenery.lessonId,
        personId: scenery.memberId,
        status: MemberAttendanceStatus.PRESENT,
        confirmedById: scenery.coordinatorId,
        hourEntryId: scenery.hourEntryId,
        deletedAt: null,
      });
      expect(loaded.confirmedAt).toEqual(now);
      expect(loaded.createdAt).toEqual(now);
      expect(loaded.updatedAt).toEqual(now);
      expect(loaded.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });
});
