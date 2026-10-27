import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateClasses1793106231241 implements MigrationInterface {
  name = "CreateClasses1793106231241";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Status of a class (RF-034). A new status needs ALTER TYPE ... ADD VALUE.
    await queryRunner.query(
      `CREATE TYPE "public"."classes_status_enum" AS ENUM('planned', 'in_progress', 'completed', 'cancelled')`,
    );

    await queryRunner.query(`
      CREATE TABLE "editions" (
        "id"         uuid                     NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "name"       character varying(20)    NOT NULL,
        CONSTRAINT "PK_editions" PRIMARY KEY ("id")
      )
    `);
    // Target of the INSERT ... ON CONFLICT ("name") DO NOTHING of the find-or-create of an edition
    // (EditionsService): two requests that create the same new edition at once share one row.
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_editions_name" ON "editions" ("name")`);

    await queryRunner.query(`
      CREATE TABLE "classes" (
        "id"             uuid                           NOT NULL,
        "created_at"     TIMESTAMP WITH TIME ZONE       NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP WITH TIME ZONE       NOT NULL DEFAULT now(),
        "deleted_at"     TIMESTAMP WITH TIME ZONE,
        "code"           character varying(30)          NOT NULL,
        "name"           character varying(200),
        "course_id"      uuid                           NOT NULL,
        "edition_id"     uuid                           NOT NULL,
        "start_date"     date                           NOT NULL,
        "end_date"       date                           NOT NULL,
        "location"       character varying(200),
        "capacity"       integer                        NOT NULL,
        "status"         "public"."classes_status_enum" NOT NULL DEFAULT 'planned',
        "created_by_id"  uuid                           NOT NULL,
        "archived_at"    TIMESTAMP WITH TIME ZONE,
        "archived_by_id" uuid,
        "archive_reason" text,
        CONSTRAINT "PK_classes" PRIMARY KEY ("id"),
        CONSTRAINT "ck_classes_capacity_positive" CHECK ("capacity" > 0),
        CONSTRAINT "ck_classes_period" CHECK ("end_date" >= "start_date")
      )
    `);
    // The code is unique inside its edition, ignoring case, archived classes included: it is
    // promised that way (DTO and Swagger) and the pre-check of ClassesService is not enough against
    // two concurrent requests. Archived classes stay in the index so that unarchiving never meets a
    // clash. An expression index cannot be declared in the TypeORM entity (see SchoolClass); the
    // schema e2e checks it.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_classes_edition_id_code" ON "classes" ("edition_id", LOWER("code"))`,
    );
    // "The classes of this course" (GUS-102, GUS-103).
    await queryRunner.query(`CREATE INDEX "idx_classes_course_id" ON "classes" ("course_id")`);

    await queryRunner.query(
      `ALTER TABLE "classes" ADD CONSTRAINT "fk_classes_course_id" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "classes" ADD CONSTRAINT "fk_classes_edition_id" FOREIGN KEY ("edition_id") REFERENCES "editions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "classes" ADD CONSTRAINT "fk_classes_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "classes" ADD CONSTRAINT "fk_classes_archived_by_id" FOREIGN KEY ("archived_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(`ALTER TABLE "classes" DROP CONSTRAINT "fk_classes_archived_by_id"`);
    await queryRunner.query(`ALTER TABLE "classes" DROP CONSTRAINT "fk_classes_created_by_id"`);
    await queryRunner.query(`ALTER TABLE "classes" DROP CONSTRAINT "fk_classes_edition_id"`);
    await queryRunner.query(`ALTER TABLE "classes" DROP CONSTRAINT "fk_classes_course_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_classes_course_id"`);
    await queryRunner.query(`DROP INDEX "public"."uq_classes_edition_id_code"`);
    await queryRunner.query(`DROP TABLE "classes"`);
    await queryRunner.query(`DROP INDEX "public"."uq_editions_name"`);
    await queryRunner.query(`DROP TABLE "editions"`);
    await queryRunner.query(`DROP TYPE "public"."classes_status_enum"`);
  }
}
