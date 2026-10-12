import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMustChangePasswordToPeople1791845492992 implements MigrationInterface {
  name = "AddMustChangePasswordToPeople1791845492992";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // GUS-93, decision 16 of E9.a. Existing accounts keep their password: the flag defaults to
    // false and only the seed of the initial coordinator turns it on.
    await queryRunner.query(
      `ALTER TABLE "people" ADD "must_change_password" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(`ALTER TABLE "people" DROP COLUMN "must_change_password"`);
  }
}
