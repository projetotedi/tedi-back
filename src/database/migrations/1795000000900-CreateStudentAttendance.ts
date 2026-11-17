import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The roll call of the students (GUS-166): the attendance of an enrollment at a lesson, and the
 * history of its corrections.
 *
 * - `student_attendance`: one attendance per enrollment per lesson, with who signed it and when, and
 *   the justification of an absence (only of an absence, and reason, who and when come together:
 *   the two CHECKs). The unique index is partial (`deleted_at IS NULL`) by the convention of the
 *   repository, though no row is ever soft-deleted. The foreign key to `enrollments` needs the
 *   migration of the enrollments (1795000000600), which runs before this one.
 * - `attendance_corrections`: append-only, by the trigger `trg_attendance_corrections_append_only`
 *   (UPDATE and DELETE raise 23001), the pattern of `hour_entry_events`. A row trigger does not fire
 *   on TRUNCATE, so the cleanup of the e2e still works. A correction changes the status and has a
 *   reason that is not blank.
 * - `student_attendance_status_enum` is shared by both tables (the status of an attendance, and the
 *   from and to of a correction), as `hour_entry_events` reuses `hour_entries_status_enum`.
 * - `down()` drops everything in the reverse order, with no IF EXISTS: a broken revert must fail
 *   loudly in CI.
 */
export class CreateStudentAttendance1795000000900 implements MigrationInterface {
  name = "CreateStudentAttendance1795000000900";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."student_attendance_status_enum" AS ENUM('present', 'absent')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."student_attendance_justification_reason_enum" AS ENUM('health', 'other')`,
    );
    await queryRunner.query(`
      CREATE TABLE "student_attendance" (
        "id"                   uuid                                                    NOT NULL,
        "created_at"           TIMESTAMP WITH TIME ZONE                                NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMP WITH TIME ZONE                                NOT NULL DEFAULT now(),
        "deleted_at"           TIMESTAMP WITH TIME ZONE,
        "lesson_id"            uuid                                                    NOT NULL,
        "enrollment_id"        uuid                                                    NOT NULL,
        "status"               "public"."student_attendance_status_enum"               NOT NULL,
        "signed_by_id"         uuid                                                    NOT NULL,
        "signed_at"            TIMESTAMP WITH TIME ZONE                                NOT NULL,
        "justification_reason" "public"."student_attendance_justification_reason_enum",
        "justification_note"   character varying(500),
        "justified_by_id"      uuid,
        "justified_at"         TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_student_attendance" PRIMARY KEY ("id"),
        CONSTRAINT "ck_student_attendance_justification_absent" CHECK ("justification_reason" IS NULL OR "status" = 'absent'),
        CONSTRAINT "ck_student_attendance_justification_columns" CHECK (("justification_reason" IS NULL) = ("justified_by_id" IS NULL) AND ("justification_reason" IS NULL) = ("justified_at" IS NULL) AND ("justification_note" IS NULL OR "justification_reason" IS NOT NULL))
      )
    `);
    // One attendance per enrollment per lesson.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_student_attendance_lesson_id_enrollment_id" ON "student_attendance" ("lesson_id", "enrollment_id") WHERE "deleted_at" IS NULL`,
    );
    // The attendance rate of an enrollment, and "has attendance" before it is removed.
    await queryRunner.query(
      `CREATE INDEX "idx_student_attendance_enrollment_id" ON "student_attendance" ("enrollment_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_attendance" ADD CONSTRAINT "fk_student_attendance_lesson_id" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_attendance" ADD CONSTRAINT "fk_student_attendance_enrollment_id" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_attendance" ADD CONSTRAINT "fk_student_attendance_signed_by_id" FOREIGN KEY ("signed_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_attendance" ADD CONSTRAINT "fk_student_attendance_justified_by_id" FOREIGN KEY ("justified_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "attendance_corrections" (
        "id"                    uuid                                      NOT NULL,
        "created_at"            TIMESTAMP WITH TIME ZONE                  NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP WITH TIME ZONE                  NOT NULL DEFAULT now(),
        "deleted_at"            TIMESTAMP WITH TIME ZONE,
        "student_attendance_id" uuid                                      NOT NULL,
        "from_status"           "public"."student_attendance_status_enum" NOT NULL,
        "to_status"             "public"."student_attendance_status_enum" NOT NULL,
        "reason"                character varying(500)                    NOT NULL,
        "corrected_by_id"       uuid                                      NOT NULL,
        CONSTRAINT "PK_attendance_corrections" PRIMARY KEY ("id"),
        CONSTRAINT "ck_attendance_corrections_status_changed" CHECK ("from_status" <> "to_status"),
        CONSTRAINT "ck_attendance_corrections_reason" CHECK (length(btrim("reason")) > 0)
      )
    `);
    // The history of one attendance.
    await queryRunner.query(
      `CREATE INDEX "idx_attendance_corrections_student_attendance_id" ON "attendance_corrections" ("student_attendance_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_corrections" ADD CONSTRAINT "fk_attendance_corrections_student_attendance_id" FOREIGN KEY ("student_attendance_id") REFERENCES "student_attendance"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_corrections" ADD CONSTRAINT "fk_attendance_corrections_corrected_by_id" FOREIGN KEY ("corrected_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`
      CREATE FUNCTION "public"."attendance_corrections_append_only"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'attendance_corrections is append-only: % is not allowed', TG_OP
          USING ERRCODE = 'restrict_violation';
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_attendance_corrections_append_only"
      BEFORE UPDATE OR DELETE ON "attendance_corrections"
      FOR EACH ROW EXECUTE FUNCTION "public"."attendance_corrections_append_only"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "trg_attendance_corrections_append_only" ON "attendance_corrections"`,
    );
    await queryRunner.query(`DROP FUNCTION "public"."attendance_corrections_append_only"()`);
    await queryRunner.query(
      `ALTER TABLE "attendance_corrections" DROP CONSTRAINT "fk_attendance_corrections_corrected_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_corrections" DROP CONSTRAINT "fk_attendance_corrections_student_attendance_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_attendance_corrections_student_attendance_id"`,
    );
    await queryRunner.query(`DROP TABLE "attendance_corrections"`);

    await queryRunner.query(
      `ALTER TABLE "student_attendance" DROP CONSTRAINT "fk_student_attendance_justified_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_attendance" DROP CONSTRAINT "fk_student_attendance_signed_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_attendance" DROP CONSTRAINT "fk_student_attendance_enrollment_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_attendance" DROP CONSTRAINT "fk_student_attendance_lesson_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_student_attendance_enrollment_id"`);
    await queryRunner.query(`DROP INDEX "public"."uq_student_attendance_lesson_id_enrollment_id"`);
    await queryRunner.query(`DROP TABLE "student_attendance"`);
    await queryRunner.query(`DROP TYPE "public"."student_attendance_justification_reason_enum"`);
    await queryRunner.query(`DROP TYPE "public"."student_attendance_status_enum"`);
  }
}
