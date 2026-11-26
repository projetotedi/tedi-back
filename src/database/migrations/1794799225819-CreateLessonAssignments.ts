import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLessonAssignments1794799225819 implements MigrationInterface {
  name = "CreateLessonAssignments1794799225819";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // What the member does in the lesson (RF-047). A new role needs ALTER TYPE ... ADD VALUE.
    await queryRunner.query(
      `CREATE TYPE "public"."lesson_assignments_role_enum" AS ENUM('teacher', 'monitor')`,
    );
    // Where the assignment stands (F5.2). A new status needs ALTER TYPE ... ADD VALUE.
    await queryRunner.query(
      `CREATE TYPE "public"."lesson_assignments_status_enum" AS ENUM('pending', 'confirmed', 'declined', 'cancelled')`,
    );
    // How it came to exist: made by coordination or a director, or applied for by the member (GUS-160).
    await queryRunner.query(
      `CREATE TYPE "public"."lesson_assignments_source_enum" AS ENUM('direct', 'application')`,
    );

    await queryRunner.query(`
      CREATE TABLE "lesson_assignments" (
        "id"              uuid                                       NOT NULL,
        "created_at"      TIMESTAMP WITH TIME ZONE                   NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMP WITH TIME ZONE                   NOT NULL DEFAULT now(),
        "deleted_at"      TIMESTAMP WITH TIME ZONE,
        "lesson_id"       uuid                                       NOT NULL,
        "person_id"       uuid                                       NOT NULL,
        "role"            "public"."lesson_assignments_role_enum"    NOT NULL,
        "status"          "public"."lesson_assignments_status_enum"  NOT NULL DEFAULT 'pending',
        "source"          "public"."lesson_assignments_source_enum"  NOT NULL DEFAULT 'direct',
        "note"            character varying(500),
        "created_by_id"   uuid                                       NOT NULL,
        "reviewed_by_id"  uuid,
        "reviewed_at"     TIMESTAMP WITH TIME ZONE,
        "cancelled_by_id" uuid,
        "cancelled_at"    TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_lesson_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "ck_lesson_assignments_cancellation" CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)),
        CONSTRAINT "ck_lesson_assignments_cancelled_by" CHECK (("cancelled_at" IS NULL) = ("cancelled_by_id" IS NULL)),
        CONSTRAINT "ck_lesson_assignments_reviewed_by" CHECK (("reviewed_at" IS NULL) = ("reviewed_by_id" IS NULL)),
        CONSTRAINT "ck_lesson_assignments_confirmed_reviewed" CHECK ("status" <> 'confirmed' OR "reviewed_at" IS NOT NULL)
      )
    `);

    // One place per member in a lesson, as teacher or as monitor (RN-01): a pending or confirmed
    // assignment holds it, a cancelled or declined one frees it. The database says it, not only
    // the service, because two requests at the same time pass the pre-check together.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_lesson_assignments_lesson_id_person_id_active" ON "lesson_assignments" ("lesson_id", "person_id") WHERE "status" IN ('pending', 'confirmed') AND "deleted_at" IS NULL`,
    );
    // At most one CONFIRMED teacher per lesson (RN-02). Pending teachers are candidates, and a
    // monitor is never in this index.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_lesson_assignments_lesson_id_confirmed_teacher" ON "lesson_assignments" ("lesson_id") WHERE "role" = 'teacher' AND "status" = 'confirmed' AND "deleted_at" IS NULL`,
    );
    // "The staff of this lesson" (the list and the coverage) and "the lessons of this member".
    await queryRunner.query(
      `CREATE INDEX "idx_lesson_assignments_lesson_id" ON "lesson_assignments" ("lesson_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lesson_assignments_person_id" ON "lesson_assignments" ("person_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" ADD CONSTRAINT "fk_lesson_assignments_lesson_id" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" ADD CONSTRAINT "fk_lesson_assignments_person_id" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" ADD CONSTRAINT "fk_lesson_assignments_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" ADD CONSTRAINT "fk_lesson_assignments_reviewed_by_id" FOREIGN KEY ("reviewed_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" ADD CONSTRAINT "fk_lesson_assignments_cancelled_by_id" FOREIGN KEY ("cancelled_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" DROP CONSTRAINT "fk_lesson_assignments_cancelled_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" DROP CONSTRAINT "fk_lesson_assignments_reviewed_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" DROP CONSTRAINT "fk_lesson_assignments_created_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" DROP CONSTRAINT "fk_lesson_assignments_person_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" DROP CONSTRAINT "fk_lesson_assignments_lesson_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_lesson_assignments_person_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lesson_assignments_lesson_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_lesson_assignments_lesson_id_confirmed_teacher"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_lesson_assignments_lesson_id_person_id_active"`,
    );
    await queryRunner.query(`DROP TABLE "lesson_assignments"`);
    await queryRunner.query(`DROP TYPE "public"."lesson_assignments_source_enum"`);
    await queryRunner.query(`DROP TYPE "public"."lesson_assignments_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."lesson_assignments_role_enum"`);
  }
}
