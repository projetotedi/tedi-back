import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Last access of a person (GUS-122, "Meu perfil"): two nullable columns on people.
 *
 *  - last_login_at:     instant of the most recent successful login;
 *  - previous_login_at: the login that came right before it.
 *
 * A successful login moves last_login_at into previous_login_at and stamps last_login_at with
 * now(), in one UPDATE (PeopleService.recordLogin). The "last access" that GET /members/me
 * shows is previous_login_at: read after the login of the current session, last_login_at would
 * only be the login that just happened. Both stay null until the person logs in (first login:
 * last_login_at is set and previous_login_at stays null; second login: previous_login_at is
 * filled). No backfill (the past logins were never recorded) and no index (read by id only).
 */
export class AddLastLoginAtToPeople1793030058856 implements MigrationInterface {
  name = "AddLastLoginAtToPeople1793030058856";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "people" ADD "last_login_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `ALTER TABLE "people" ADD "previous_login_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(`ALTER TABLE "people" DROP COLUMN "previous_login_at"`);
    await queryRunner.query(`ALTER TABLE "people" DROP COLUMN "last_login_at"`);
  }
}
