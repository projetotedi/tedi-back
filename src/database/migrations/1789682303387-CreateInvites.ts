import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInvites1789682303387 implements MigrationInterface {
  name = "CreateInvites1789682303387";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."invites_type_enum" AS ENUM('access', 'password_reset')`,
    );

    await queryRunner.query(`
      CREATE TABLE "invites" (
        "id"            uuid                          NOT NULL,
        "created_at"    TIMESTAMP WITH TIME ZONE      NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP WITH TIME ZONE      NOT NULL DEFAULT now(),
        "deleted_at"    TIMESTAMP WITH TIME ZONE,
        "type"          "public"."invites_type_enum"  NOT NULL,
        "role"          "public"."people_role_enum",
        "person_id"     uuid,
        "token_hash"    character varying(64)         NOT NULL,
        "expires_at"    TIMESTAMP WITH TIME ZONE      NOT NULL,
        "used_at"       TIMESTAMP WITH TIME ZONE,
        "revoked_at"    TIMESTAMP WITH TIME ZONE,
        "created_by_id" uuid                          NOT NULL,
        CONSTRAINT "PK_invites" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_invites_token_hash" ON "invites" ("token_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."uq_invites_token_hash"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invites"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."invites_type_enum"`);
  }
}
