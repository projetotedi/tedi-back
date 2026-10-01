import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateStudentProfiles1790831163130 implements MigrationInterface {
  name = "CreateStudentProfiles1790831163130";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // RF-001: contact data on Person, shared by students and members.
    await queryRunner.query(`ALTER TABLE "people" ADD "birth_date" date`);
    await queryRunner.query(`ALTER TABLE "people" ADD "phone" character varying(20)`);

    await queryRunner.query(
      `CREATE TYPE "public"."student_profiles_accessibility_need_enum" AS ENUM('none', 'visual', 'hearing', 'motor', 'cognitive', 'other')`,
    );

    await queryRunner.query(`
      CREATE TABLE "student_profiles" (
        "id"                      uuid                                                NOT NULL,
        "created_at"              TIMESTAMP WITH TIME ZONE                            NOT NULL DEFAULT now(),
        "updated_at"              TIMESTAMP WITH TIME ZONE                            NOT NULL DEFAULT now(),
        "deleted_at"              TIMESTAMP WITH TIME ZONE,
        "person_id"               uuid                                                NOT NULL,
        "education"               character varying(100),
        "has_smartphone"          boolean,
        "has_computer"            boolean,
        "how_found_us"            character varying(200),
        "emergency_contact_name"  character varying(200),
        "emergency_contact_phone" character varying(20),
        "accessibility_need"      "public"."student_profiles_accessibility_need_enum" NOT NULL DEFAULT 'none',
        "support_resource"        character varying(500),
        "class_needs"             character varying(500),
        "created_by_id"           uuid                                                NOT NULL,
        "archived_at"             TIMESTAMP WITH TIME ZONE,
        "archived_by_id"          uuid,
        "archive_reason"          text,
        CONSTRAINT "PK_student_profiles" PRIMARY KEY ("id")
      )
    `);

    // 1:1 with people (RN-09): one profile per person.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_student_profiles_person_id" ON "student_profiles" ("person_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "student_profiles" ADD CONSTRAINT "fk_student_profiles_person_id" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_profiles" ADD CONSTRAINT "fk_student_profiles_created_by_id" FOREIGN KEY ("created_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_profiles" ADD CONSTRAINT "fk_student_profiles_archived_by_id" FOREIGN KEY ("archived_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    await queryRunner.query(
      `ALTER TABLE "student_profiles" DROP CONSTRAINT "fk_student_profiles_archived_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_profiles" DROP CONSTRAINT "fk_student_profiles_created_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_profiles" DROP CONSTRAINT "fk_student_profiles_person_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_student_profiles_person_id"`);
    await queryRunner.query(`DROP TABLE "student_profiles"`);
    await queryRunner.query(`DROP TYPE "public"."student_profiles_accessibility_need_enum"`);
    await queryRunner.query(`ALTER TABLE "people" DROP COLUMN "phone"`);
    await queryRunner.query(`ALTER TABLE "people" DROP COLUMN "birth_date"`);
  }
}
