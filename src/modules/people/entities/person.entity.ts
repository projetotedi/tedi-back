import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { Role } from "@shared/enums/role.enum";

@Entity({ name: "people" })
@Index("uq_people_email", ["email"], { unique: true, where: '"email" IS NOT NULL' })
@Index("uq_people_ra", ["ra"], { unique: true, where: '"ra" IS NOT NULL' })
export class Person extends BaseEntity {
  @Column({ name: "name", type: "varchar", length: 200 })
  name: string;

  @Column({ name: "email", type: "varchar", length: 200, nullable: true, default: null })
  email: string | null;

  @Column({ name: "ra", type: "varchar", length: 20, nullable: true, default: null })
  ra: string | null;

  @Column({
    name: "password_hash",
    type: "varchar",
    length: 255,
    nullable: true,
    default: null,
  })
  passwordHash: string | null;

  @Column({
    name: "role",
    type: "enum",
    enum: Role,
    enumName: "people_role_enum",
    nullable: true,
    default: null,
  })
  role: Role | null;

  @Column({ name: "access_enabled", type: "boolean", default: true })
  accessEnabled: boolean;

  /**
   * GUS-93. True while the account still holds a password someone else knows (the one the seed
   * takes from ADMIN_PASSWORD). The guard blocks the session until the person replaces it.
   */
  @Column({ name: "must_change_password", type: "boolean", default: false })
  mustChangePassword: boolean;

  /**
   * RF-001. Calendar date "YYYY-MM-DD" (TypeORM hydrates `date` as string, never a Date).
   * Required for students; members get it in GUS-91, so existing people have none.
   */
  @Column({ name: "birth_date", type: "date", nullable: true, default: null })
  birthDate: string | null;

  /** RF-001. Digits only (10 to 13). Personal data: never logged. */
  @Column({ name: "phone", type: "varchar", length: 20, nullable: true, default: null })
  phone: string | null;

  /**
   * GUS-106. The digits of `phone`, computed by Postgres (STORED generated column): the search by
   * phone (`digitsSearchCondition`, idx_people_phone_digits_search) finds a phone even if it was
   * stored with a mask. Never written by the app: insert and update leave it out.
   */
  @Column({
    name: "phone_digits",
    type: "varchar",
    length: 20,
    nullable: true,
    generatedType: "STORED",
    asExpression: `regexp_replace("phone", '[^0-9]', '', 'g')`,
    insert: false,
    update: false,
  })
  phoneDigits: string | null;

  /**
   * GUS-122. Instant of the most recent successful login; null until the first one.
   * Written only by PeopleService.recordLogin (raw UPDATE, so updated_at does not move): it is
   * not a change to the person's data. The "last access" shown to the person is
   * previousLoginAt, not this one.
   */
  @Column({ name: "last_login_at", type: "timestamptz", nullable: true, default: null })
  lastLoginAt: Date | null;

  /**
   * GUS-122. The login that came right before lastLoginAt; null until the second login.
   * recordLogin moves lastLoginAt into it, so GET /members/me can show the access before the
   * current session. The "last access" is the last LOGIN, not the last activity: the MVP has no
   * inactivity tracking (RNF-23 is relaxed, decision 20).
   */
  @Column({ name: "previous_login_at", type: "timestamptz", nullable: true, default: null })
  previousLoginAt: Date | null;
}
