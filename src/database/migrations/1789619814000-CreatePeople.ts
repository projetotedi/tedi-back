import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePeople1789619814000 implements MigrationInterface {
  name = "CreatePeople1789619814000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."people_role_enum" AS ENUM('member', 'director', 'coordinator')`,
    );

    await queryRunner.query(`
      CREATE TABLE "people" (
        "id"                  uuid          NOT NULL,
        "created_at"          timestamptz   NOT NULL DEFAULT now(),
        "updated_at"          timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"          timestamptz,
        "name"                varchar(200)  NOT NULL,
        "email"               varchar(200),
        "ra"                  varchar(20),
        "password_hash"       varchar(255),
        "role"                "public"."people_role_enum",
        "access_enabled"      boolean       NOT NULL DEFAULT true,
        "must_change_password" boolean      NOT NULL DEFAULT false,
        "is_super_admin"      boolean       NOT NULL DEFAULT false,
        CONSTRAINT "PK_people" PRIMARY KEY ("id")
      )
    `);

    // Partial unique indexes: duplicates allowed only when value is NULL.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_people_email" ON "people" ("email") WHERE "email" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_people_ra" ON "people" ("ra") WHERE "ra" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_people_ra"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_people_email"`);
    await queryRunner.query(`DROP TABLE "people"`);
    await queryRunner.query(`DROP TYPE "public"."people_role_enum"`);
  }
}
