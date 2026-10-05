import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTextSearch1791240752021 implements MigrationInterface {
  name = "AddTextSearch1791240752021";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.search_normalize(value text)
      RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
      AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, value)) $$
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_people_name_search" ON "people" USING gin (public.search_normalize("name") gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_people_ra_search" ON "people" USING gin (public.search_normalize("ra") gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_people_ra_search"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_people_name_search"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.search_normalize(text)`);
  }
}
