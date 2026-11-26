import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLessonListIndexes1794799292211 implements MigrationInterface {
  name = "CreateLessonListIndexes1794799292211";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The calendar of every class: "the lessons between two days", with no class in the filter.
    // The index on (class_id, date) of CreateLessons only serves the lessons of one class.
    await queryRunner.query(`CREATE INDEX "idx_lessons_date" ON "lessons" ("date")`);

    // The search of the list and the calendar of lessons (GUS-153), over the title and the subject.
    // The expression is the one of the query (search_normalize(column) LIKE ...), see
    // CreateTextSearchIndexes and docs/ARCHITECTURE.md section 12. Both exist only here: TypeORM
    // cannot declare an expression index on an entity.
    await queryRunner.query(
      `CREATE INDEX "idx_lessons_title_search" ON "lessons" USING gin (public.search_normalize("title") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lessons_subject_search" ON "lessons" USING gin (public.search_normalize("subject") gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(`DROP INDEX "public"."idx_lessons_subject_search"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lessons_title_search"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lessons_date"`);
  }
}
