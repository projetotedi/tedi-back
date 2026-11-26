import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCourseLessonPlans1793073287348 implements MigrationInterface {
  name = "CreateCourseLessonPlans1793073287348";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // RF-014, RF-016: "lesson_plan_id is taught at position in course_id". The order lives on the
    // link, so the same plan can be in two courses at different positions (RN-17). The position
    // starts at 1. The workload of the course is not stored: it is the sum of the durations of the
    // plans, calculated when read (RN-24).
    await queryRunner.query(`
      CREATE TABLE "course_lesson_plans" (
        "id"             uuid                     NOT NULL,
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at"     TIMESTAMP WITH TIME ZONE,
        "course_id"      uuid                     NOT NULL,
        "lesson_plan_id" uuid                     NOT NULL,
        "position"       integer                  NOT NULL,
        CONSTRAINT "PK_course_lesson_plans" PRIMARY KEY ("id"),
        CONSTRAINT "ck_course_lesson_plans_position" CHECK ("position" >= 1)
      )
    `);

    // A plan appears at most once in a course.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_course_lesson_plans_course_id_lesson_plan_id" ON "course_lesson_plans" ("course_id", "lesson_plan_id")`,
    );
    // A position is taken by at most one plan of the course; it also serves reading the sequence in order.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_course_lesson_plans_course_id_position" ON "course_lesson_plans" ("course_id", "position")`,
    );
    // "In how many courses is this plan" (courseCount) and the list of use of a plan (GUS-96).
    await queryRunner.query(
      `CREATE INDEX "idx_course_lesson_plans_lesson_plan_id" ON "course_lesson_plans" ("lesson_plan_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "course_lesson_plans" ADD CONSTRAINT "fk_course_lesson_plans_course_id" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_lesson_plans" ADD CONSTRAINT "fk_course_lesson_plans_lesson_plan_id" FOREIGN KEY ("lesson_plan_id") REFERENCES "lesson_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(
      `ALTER TABLE "course_lesson_plans" DROP CONSTRAINT "fk_course_lesson_plans_lesson_plan_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_lesson_plans" DROP CONSTRAINT "fk_course_lesson_plans_course_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_course_lesson_plans_lesson_plan_id"`);
    await queryRunner.query(`DROP INDEX "public"."uq_course_lesson_plans_course_id_position"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_course_lesson_plans_course_id_lesson_plan_id"`,
    );
    await queryRunner.query(`DROP TABLE "course_lesson_plans"`);
  }
}
