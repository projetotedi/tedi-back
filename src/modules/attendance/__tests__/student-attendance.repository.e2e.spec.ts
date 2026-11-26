import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource, EntityTarget, ObjectLiteral } from "typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { CourseCategory, CoursesService } from "@modules/catalog/services/courses.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { LessonsService } from "@modules/lessons/services/lessons.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import {
  ABSENCE_JUSTIFICATION_NOTE_MAX_LENGTH,
  ATTENDANCE_CORRECTION_REASON_MAX_LENGTH,
} from "../dto/attendance-limits";
import { AttendanceCorrection } from "../entities/attendance-correction.entity";
import { StudentAttendance } from "../entities/student-attendance.entity";
import { AbsenceJustificationReason } from "../enums/absence-justification-reason.enum";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";
import {
  CLASS_PERIOD,
  FIRST_ENROLLED_AT,
  insertEnrollment,
  insertStudent,
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
const SIGNED_AT = new Date("2026-03-10T18:30:00.000Z");

/**
 * Every entity: the foreign keys of StudentAttendance point to "lessons", "enrollments" and "people"
 * by table name, and that only resolves when those entities are loaded.
 */
const ALL_ENTITIES = [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")];

/** Postgres udt_name for each TypeORM column type used by the entities. */
const UDT_NAME: Record<string, string> = {
  uuid: "uuid",
  timestamptz: "timestamptz",
  varchar: "varchar",
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

interface IndexShape {
  name: string | undefined;
  unique: boolean;
  where: string | undefined;
  columns: string[];
}

/** A lesson of 2026-03-10, an enrollment expected at it, and the coordinator who signs. */
interface Scenery {
  coordinatorId: string;
  lessonId: string;
  enrollmentId: string;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

describe("student attendance repository (e2e)", () => {
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
      `TRUNCATE TABLE attendance_corrections, student_attendance, enrollments, lessons, classes,
                      editions, courses, student_profiles, people
       RESTART IDENTITY CASCADE`,
    );
  });

  /** What the entity declares. TypeORM keeps `length` as "" when unset. */
  function declaredColumns(entity: EntityTarget<ObjectLiteral>): ColumnShape[] {
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

  /** What the migration created. is_nullable is YES or NO and the length may be null. */
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

  function declaredForeignKeys(entity: EntityTarget<ObjectLiteral>): ForeignKeyShape[] {
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

  /** Sorted by name: class decorators apply bottom up, so the metadata is not in code order. */
  function declaredIndexes(entity: EntityTarget<ObjectLiteral>): IndexShape[] {
    return dataSource
      .getMetadata(entity)
      .indices.map((index) => ({
        name: index.name,
        unique: index.isUnique,
        where: index.where,
        columns: index.columns.map((column) => column.databaseName),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async function indexDefinition(table: string, name: string): Promise<string[]> {
    const rows: Array<{ indexdef: string }> = await dataSource.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2`,
      [table, name],
    );
    return rows.map((row) => row.indexdef);
  }

  function declaredChecks(entity: EntityTarget<ObjectLiteral>) {
    return dataSource
      .getMetadata(entity)
      .checks.map((check) => ({ name: check.name, expression: check.expression }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function actualChecks(table: string): Promise<Record<string, string>> {
    const rows: Array<{ conname: string; definition: string }> = await dataSource.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = $1::regclass AND contype = 'c'
        ORDER BY conname`,
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
   * A lesson of 2026-03-10 in a class of the period of the scenery, a student enrolled in the class
   * before it (FIRST_ENROLLED_AT), and the coordinator who signs. Through the services the other
   * modules export and the fixtures they own, not their tables.
   */
  async function setUp(): Promise<Scenery> {
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
    const studentId = await insertStudent(dataSource, {
      name: "Maria Aparecida",
      createdById: coordinator.id,
    });
    const enrollmentId = await insertEnrollment(dataSource, {
      classId: schoolClass.id,
      studentId,
      createdById: coordinator.id,
      enrolledAt: FIRST_ENROLLED_AT,
    });

    return { coordinatorId: coordinator.id, lessonId: lesson.id, enrollmentId };
  }

  /** An absence of the enrollment signed by the coordinator, unless `overrides` says otherwise. */
  function createAttendance(
    scenery: Scenery,
    overrides: Partial<StudentAttendance> = {},
  ): Promise<StudentAttendance> {
    const repository = dataSource.getRepository(StudentAttendance);
    return repository.save(
      repository.create({
        lessonId: scenery.lessonId,
        enrollmentId: scenery.enrollmentId,
        status: StudentAttendanceStatus.ABSENT,
        signedById: scenery.coordinatorId,
        signedAt: SIGNED_AT,
        ...overrides,
      }),
    );
  }

  /** A correction of `attendance` from absent to present, unless `overrides` says otherwise. */
  function createCorrection(
    scenery: Scenery,
    attendance: StudentAttendance,
    overrides: Partial<AttendanceCorrection> = {},
  ): Promise<AttendanceCorrection> {
    const repository = dataSource.getRepository(AttendanceCorrection);
    return repository.save(
      repository.create({
        studentAttendanceId: attendance.id,
        fromStatus: StudentAttendanceStatus.ABSENT,
        toStatus: StudentAttendanceStatus.PRESENT,
        reason: "Marcado por engano.",
        correctedById: scenery.coordinatorId,
        ...overrides,
      }),
    );
  }

  describe("schema vs entity", () => {
    it("matches the entity metadata column by column for student_attendance and attendance_corrections", async () => {
      expect(await actualColumns("student_attendance")).toEqual(declaredColumns(StudentAttendance));
      expect(await actualColumns("attendance_corrections")).toEqual(
        declaredColumns(AttendanceCorrection),
      );
    });

    it("has student_attendance_status_enum and student_attendance_justification_reason_enum with the values of the TS enums, in order", async () => {
      expect(await enumLabels("student_attendance_status_enum")).toEqual(
        Object.values(StudentAttendanceStatus),
      );
      expect(await enumLabels("student_attendance_justification_reason_enum")).toEqual(
        Object.values(AbsenceJustificationReason),
      );
    });

    it("has the named foreign keys of student_attendance (lessons, enrollments, people twice) and of attendance_corrections (student_attendance, people)", async () => {
      const attendance = declaredForeignKeys(StudentAttendance);
      expect(attendance.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_student_attendance_enrollment_id",
        "fk_student_attendance_justified_by_id",
        "fk_student_attendance_lesson_id",
        "fk_student_attendance_signed_by_id",
      ]);
      expect(attendance.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "enrollments",
        "people",
        "lessons",
        "people",
      ]);
      expect(await actualForeignKeys("student_attendance")).toEqual(attendance);

      const corrections = declaredForeignKeys(AttendanceCorrection);
      expect(corrections.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_attendance_corrections_corrected_by_id",
        "fk_attendance_corrections_student_attendance_id",
      ]);
      expect(corrections.map((foreignKey) => foreignKey.referenced_table)).toEqual([
        "people",
        "student_attendance",
      ]);
      expect(await actualForeignKeys("attendance_corrections")).toEqual(corrections);
    });

    it("has uq_student_attendance_lesson_id_enrollment_id with its predicate, idx_student_attendance_enrollment_id and idx_attendance_corrections_student_attendance_id, declared by the entities and created by the migration", async () => {
      expect(declaredIndexes(StudentAttendance)).toEqual([
        {
          name: "idx_student_attendance_enrollment_id",
          unique: false,
          where: undefined,
          columns: ["enrollment_id"],
        },
        {
          name: "uq_student_attendance_lesson_id_enrollment_id",
          unique: true,
          where: `"deleted_at" IS NULL`,
          columns: ["lesson_id", "enrollment_id"],
        },
      ]);
      expect(declaredIndexes(AttendanceCorrection)).toEqual([
        {
          name: "idx_attendance_corrections_student_attendance_id",
          unique: false,
          where: undefined,
          columns: ["student_attendance_id"],
        },
      ]);

      // What the migration created, as Postgres normalizes it (pg_indexes.indexdef).
      expect(
        await indexDefinition(
          "student_attendance",
          "uq_student_attendance_lesson_id_enrollment_id",
        ),
      ).toEqual([
        "CREATE UNIQUE INDEX uq_student_attendance_lesson_id_enrollment_id ON public.student_attendance USING btree (lesson_id, enrollment_id) WHERE (deleted_at IS NULL)",
      ]);
      const byEnrollment = await indexDefinition(
        "student_attendance",
        "idx_student_attendance_enrollment_id",
      );
      expect(byEnrollment).toHaveLength(1);
      expect(byEnrollment[0]).not.toContain("UNIQUE");
      expect(byEnrollment[0]).toMatch(/\(enrollment_id\)/);
      const byAttendance = await indexDefinition(
        "attendance_corrections",
        "idx_attendance_corrections_student_attendance_id",
      );
      expect(byAttendance).toHaveLength(1);
      expect(byAttendance[0]).not.toContain("UNIQUE");
      expect(byAttendance[0]).toMatch(/\(student_attendance_id\)/);
    });

    it("has the four CHECKs declared by the entities and created by the migration", async () => {
      expect(declaredChecks(StudentAttendance)).toEqual([
        {
          name: "ck_student_attendance_justification_absent",
          expression: `"justification_reason" IS NULL OR "status" = 'absent'`,
        },
        {
          name: "ck_student_attendance_justification_columns",
          expression: `("justification_reason" IS NULL) = ("justified_by_id" IS NULL) AND ("justification_reason" IS NULL) = ("justified_at" IS NULL) AND ("justification_note" IS NULL OR "justification_reason" IS NOT NULL)`,
        },
      ]);
      expect(declaredChecks(AttendanceCorrection)).toEqual([
        { name: "ck_attendance_corrections_reason", expression: `length(btrim("reason")) > 0` },
        {
          name: "ck_attendance_corrections_status_changed",
          expression: `"from_status" <> "to_status"`,
        },
      ]);

      const attendance = await actualChecks("student_attendance");
      expect(Object.keys(attendance)).toEqual([
        "ck_student_attendance_justification_absent",
        "ck_student_attendance_justification_columns",
      ]);
      expect(attendance.ck_student_attendance_justification_absent).toMatch(
        /justification_reason IS NULL/,
      );
      expect(attendance.ck_student_attendance_justification_absent).toMatch(/'absent'/);
      expect(attendance.ck_student_attendance_justification_columns).toMatch(
        /justified_by_id IS NULL/,
      );
      expect(attendance.ck_student_attendance_justification_columns).toMatch(
        /justified_at IS NULL/,
      );
      expect(attendance.ck_student_attendance_justification_columns).toMatch(
        /justification_note IS NULL/,
      );

      const corrections = await actualChecks("attendance_corrections");
      expect(Object.keys(corrections)).toEqual([
        "ck_attendance_corrections_reason",
        "ck_attendance_corrections_status_changed",
      ]);
      expect(corrections.ck_attendance_corrections_reason).toMatch(/length\(btrim\(/);
      expect(corrections.ck_attendance_corrections_status_changed).toMatch(
        /from_status <> to_status/,
      );
    });

    it("has the append-only trigger on attendance_corrections and none on student_attendance", async () => {
      const triggersOf = async (table: string): Promise<string[]> => {
        const rows: Array<{ tgname: string }> = await dataSource.query(
          `SELECT tgname FROM pg_trigger
            WHERE tgrelid = $1::regclass AND NOT tgisinternal
            ORDER BY tgname`,
          [table],
        );
        return rows.map((row) => row.tgname);
      };

      expect(await triggersOf("attendance_corrections")).toEqual([
        "trg_attendance_corrections_append_only",
      ]);
      expect(await triggersOf("student_attendance")).toEqual([]);
    });

    it("keeps the max lengths of the DTOs equal to the length of the columns", async () => {
      const rows: Array<{ table_name: string; column_name: string; length: number }> =
        await dataSource.query(
          `SELECT table_name, column_name, character_maximum_length AS length
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND ((table_name = 'student_attendance' AND column_name = 'justification_note')
                OR (table_name = 'attendance_corrections' AND column_name = 'reason'))
            ORDER BY table_name`,
        );

      expect(rows).toEqual([
        {
          table_name: "attendance_corrections",
          column_name: "reason",
          length: ATTENDANCE_CORRECTION_REASON_MAX_LENGTH,
        },
        {
          table_name: "student_attendance",
          column_name: "justification_note",
          length: ABSENCE_JUSTIFICATION_NOTE_MAX_LENGTH,
        },
      ]);
    });
  });

  describe("constraints", () => {
    it("rejects a justification on a presence, a justification without who or when, and a note without a reason with 23514", async () => {
      const scenery = await setUp();
      const justified = {
        justificationReason: AbsenceJustificationReason.HEALTH,
        justifiedById: scenery.coordinatorId,
        justifiedAt: SIGNED_AT,
      };

      await expect(
        createAttendance(scenery, { status: StudentAttendanceStatus.PRESENT, ...justified }),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_student_attendance_justification_absent",
      });

      const broken: Array<Partial<StudentAttendance>> = [
        { ...justified, justifiedById: null },
        { ...justified, justifiedAt: null },
        { justificationNote: "Sem motivo." },
        { justifiedById: scenery.coordinatorId, justifiedAt: SIGNED_AT },
      ];
      for (const overrides of broken) {
        await expect(createAttendance(scenery, overrides)).rejects.toMatchObject({
          code: "23514",
          constraint: "ck_student_attendance_justification_columns",
        });
      }

      await createAttendance(scenery, { ...justified, justificationNote: "Consulta médica." });
    });

    it("rejects a correction to the same status and a blank reason with 23514", async () => {
      const scenery = await setUp();
      const attendance = await createAttendance(scenery);

      await expect(
        createCorrection(scenery, attendance, { toStatus: StudentAttendanceStatus.ABSENT }),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_attendance_corrections_status_changed",
      });
      for (const reason of ["", "   "]) {
        await expect(createCorrection(scenery, attendance, { reason })).rejects.toMatchObject({
          code: "23514",
          constraint: "ck_attendance_corrections_reason",
        });
      }

      await createCorrection(scenery, attendance);
    });

    it("rejects UPDATE and DELETE on attendance_corrections with 23001", async () => {
      const scenery = await setUp();
      const correction = await createCorrection(scenery, await createAttendance(scenery));

      await expect(
        dataSource.query(`UPDATE attendance_corrections SET reason = 'editado' WHERE id = $1`, [
          correction.id,
        ]),
      ).rejects.toMatchObject({ code: "23001" });
      await expect(
        dataSource.query(`DELETE FROM attendance_corrections WHERE id = $1`, [correction.id]),
      ).rejects.toMatchObject({ code: "23001" });
      await expect(
        dataSource.getRepository(AttendanceCorrection).softDelete({ id: correction.id }),
      ).rejects.toMatchObject({ code: "23001" });

      const rows: Array<{ reason: string; deleted_at: Date | null }> = await dataSource.query(
        `SELECT reason, deleted_at FROM attendance_corrections WHERE id = $1`,
        [correction.id],
      );
      expect(rows).toEqual([{ reason: "Marcado por engano.", deleted_at: null }]);
    });

    it("rejects a second row of the same enrollment in the same lesson with 23505, and accepts it once the first is soft-deleted", async () => {
      const scenery = await setUp();
      const first = await createAttendance(scenery);

      await expect(
        createAttendance(scenery, { status: StudentAttendanceStatus.PRESENT }),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_student_attendance_lesson_id_enrollment_id",
      });

      await dataSource
        .getRepository(StudentAttendance)
        .update({ id: first.id }, { deletedAt: new Date("2026-03-11T12:00:00.000Z") });
      await createAttendance(scenery, { status: StudentAttendanceStatus.PRESENT });
    });

    it("rejects an unknown lesson, enrollment, signer, justifier and corrector with 23503 on their named foreign keys", async () => {
      const scenery = await setUp();

      const unknown: Array<[Partial<StudentAttendance>, string]> = [
        [{ lessonId: UNKNOWN_ID }, "fk_student_attendance_lesson_id"],
        [{ enrollmentId: UNKNOWN_ID }, "fk_student_attendance_enrollment_id"],
        [{ signedById: UNKNOWN_ID }, "fk_student_attendance_signed_by_id"],
        [
          {
            justificationReason: AbsenceJustificationReason.OTHER,
            justifiedById: UNKNOWN_ID,
            justifiedAt: SIGNED_AT,
          },
          "fk_student_attendance_justified_by_id",
        ],
      ];
      for (const [overrides, constraint] of unknown) {
        await expect(createAttendance(scenery, overrides)).rejects.toMatchObject({
          code: "23503",
          constraint,
        });
      }

      const attendance = await createAttendance(scenery);
      await expect(
        createCorrection(scenery, attendance, { correctedById: UNKNOWN_ID }),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_attendance_corrections_corrected_by_id",
      });
      await expect(
        createCorrection(scenery, Object.assign(new StudentAttendance(), { id: UNKNOWN_ID })),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "fk_attendance_corrections_student_attendance_id",
      });
    });
  });

  describe("round trip", () => {
    it("round-trips every field of both entities", async () => {
      const scenery = await setUp();
      const now = new Date("2026-03-10T18:45:00.000Z");

      const saved = await createAttendance(scenery, {
        justificationReason: AbsenceJustificationReason.HEALTH,
        justificationNote: "Consulta médica marcada.",
        justifiedById: scenery.coordinatorId,
        justifiedAt: now,
        createdAt: SIGNED_AT,
        updatedAt: now,
      });
      const loaded = await dataSource
        .getRepository(StudentAttendance)
        .findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        lessonId: scenery.lessonId,
        enrollmentId: scenery.enrollmentId,
        status: StudentAttendanceStatus.ABSENT,
        signedById: scenery.coordinatorId,
        justificationReason: AbsenceJustificationReason.HEALTH,
        justificationNote: "Consulta médica marcada.",
        justifiedById: scenery.coordinatorId,
        deletedAt: null,
      });
      expect(loaded.signedAt).toEqual(SIGNED_AT);
      expect(loaded.justifiedAt).toEqual(now);
      expect(loaded.createdAt).toEqual(SIGNED_AT);
      expect(loaded.updatedAt).toEqual(now);
      expect(loaded.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      const correction = await createCorrection(scenery, loaded, {
        createdAt: now,
        updatedAt: now,
      });
      const loadedCorrection = await dataSource
        .getRepository(AttendanceCorrection)
        .findOneByOrFail({ id: correction.id });
      expect(loadedCorrection).toMatchObject({
        studentAttendanceId: saved.id,
        fromStatus: StudentAttendanceStatus.ABSENT,
        toStatus: StudentAttendanceStatus.PRESENT,
        reason: "Marcado por engano.",
        correctedById: scenery.coordinatorId,
        deletedAt: null,
      });
      expect(loadedCorrection.createdAt).toEqual(now);
      expect(loadedCorrection.updatedAt).toEqual(now);
    });
  });
});
