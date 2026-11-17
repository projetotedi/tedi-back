import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateClassListIndexes1795000000700 implements MigrationInterface {
  name = "CreateClassListIndexes1795000000700";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The search of the list of classes (GUS-103), over the code and the name of the class. The
    // expression is the one of the query (search_normalize(column) LIKE ...), see
    // CreateTextSearchIndexes and docs/ARCHITECTURE.md section 12. They exist only here: TypeORM
    // cannot declare an expression index on an entity. The name of the course is searched in the
    // catalog, over idx_courses_name_search (CreateCourseListIndexes).
    await queryRunner.query(
      `CREATE INDEX "idx_classes_code_search" ON "classes" USING gin (public.search_normalize("code") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_classes_name_search" ON "classes" USING gin (public.search_normalize("name") gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(`DROP INDEX "public"."idx_classes_name_search"`);
    await queryRunner.query(`DROP INDEX "public"."idx_classes_code_search"`);
  }
}
