import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSearchNormalizeFunction1791240752021 implements MigrationInterface {
  name = "CreateSearchNormalizeFunction1791240752021";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.search_normalize(value text)
      RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
      AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, value)) $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION public.search_normalize(text)`);
  }
}
