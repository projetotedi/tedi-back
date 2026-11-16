import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The enrollments of the students in the classes (GUS-108, docs/ARCHITECTURE.md section 19).
 *
 * - `enrollments_status_enum`: active, dropped, completed. A new status needs `ALTER TYPE`.
 * - One LIVE enrollment per class and student (`uq_enrollments_class_id_student_id`, partial on
 *   `deleted_at IS NULL`): a removed enrollment frees the pair, and enrolling again is a new row.
 * - `idx_enrollments_student_id` serves the history of a student, `currentClasses` and the count of
 *   the archive of a student. `class_id` is served by the unique index, where it leads.
 * - `ck_enrollments_status_changed_at`: the status holds from a day that is not before the day of
 *   the enrollment in America/Sao_Paulo. The zone is literal (`AT TIME ZONE`), so the check does
 *   not depend on the `TimeZone` of the session; the entity declares the same text.
 * - The student is a row of `people` (as `lesson_assignments.person_id`): "is a student" is a rule
 *   of the service (the student profile), not of the foreign key.
 * - `down()` has no IF EXISTS: a broken revert must fail loudly in CI.
 */
export class CreateEnrollments1795000000600 implements MigrationInterface {
  name = "CreateEnrollments1795000000600";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."enrollments_status_enum" AS ENUM('active', 'dropped', 'completed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "enrollments" (
        "id"                uuid                               NOT NULL,
        "created_at"        TIMESTAMP WITH TIME ZONE           NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP WITH TIME ZONE           NOT NULL DEFAULT now(),
        "deleted_at"        TIMESTAMP WITH TIME ZONE,
        "class_id"          uuid                               NOT NULL,
        "student_id"        uuid                               NOT NULL,
        "status"            "public"."enrollments_status_enum" NOT NULL DEFAULT 'active',
        "enrolled_at"       TIMESTAMP WITH TIME ZONE           NOT NULL,
        "status_changed_at" date                               NOT NULL,
        "status_reason"     character varying(500),
        "created_by_id"     uuid                               NOT NULL,
        CONSTRAINT "PK_enrollments" PRIMARY KEY ("id"),
        CONSTRAINT "ck_enrollments_status_changed_at" CHECK ("status_changed_at" >= ("enrolled_at" AT TIME ZONE 'America/Sao_Paulo')::date)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_enrollments_class_id_student_id" ON "enrollments" ("class_id", "student_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_enrollments_student_id" ON "enrollments" ("student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_class_id" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_student_id" FOREIGN KEY ("student_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrollments" ADD CONSTRAINT "fk_enrollments_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrollments" DROP CONSTRAINT "fk_enrollments_created_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrollments" DROP CONSTRAINT "fk_enrollments_student_id"`,
    );
    await queryRunner.query(`ALTER TABLE "enrollments" DROP CONSTRAINT "fk_enrollments_class_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_enrollments_student_id"`);
    await queryRunner.query(`DROP INDEX "public"."uq_enrollments_class_id_student_id"`);
    await queryRunner.query(`DROP TABLE "enrollments"`);
    await queryRunner.query(`DROP TYPE "public"."enrollments_status_enum"`);
  }
}
