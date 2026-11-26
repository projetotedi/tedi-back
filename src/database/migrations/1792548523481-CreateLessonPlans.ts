import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLessonPlans1792548523481 implements MigrationInterface {
  name = "CreateLessonPlans1792548523481";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "lesson_plans" (
        "id"                        uuid                     NOT NULL,
        "created_at"                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at"                TIMESTAMP WITH TIME ZONE,
        "title"                     character varying(200)   NOT NULL,
        "objective"                 text,
        "expected_duration_minutes" integer                  NOT NULL,
        "material_url"              character varying(500),
        "created_by_id"             uuid                     NOT NULL,
        "archived_at"               TIMESTAMP WITH TIME ZONE,
        "archived_by_id"            uuid,
        "archive_reason"            text,
        CONSTRAINT "PK_lesson_plans" PRIMARY KEY ("id"),
        CONSTRAINT "ck_lesson_plans_expected_duration_minutes" CHECK ("expected_duration_minutes" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "lesson_plan_contents" (
        "id"             uuid                     NOT NULL,
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at"     TIMESTAMP WITH TIME ZONE,
        "lesson_plan_id" uuid                     NOT NULL,
        "position"       integer                  NOT NULL,
        "text"           text                     NOT NULL,
        CONSTRAINT "PK_lesson_plan_contents" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_lesson_plan_contents_lesson_plan_id_position" ON "lesson_plan_contents" ("lesson_plan_id", "position")`,
    );

    await queryRunner.query(
      `ALTER TABLE "lesson_plans" ADD CONSTRAINT "fk_lesson_plans_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_plans" ADD CONSTRAINT "fk_lesson_plans_archived_by_id" FOREIGN KEY ("archived_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_plan_contents" ADD CONSTRAINT "fk_lesson_plan_contents_lesson_plan_id" FOREIGN KEY ("lesson_plan_id") REFERENCES "lesson_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lesson_plan_contents" DROP CONSTRAINT "fk_lesson_plan_contents_lesson_plan_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_plans" DROP CONSTRAINT "fk_lesson_plans_archived_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_plans" DROP CONSTRAINT "fk_lesson_plans_created_by_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_lesson_plan_contents_lesson_plan_id_position"`,
    );
    await queryRunner.query(`DROP TABLE "lesson_plan_contents"`);
    await queryRunner.query(`DROP TABLE "lesson_plans"`);
  }
}
