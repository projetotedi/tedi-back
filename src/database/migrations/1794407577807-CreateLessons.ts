import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLessons1794407577807 implements MigrationInterface {
  name = "CreateLessons1794407577807";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Status of a lesson (F4.5). A new status needs ALTER TYPE ... ADD VALUE.
    await queryRunner.query(
      `CREATE TYPE "public"."lessons_status_enum" AS ENUM('planned', 'confirmed', 'done', 'cancelled')`,
    );

    await queryRunner.query(`
      CREATE TABLE "lessons" (
        "id"                uuid                           NOT NULL,
        "created_at"        TIMESTAMP WITH TIME ZONE       NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP WITH TIME ZONE       NOT NULL DEFAULT now(),
        "deleted_at"        TIMESTAMP WITH TIME ZONE,
        "class_id"          uuid                           NOT NULL,
        "lesson_plan_id"    uuid,
        "sequence_order"    integer,
        "title"             character varying(200)         NOT NULL,
        "objective"         text,
        "date"              date                           NOT NULL,
        "start_time"        time                           NOT NULL,
        "end_time"          time                           NOT NULL,
        "location"          character varying(200),
        "expected_students" integer,
        "expected_monitors" integer,
        "subject"           character varying(200),
        "post_notes"        text,
        "status"            "public"."lessons_status_enum" NOT NULL DEFAULT 'planned',
        "cancel_reason"     text,
        "cancelled_at"      TIMESTAMP WITH TIME ZONE,
        "cancelled_by_id"   uuid,
        "original_date"     date,
        "reschedule_reason" text,
        "reschedule_note"   text,
        "created_by_id"     uuid                           NOT NULL,
        CONSTRAINT "PK_lessons" PRIMARY KEY ("id"),
        CONSTRAINT "ck_lessons_time_range" CHECK ("end_time" > "start_time"),
        CONSTRAINT "ck_lessons_sequence_order" CHECK ("sequence_order" IS NULL OR "sequence_order" >= 1),
        CONSTRAINT "ck_lessons_sequence_requires_plan" CHECK ("sequence_order" IS NULL OR "lesson_plan_id" IS NOT NULL),
        CONSTRAINT "ck_lessons_expected_students" CHECK ("expected_students" IS NULL OR "expected_students" >= 0),
        CONSTRAINT "ck_lessons_expected_monitors" CHECK ("expected_monitors" IS NULL OR "expected_monitors" >= 0),
        CONSTRAINT "ck_lessons_cancellation" CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL))
      )
    `);
    // "The lessons of this class, in order": the listing and the calendar of a class.
    await queryRunner.query(
      `CREATE INDEX "idx_lessons_class_id_date" ON "lessons" ("class_id", "date")`,
    );

    await queryRunner.query(
      `ALTER TABLE "lessons" ADD CONSTRAINT "fk_lessons_class_id" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lessons" ADD CONSTRAINT "fk_lessons_lesson_plan_id" FOREIGN KEY ("lesson_plan_id") REFERENCES "lesson_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lessons" ADD CONSTRAINT "fk_lessons_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lessons" ADD CONSTRAINT "fk_lessons_cancelled_by_id" FOREIGN KEY ("cancelled_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(`ALTER TABLE "lessons" DROP CONSTRAINT "fk_lessons_cancelled_by_id"`);
    await queryRunner.query(`ALTER TABLE "lessons" DROP CONSTRAINT "fk_lessons_created_by_id"`);
    await queryRunner.query(`ALTER TABLE "lessons" DROP CONSTRAINT "fk_lessons_lesson_plan_id"`);
    await queryRunner.query(`ALTER TABLE "lessons" DROP CONSTRAINT "fk_lessons_class_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lessons_class_id_date"`);
    await queryRunner.query(`DROP TABLE "lessons"`);
    await queryRunner.query(`DROP TYPE "public"."lessons_status_enum"`);
  }
}
