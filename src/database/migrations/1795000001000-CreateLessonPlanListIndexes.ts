import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLessonPlanListIndexes1795000001000 implements MigrationInterface {
  name = "CreateLessonPlanListIndexes1795000001000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The search of the list of lesson plans (GUS-95): the title, and the text of the contents for
    // the filter Conteúdo and its suggestions. The expression is the one of the query
    // (search_normalize(column) LIKE ...), see CreateTextSearchIndexes and docs/ARCHITECTURE.md
    // section 12. They exist only here: TypeORM cannot declare an expression index on an entity.
    await queryRunner.query(
      `CREATE INDEX "idx_lesson_plans_title_search" ON "lesson_plans" USING gin (public.search_normalize("title") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lesson_plan_contents_text_search" ON "lesson_plan_contents" USING gin (public.search_normalize("text") gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(`DROP INDEX "public"."idx_lesson_plan_contents_text_search"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lesson_plans_title_search"`);
  }
}
