import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCourseListIndexes1795000000600 implements MigrationInterface {
  name = "CreateCourseListIndexes1795000000600";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The search of the list of courses (GUS-99), over the name. The expression is the one of the
    // query (search_normalize(column) LIKE ...), see CreateTextSearchIndexes and
    // docs/ARCHITECTURE.md section 12. It exists only here: TypeORM cannot declare an expression
    // index on an entity. The unique index uq_courses_name, on LOWER(name), does not serve it.
    await queryRunner.query(
      `CREATE INDEX "idx_courses_name_search" ON "courses" USING gin (public.search_normalize("name") gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(`DROP INDEX "public"."idx_courses_name_search"`);
  }
}
