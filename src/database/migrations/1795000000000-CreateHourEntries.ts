import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The hour entries and their history (GUS-162).
 *
 * - `idx_hour_entries_person_id_date` serves the statement and the summary of a person;
 *   `idx_hour_entry_events_hour_entry_id` serves the history of one entry (GUS-164).
 * - The history is append-only: a row trigger answers 23001 (restrict_violation) to any UPDATE or
 *   DELETE on `hour_entry_events`. A row trigger does not fire on TRUNCATE, so the cleanup of the
 *   e2e keeps working.
 * - `down()` has no IF EXISTS on purpose: a broken revert must fail loudly in CI.
 */
export class CreateHourEntries1795000000000 implements MigrationInterface {
  name = "CreateHourEntries1795000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."hour_entries_category_enum" AS ENUM('lesson', 'planning', 'event', 'management', 'meeting', 'support', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."hour_entries_status_enum" AS ENUM('pending', 'approved', 'adjusted', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."hour_entries_origin_enum" AS ENUM('manual', 'on_behalf', 'attendance')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."hour_entry_events_type_enum" AS ENUM('created', 'approved', 'adjusted', 'rejected', 'removed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "hour_entries" (
        "id"                uuid                                  NOT NULL,
        "created_at"        TIMESTAMP WITH TIME ZONE              NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP WITH TIME ZONE              NOT NULL DEFAULT now(),
        "deleted_at"        TIMESTAMP WITH TIME ZONE,
        "person_id"         uuid                                  NOT NULL,
        "activity"          character varying(200)                NOT NULL,
        "category"          "public"."hour_entries_category_enum" NOT NULL,
        "date"              date                                  NOT NULL,
        "declared_minutes"  integer                               NOT NULL,
        "validated_minutes" integer,
        "notes"             text,
        "status"            "public"."hour_entries_status_enum"   NOT NULL DEFAULT 'pending',
        "origin"            "public"."hour_entries_origin_enum"   NOT NULL,
        "created_by_id"     uuid                                  NOT NULL,
        "class_id"          uuid,
        "lesson_id"         uuid,
        "review_note"       text,
        "reviewed_by_id"    uuid,
        "reviewed_at"       TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_hour_entries" PRIMARY KEY ("id"),
        CONSTRAINT "ck_hour_entries_declared_minutes" CHECK ("declared_minutes" > 0 AND "declared_minutes" <= 1440),
        CONSTRAINT "ck_hour_entries_validated_minutes" CHECK ("validated_minutes" IS NULL OR ("validated_minutes" >= 0 AND "validated_minutes" <= 1440)),
        CONSTRAINT "ck_hour_entries_pending_not_validated" CHECK ("status" <> 'pending' OR "validated_minutes" IS NULL),
        CONSTRAINT "ck_hour_entries_origin_author" CHECK ("origin" = 'attendance' OR (("origin" = 'manual') = ("created_by_id" = "person_id")))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_hour_entries_person_id_date" ON "hour_entries" ("person_id", "date")`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" ADD CONSTRAINT "fk_hour_entries_person_id" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" ADD CONSTRAINT "fk_hour_entries_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" ADD CONSTRAINT "fk_hour_entries_reviewed_by_id" FOREIGN KEY ("reviewed_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" ADD CONSTRAINT "fk_hour_entries_class_id" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" ADD CONSTRAINT "fk_hour_entries_lesson_id" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "hour_entry_events" (
        "id"            uuid                                   NOT NULL,
        "created_at"    TIMESTAMP WITH TIME ZONE               NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP WITH TIME ZONE               NOT NULL DEFAULT now(),
        "deleted_at"    TIMESTAMP WITH TIME ZONE,
        "hour_entry_id" uuid                                   NOT NULL,
        "type"          "public"."hour_entry_events_type_enum" NOT NULL,
        "actor_id"      uuid                                   NOT NULL,
        "from_status"   "public"."hour_entries_status_enum",
        "to_status"     "public"."hour_entries_status_enum",
        "from_minutes"  integer,
        "to_minutes"    integer,
        "note"          text,
        CONSTRAINT "PK_hour_entry_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_hour_entry_events_hour_entry_id" ON "hour_entry_events" ("hour_entry_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entry_events" ADD CONSTRAINT "fk_hour_entry_events_hour_entry_id" FOREIGN KEY ("hour_entry_id") REFERENCES "hour_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entry_events" ADD CONSTRAINT "fk_hour_entry_events_actor_id" FOREIGN KEY ("actor_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE FUNCTION "public"."hour_entry_events_append_only"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'hour_entry_events is append-only: % is not allowed', TG_OP
          USING ERRCODE = 'restrict_violation';
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_hour_entry_events_append_only"
      BEFORE UPDATE OR DELETE ON "hour_entry_events"
      FOR EACH ROW EXECUTE FUNCTION "public"."hour_entry_events_append_only"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "trg_hour_entry_events_append_only" ON "hour_entry_events"`,
    );
    await queryRunner.query(`DROP FUNCTION "public"."hour_entry_events_append_only"()`);
    await queryRunner.query(
      `ALTER TABLE "hour_entry_events" DROP CONSTRAINT "fk_hour_entry_events_actor_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entry_events" DROP CONSTRAINT "fk_hour_entry_events_hour_entry_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_hour_entry_events_hour_entry_id"`);
    await queryRunner.query(`DROP TABLE "hour_entry_events"`);
    await queryRunner.query(
      `ALTER TABLE "hour_entries" DROP CONSTRAINT "fk_hour_entries_lesson_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" DROP CONSTRAINT "fk_hour_entries_class_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" DROP CONSTRAINT "fk_hour_entries_reviewed_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" DROP CONSTRAINT "fk_hour_entries_created_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_entries" DROP CONSTRAINT "fk_hour_entries_person_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_hour_entries_person_id_date"`);
    await queryRunner.query(`DROP TABLE "hour_entries"`);
    await queryRunner.query(`DROP TYPE "public"."hour_entry_events_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."hour_entries_origin_enum"`);
    await queryRunner.query(`DROP TYPE "public"."hour_entries_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."hour_entries_category_enum"`);
  }
}
