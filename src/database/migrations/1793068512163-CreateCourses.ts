import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCourses1793068512163 implements MigrationInterface {
  name = "CreateCourses1793068512163";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Level of the content (RF-013). A new category needs ALTER TYPE ... ADD VALUE.
    await queryRunner.query(
      `CREATE TYPE "public"."courses_category_enum" AS ENUM('basic', 'intermediate', 'advanced')`,
    );

    await queryRunner.query(`
      CREATE TABLE "courses" (
        "id"             uuid                             NOT NULL,
        "created_at"     TIMESTAMP WITH TIME ZONE         NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP WITH TIME ZONE         NOT NULL DEFAULT now(),
        "deleted_at"     TIMESTAMP WITH TIME ZONE,
        "name"           character varying(200)           NOT NULL,
        "description"    text                             NOT NULL,
        "objective"      text,
        "category"       "public"."courses_category_enum" NOT NULL,
        "created_by_id"  uuid                             NOT NULL,
        "archived_at"    TIMESTAMP WITH TIME ZONE,
        "archived_by_id" uuid,
        "archive_reason" text,
        CONSTRAINT "PK_courses" PRIMARY KEY ("id")
      )
    `);
    // Unique ignoring case, archived courses included: the name is promised as unique that way
    // (DTO and Swagger) and the pre-check of CoursesService is not enough against two concurrent
    // requests. An expression index cannot be declared in the TypeORM entity (see Course); the
    // schema e2e checks it.
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_courses_name" ON "courses" (LOWER("name"))`);

    // RF-021: "course_id requires prerequisite_id". A course never requires itself; a longer
    // cycle is refused by CoursesService (400 PREREQUISITE_CYCLE), it cannot be a constraint.
    await queryRunner.query(`
      CREATE TABLE "course_prerequisites" (
        "id"              uuid                     NOT NULL,
        "created_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at"      TIMESTAMP WITH TIME ZONE,
        "course_id"       uuid                     NOT NULL,
        "prerequisite_id" uuid                     NOT NULL,
        CONSTRAINT "PK_course_prerequisites" PRIMARY KEY ("id"),
        CONSTRAINT "ck_course_prerequisites_not_self" CHECK ("course_id" <> "prerequisite_id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_course_prerequisites_course_id_prerequisite_id" ON "course_prerequisites" ("course_id", "prerequisite_id")`,
    );
    // "Which courses require this one" (GUS-100).
    await queryRunner.query(
      `CREATE INDEX "idx_course_prerequisites_prerequisite_id" ON "course_prerequisites" ("prerequisite_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "courses" ADD CONSTRAINT "fk_courses_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "courses" ADD CONSTRAINT "fk_courses_archived_by_id" FOREIGN KEY ("archived_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_prerequisites" ADD CONSTRAINT "fk_course_prerequisites_course_id" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_prerequisites" ADD CONSTRAINT "fk_course_prerequisites_prerequisite_id" FOREIGN KEY ("prerequisite_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(
      `ALTER TABLE "course_prerequisites" DROP CONSTRAINT "fk_course_prerequisites_prerequisite_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_prerequisites" DROP CONSTRAINT "fk_course_prerequisites_course_id"`,
    );
    await queryRunner.query(`ALTER TABLE "courses" DROP CONSTRAINT "fk_courses_archived_by_id"`);
    await queryRunner.query(`ALTER TABLE "courses" DROP CONSTRAINT "fk_courses_created_by_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_course_prerequisites_prerequisite_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_course_prerequisites_course_id_prerequisite_id"`,
    );
    await queryRunner.query(`DROP TABLE "course_prerequisites"`);
    await queryRunner.query(`DROP INDEX "public"."uq_courses_name"`);
    await queryRunner.query(`DROP TABLE "courses"`);
    await queryRunner.query(`DROP TYPE "public"."courses_category_enum"`);
  }
}
