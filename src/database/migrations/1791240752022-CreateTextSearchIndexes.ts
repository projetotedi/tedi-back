import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTextSearchIndexes1791240752022 implements MigrationInterface {
  name = "CreateTextSearchIndexes1791240752022";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_people_name_search" ON "people" USING gin (public.search_normalize("name") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_people_ra_search" ON "people" USING gin (public.search_normalize("ra") gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_people_ra_search"`);
    await queryRunner.query(`DROP INDEX "public"."idx_people_name_search"`);
  }
}
