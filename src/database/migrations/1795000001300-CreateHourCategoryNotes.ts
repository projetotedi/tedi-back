import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The observation of coordination on the hours of a member in one category (GUS-173).
 *
 * - One row per person and category: the unique index is partial (`deleted_at IS NULL`) by the
 *   convention of the repository, though no row is ever soft-deleted. It is also the arbiter of the
 *   upsert (`ON CONFLICT ... WHERE deleted_at IS NULL`) that writes the observation.
 * - `category` reuses `hour_entries_category_enum`, created by CreateHourEntries1795000000000.
 * - `note` is null once cleared, and never blank (the CHECK).
 * - `down()` drops everything in the reverse order, with no IF EXISTS: a broken revert must fail
 *   loudly in CI.
 */
export class CreateHourCategoryNotes1795000001300 implements MigrationInterface {
  name = "CreateHourCategoryNotes1795000001300";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "hour_category_notes" (
        "id"            uuid                                  NOT NULL,
        "created_at"    TIMESTAMP WITH TIME ZONE              NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP WITH TIME ZONE              NOT NULL DEFAULT now(),
        "deleted_at"    TIMESTAMP WITH TIME ZONE,
        "person_id"     uuid                                  NOT NULL,
        "category"      "public"."hour_entries_category_enum" NOT NULL,
        "note"          character varying(500),
        "updated_by_id" uuid                                  NOT NULL,
        CONSTRAINT "PK_hour_category_notes" PRIMARY KEY ("id"),
        CONSTRAINT "ck_hour_category_notes_note" CHECK ("note" IS NULL OR length(btrim("note")) > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_hour_category_notes_person_id_category" ON "hour_category_notes" ("person_id", "category") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_category_notes" ADD CONSTRAINT "fk_hour_category_notes_person_id" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_category_notes" ADD CONSTRAINT "fk_hour_category_notes_updated_by_id" FOREIGN KEY ("updated_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hour_category_notes" DROP CONSTRAINT "fk_hour_category_notes_updated_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "hour_category_notes" DROP CONSTRAINT "fk_hour_category_notes_person_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_hour_category_notes_person_id_category"`);
    await queryRunner.query(`DROP TABLE "hour_category_notes"`);
  }
}
