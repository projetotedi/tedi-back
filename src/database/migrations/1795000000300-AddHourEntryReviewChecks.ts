import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The checks of the review of an hour entry (GUS-164), the safety net of what HoursReviewService
 * writes:
 * - `ck_hour_entries_review_columns`: pending if and only if there are no validated minutes, no
 *   reviewer and no instant of review;
 * - `ck_hour_entries_review_minutes`: approved keeps the declared minutes, adjusted changes them and
 *   rejected is 0;
 * - `ck_hour_entries_review_note`: a review note if and only if adjusted or rejected.
 *
 * Only ADD CONSTRAINT: before this card no route reviews an entry, so every row is pending and
 * without review. `down()` has no IF EXISTS on purpose: a broken revert must fail loudly in CI.
 */
export class AddHourEntryReviewChecks1795000000300 implements MigrationInterface {
  name = "AddHourEntryReviewChecks1795000000300";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hour_entries" ADD CONSTRAINT "ck_hour_entries_review_columns" CHECK (("status" = 'pending') = ("validated_minutes" IS NULL) AND ("status" = 'pending') = ("reviewed_by_id" IS NULL) AND ("status" = 'pending') = ("reviewed_at" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" ADD CONSTRAINT "ck_hour_entries_review_minutes" CHECK (("status" <> 'approved' OR "validated_minutes" = "declared_minutes") AND ("status" <> 'adjusted' OR "validated_minutes" <> "declared_minutes") AND ("status" <> 'rejected' OR "validated_minutes" = 0))`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" ADD CONSTRAINT "ck_hour_entries_review_note" CHECK (("status" IN ('adjusted', 'rejected')) = ("review_note" IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hour_entries" DROP CONSTRAINT "ck_hour_entries_review_note"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" DROP CONSTRAINT "ck_hour_entries_review_minutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" DROP CONSTRAINT "ck_hour_entries_review_columns"`,
    );
  }
}
