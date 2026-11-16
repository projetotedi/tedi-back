import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The attendance of the members of a lesson (GUS-168) and what the hours need for it.
 *
 * - `hour_entry_events_type_enum` gains 'reversed', LAST (the e2e of the hours compares the order
 *   with the TS enum). Nothing in this migration uses the new label: the migrations run in one
 *   transaction, and a label added in a transaction cannot be used before its commit.
 * - `hour_entries`: an attendance entry is lesson hours of a lesson (ck_hour_entries_attendance_lesson),
 *   and one person has at most one ACTIVE attendance entry per lesson
 *   (uq_hour_entries_lesson_id_person_id_attendance). No attendance row exists before this card.
 * - `member_attendance`: one presence per person per lesson; a present row always points to the
 *   hour entry it generated.
 * - `down()` cannot drop an enum label: it recreates the type without 'reversed', which FAILS on
 *   purpose when a reversed row exists (the history is append-only). No IF EXISTS: a broken revert
 *   must fail loudly in CI.
 */
export class CreateMemberAttendance1795000000500 implements MigrationInterface {
  name = "CreateMemberAttendance1795000000500";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."hour_entry_events_type_enum" ADD VALUE 'reversed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" ADD CONSTRAINT "ck_hour_entries_attendance_lesson" CHECK ("origin" <> 'attendance' OR ("category" = 'lesson' AND "lesson_id" IS NOT NULL AND "class_id" IS NOT NULL))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_hour_entries_lesson_id_person_id_attendance" ON "hour_entries" ("lesson_id", "person_id") WHERE "origin" = 'attendance' AND "deleted_at" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."member_attendance_status_enum" AS ENUM('present', 'absent')`,
    );
    await queryRunner.query(`
      CREATE TABLE "member_attendance" (
        "id"              uuid                                     NOT NULL,
        "created_at"      TIMESTAMP WITH TIME ZONE                 NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMP WITH TIME ZONE                 NOT NULL DEFAULT now(),
        "deleted_at"      TIMESTAMP WITH TIME ZONE,
        "assignment_id"   uuid                                     NOT NULL,
        "lesson_id"       uuid                                     NOT NULL,
        "person_id"       uuid                                     NOT NULL,
        "status"          "public"."member_attendance_status_enum" NOT NULL,
        "confirmed_by_id" uuid                                     NOT NULL,
        "confirmed_at"    TIMESTAMP WITH TIME ZONE                 NOT NULL,
        "hour_entry_id"   uuid,
        CONSTRAINT "PK_member_attendance" PRIMARY KEY ("id"),
        CONSTRAINT "ck_member_attendance_hour_entry" CHECK (("status" = 'present') = ("hour_entry_id" IS NOT NULL))
      )
    `);
    // One presence per person per lesson, whatever assignment signed it: a member cancelled and
    // assigned again finds the presence she had.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_member_attendance_lesson_id_person_id" ON "member_attendance" ("lesson_id", "person_id") WHERE "deleted_at" IS NULL`,
    );
    // "The attendance of this member" (F6.4).
    await queryRunner.query(
      `CREATE INDEX "idx_member_attendance_person_id" ON "member_attendance" ("person_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "member_attendance" ADD CONSTRAINT "fk_member_attendance_assignment_id" FOREIGN KEY ("assignment_id") REFERENCES "lesson_assignments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_attendance" ADD CONSTRAINT "fk_member_attendance_lesson_id" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_attendance" ADD CONSTRAINT "fk_member_attendance_person_id" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_attendance" ADD CONSTRAINT "fk_member_attendance_confirmed_by_id" FOREIGN KEY ("confirmed_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_attendance" ADD CONSTRAINT "fk_member_attendance_hour_entry_id" FOREIGN KEY ("hour_entry_id") REFERENCES "hour_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "member_attendance" DROP CONSTRAINT "fk_member_attendance_hour_entry_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_attendance" DROP CONSTRAINT "fk_member_attendance_confirmed_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_attendance" DROP CONSTRAINT "fk_member_attendance_person_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_attendance" DROP CONSTRAINT "fk_member_attendance_lesson_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_attendance" DROP CONSTRAINT "fk_member_attendance_assignment_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_member_attendance_person_id"`);
    await queryRunner.query(`DROP INDEX "public"."uq_member_attendance_lesson_id_person_id"`);
    await queryRunner.query(`DROP TABLE "member_attendance"`);
    await queryRunner.query(`DROP TYPE "public"."member_attendance_status_enum"`);

    await queryRunner.query(`DROP INDEX "public"."uq_hour_entries_lesson_id_person_id_attendance"`);
    await queryRunner.query(
      `ALTER TABLE "hour_entries" DROP CONSTRAINT "ck_hour_entries_attendance_lesson"`,
    );
    // An enum label cannot be dropped: the type is recreated without 'reversed' and the column is
    // moved to it. The cast fails, on purpose, when a reversed row exists.
    await queryRunner.query(
      `ALTER TYPE "public"."hour_entry_events_type_enum" RENAME TO "hour_entry_events_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."hour_entry_events_type_enum" AS ENUM('created', 'approved', 'adjusted', 'rejected', 'removed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entry_events" ALTER COLUMN "type" TYPE "public"."hour_entry_events_type_enum" USING "type"::text::"public"."hour_entry_events_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."hour_entry_events_type_enum_old"`);
  }
}
