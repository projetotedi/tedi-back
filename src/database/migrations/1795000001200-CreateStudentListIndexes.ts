import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateStudentListIndexes1795000001200 implements MigrationInterface {
  name = "CreateStudentListIndexes1795000001200";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The search of the list of students (GUS-106) finds a phone by its digits even when it was
    // stored with a mask (an import or a fix by SQL): the API writes digits only, the database does
    // not enforce it. The shared search takes "alias.column", never an expression, so the digits are
    // a stored generated column, which Postgres keeps in step with "phone".
    await queryRunner.query(
      `ALTER TABLE "people" ADD "phone_digits" character varying(20) GENERATED ALWAYS AS (regexp_replace("phone", '[^0-9]', '', 'g')) STORED`,
    );
    // The expression of each index is the one of the query (search_normalize(column) LIKE ... and
    // phone_digits LIKE ...), see CreateTextSearchIndexes and docs/ARCHITECTURE.md section 12. They
    // exist only here: TypeORM cannot declare an expression index on an entity. The name is searched
    // over idx_people_name_search (CreateTextSearchIndexes).
    await queryRunner.query(
      `CREATE INDEX "idx_people_email_search" ON "people" USING gin (public.search_normalize("email") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_people_phone_digits_search" ON "people" USING gin ("phone_digits" gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(`DROP INDEX "public"."idx_people_phone_digits_search"`);
    await queryRunner.query(`DROP INDEX "public"."idx_people_email_search"`);
    await queryRunner.query(`ALTER TABLE "people" DROP COLUMN "phone_digits"`);
  }
}
