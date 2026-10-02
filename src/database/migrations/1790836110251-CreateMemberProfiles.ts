import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Backfill (GUS-91): members and directors who got access before the registration validation
 * existed become approved. Coordinators and the superadmin are not project members (decisions 1
 * and 3 of E9.a) and keep no member profile: a person without a profile is not subject to
 * validation. The seed runs after the migrations (start:prod), so the seeded superadmin is never
 * here. Re-runnable (NOT EXISTS): the schema e2e runs it against its own fixtures.
 * Exported as a string: TypeORM only loads exported classes from migration files.
 */
export const BACKFILL_APPROVED_MEMBERS_SQL = `
  INSERT INTO "member_profiles" ("id", "person_id", "registration_status", "requested_role")
  SELECT gen_random_uuid(), p."id", 'approved', p."role"
    FROM "people" p
   WHERE p."role" IN ('member', 'director')
     AND p."deleted_at" IS NULL
     AND NOT EXISTS (SELECT 1 FROM "member_profiles" m WHERE m."person_id" = p."id")
`;

export class CreateMemberProfiles1790836110251 implements MigrationInterface {
  name = "CreateMemberProfiles1790836110251";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Project areas, managed by coordination (/departments). Drive the "department" scope.
    await queryRunner.query(`
      CREATE TABLE "departments" (
        "id"         uuid                     NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "name"       character varying(100)   NOT NULL,
        CONSTRAINT "PK_departments" PRIMARY KEY ("id")
      )
    `);
    // Unique ignoring case: the name is promised as unique that way (DTO and Swagger) and the
    // pre-check of DepartmentsService is not enough against two concurrent requests. An expression
    // index cannot be declared in the TypeORM entity (see Department); the schema e2e checks it.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_departments_name" ON "departments" (LOWER("name"))`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."member_profiles_registration_status_enum" AS ENUM('pending', 'approved', 'rejected')`,
    );

    // RF-004/RF-011 + RN-08. requested_role reuses people_role_enum (created by CreatePeople).
    await queryRunner.query(`
      CREATE TABLE "member_profiles" (
        "id"                  uuid                                                NOT NULL,
        "created_at"          TIMESTAMP WITH TIME ZONE                            NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP WITH TIME ZONE                            NOT NULL DEFAULT now(),
        "deleted_at"          TIMESTAMP WITH TIME ZONE,
        "person_id"           uuid                                                NOT NULL,
        "registration_status" "public"."member_profiles_registration_status_enum" NOT NULL DEFAULT 'pending',
        "requested_role"      "public"."people_role_enum",
        "cpf"                 character varying(11),
        "address"             character varying(200),
        "city"                character varying(100),
        "state"               character varying(2),
        "institutional_email" character varying(200),
        "course"              character varying(100),
        "semester"            smallint,
        "class_name"          character varying(50),
        "department_id"       uuid,
        "volunteer_term_url"  character varying(500),
        "main_function"       character varying(100),
        "joined_at"           date,
        "submitted_at"        TIMESTAMP WITH TIME ZONE,
        "reviewed_at"         TIMESTAMP WITH TIME ZONE,
        "reviewed_by_id"      uuid,
        "review_note"         character varying(500),
        CONSTRAINT "PK_member_profiles" PRIMARY KEY ("id")
      )
    `);

    // 1:1 with people (RN-09): one member profile per person.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_member_profiles_person_id" ON "member_profiles" ("person_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "member_profiles" ADD CONSTRAINT "fk_member_profiles_person_id" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_profiles" ADD CONSTRAINT "fk_member_profiles_department_id" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_profiles" ADD CONSTRAINT "fk_member_profiles_reviewed_by_id" FOREIGN KEY ("reviewed_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // Compatibility: who already had access as member or director stays able to sign in.
    await queryRunner.query(BACKFILL_APPROVED_MEMBERS_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No IF EXISTS on purpose: a broken down() must fail loudly in CI.
    // The backfilled rows go away with the table; people is untouched by this migration.
    await queryRunner.query(
      `ALTER TABLE "member_profiles" DROP CONSTRAINT "fk_member_profiles_reviewed_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_profiles" DROP CONSTRAINT "fk_member_profiles_department_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "member_profiles" DROP CONSTRAINT "fk_member_profiles_person_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_member_profiles_person_id"`);
    await queryRunner.query(`DROP TABLE "member_profiles"`);
    await queryRunner.query(`DROP TYPE "public"."member_profiles_registration_status_enum"`);
    // people_role_enum is NOT dropped: it belongs to CreatePeople.
    await queryRunner.query(`DROP INDEX "public"."uq_departments_name"`);
    await queryRunner.query(`DROP TABLE "departments"`);
  }
}
