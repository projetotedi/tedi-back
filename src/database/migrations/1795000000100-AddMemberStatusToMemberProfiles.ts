import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Participation of a member in the project and her exit (GUS-147, RF-011, F1.6), on
 * member_profiles:
 *
 *  - status (member_profiles_status_enum): active or inactive. A new value needs
 *    ALTER TYPE ... ADD VALUE;
 *  - exit_date, exit_reason, exit_note: the exit, filled by the deactivation and cleared by the
 *    reactivation. exit_note is never returned by the API nor put in an event (RNF-13);
 *  - deactivated_at, deactivated_by_id: who deactivated and when.
 *
 * NOT NULL DEFAULT 'active' marks every existing row as active (pending, approved and rejected):
 * no manual backfill, and on Postgres 11+ ADD COLUMN ... DEFAULT does not rewrite the table.
 * ck_member_profiles_exit_date ties status inactive to exit_date, like ck_lessons_cancellation.
 * The foreign key points at the table name, like the other ones of member_profiles.
 *
 * down() has no IF EXISTS on purpose: a broken down() must fail loudly in CI.
 */
export class AddMemberStatusToMemberProfiles1795000000100 implements MigrationInterface {
  name = "AddMemberStatusToMemberProfiles1795000000100";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."member_profiles_status_enum" AS ENUM('active', 'inactive')`,
    );
    await queryRunner.query(`
      ALTER TABLE "member_profiles"
        ADD "status"            "public"."member_profiles_status_enum" NOT NULL DEFAULT 'active',
        ADD "exit_date"         date,
        ADD "exit_reason"       character varying(200),
        ADD "exit_note"         text,
        ADD "deactivated_at"    TIMESTAMP WITH TIME ZONE,
        ADD "deactivated_by_id" uuid,
        ADD CONSTRAINT "ck_member_profiles_exit_date" CHECK (("status" = 'inactive') = ("exit_date" IS NOT NULL))
    `);
    await queryRunner.query(
      `ALTER TABLE "member_profiles" ADD CONSTRAINT "fk_member_profiles_deactivated_by_id" FOREIGN KEY ("deactivated_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "member_profiles" DROP CONSTRAINT "fk_member_profiles_deactivated_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_profiles" DROP CONSTRAINT "ck_member_profiles_exit_date"`,
    );
    await queryRunner.query(`
      ALTER TABLE "member_profiles"
        DROP COLUMN "deactivated_by_id",
        DROP COLUMN "deactivated_at",
        DROP COLUMN "exit_note",
        DROP COLUMN "exit_reason",
        DROP COLUMN "exit_date",
        DROP COLUMN "status"
    `);
    await queryRunner.query(`DROP TYPE "public"."member_profiles_status_enum"`);
  }
}
