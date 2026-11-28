import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Cancelling a lesson ends its assignments (GUS-179).
 *
 * - `lesson_assignments_status_enum` gains 'expired', LAST (the e2e of the schema compares the order
 *   with the TS enum): an application nobody decided before its lesson was cancelled. Nothing in
 *   this migration uses the new label: the migrations run in one transaction, and a label added in
 *   a transaction cannot be used before its commit. The CHECKs and the partial unique indexes stay
 *   as they are: 'expired' is neither 'cancelled' nor 'confirmed', and it frees the place.
 * - `status_reason`: why the system ended the assignment, a stable code the front translates
 *   (`lesson_assignments_status_reason_enum`, only 'lesson_cancelled' for now). Null for every row
 *   that exists: nothing is backfilled, and a lesson cancelled before this card is repaired by
 *   cancelling it again.
 * - `down()` cannot drop an enum label: it recreates the type without 'expired' and moves the column
 *   to it, which also means dropping and recreating what compares the column with a label (its
 *   default, two CHECKs and the two partial unique indexes). An expired row was a pending
 *   application, so it goes back to 'pending', where the code before this card left it (in the
 *   queue until someone declined it). One that would break the unique index of the active place
 *   (the member holds another place in the lesson: a direct assignment took it, GUS-179) becomes
 *   'declined' instead, the other status of an application that left the queue, without a
 *   reviewer. No IF EXISTS: a broken revert must fail loudly in CI.
 */
export class AddExpiredStatusAndReasonToLessonAssignments1795825200000 implements MigrationInterface {
  name = "AddExpiredStatusAndReasonToLessonAssignments1795825200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."lesson_assignments_status_enum" ADD VALUE 'expired'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lesson_assignments_status_reason_enum" AS ENUM('lesson_cancelled')`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" ADD "status_reason" "public"."lesson_assignments_status_reason_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // At most one per member and lesson goes back to pending: the newest, where no other row
    // holds her place.
    await queryRunner.query(
      `UPDATE "lesson_assignments" SET "status" = 'pending'
        WHERE "id" IN (
          SELECT DISTINCT ON ("lesson_id", "person_id") "id"
            FROM "lesson_assignments" AS "expired"
           WHERE "status" = 'expired'
             AND "deleted_at" IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM "lesson_assignments" AS "active"
                WHERE "active"."lesson_id" = "expired"."lesson_id"
                  AND "active"."person_id" = "expired"."person_id"
                  AND "active"."status" IN ('pending', 'confirmed')
                  AND "active"."deleted_at" IS NULL
             )
           ORDER BY "lesson_id", "person_id", "created_at" DESC, "id" DESC
        )`,
    );
    await queryRunner.query(
      `UPDATE "lesson_assignments" SET "status" = 'declined' WHERE "status" = 'expired'`,
    );
    await queryRunner.query(`ALTER TABLE "lesson_assignments" DROP COLUMN "status_reason"`);
    await queryRunner.query(`DROP TYPE "public"."lesson_assignments_status_reason_enum"`);

    await queryRunner.query(
      `DROP INDEX "public"."uq_lesson_assignments_lesson_id_confirmed_teacher"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_lesson_assignments_lesson_id_person_id_active"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" DROP CONSTRAINT "ck_lesson_assignments_confirmed_reviewed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" DROP CONSTRAINT "ck_lesson_assignments_cancellation"`,
    );
    await queryRunner.query(`ALTER TABLE "lesson_assignments" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TYPE "public"."lesson_assignments_status_enum" RENAME TO "lesson_assignments_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lesson_assignments_status_enum" AS ENUM('pending', 'confirmed', 'declined', 'cancelled')`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" ALTER COLUMN "status" TYPE "public"."lesson_assignments_status_enum" USING "status"::text::"public"."lesson_assignments_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."lesson_assignments_status_enum_old"`);
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" ALTER COLUMN "status" SET DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" ADD CONSTRAINT "ck_lesson_assignments_cancellation" CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_assignments" ADD CONSTRAINT "ck_lesson_assignments_confirmed_reviewed" CHECK ("status" <> 'confirmed' OR "reviewed_at" IS NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_lesson_assignments_lesson_id_person_id_active" ON "lesson_assignments" ("lesson_id", "person_id") WHERE "status" IN ('pending', 'confirmed') AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_lesson_assignments_lesson_id_confirmed_teacher" ON "lesson_assignments" ("lesson_id") WHERE "role" = 'teacher' AND "status" = 'confirmed' AND "deleted_at" IS NULL`,
    );
  }
}
