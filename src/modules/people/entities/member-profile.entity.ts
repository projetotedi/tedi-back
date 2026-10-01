import { Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { Role } from "@shared/enums/role.enum";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";

/**
 * Member data of a Person (RF-004, RF-011) and the registration validation (RN-08).
 * 1:1 with people through the unique person_id (RN-09). Owner of the member fields: there is
 * no E1.b card, later member cards (inactivation, edit) extend this table.
 *
 * name, ra, e-mail (personal), birthDate and phone live on Person. cpf, address and phone are
 * personal data (RNF-13/14): never logged, never in events, cpf only in the coordination detail.
 * A person without a member profile (seed superadmin, coordinators, accounts created before
 * GUS-91 that the backfill did not cover) is not subject to validation.
 *
 * Foreign keys are declared on the class, by table name, and without relations: this keeps
 * every constraint name under our control (the SQL of the migration is written by hand),
 * the same pattern as StudentProfile.
 */
@Entity({ name: "member_profiles" })
@Index("uq_member_profiles_person_id", ["personId"], { unique: true })
@ForeignKey("people", ["person_id"], ["id"], { name: "fk_member_profiles_person_id" })
@ForeignKey("departments", ["department_id"], ["id"], { name: "fk_member_profiles_department_id" })
@ForeignKey("people", ["reviewed_by_id"], ["id"], { name: "fk_member_profiles_reviewed_by_id" })
export class MemberProfile extends BaseEntity {
  @Column({ name: "person_id", type: "uuid" })
  personId: string;

  @Column({
    name: "registration_status",
    type: "enum",
    enum: MemberRegistrationStatus,
    enumName: "member_profiles_registration_status_enum",
    default: MemberRegistrationStatus.PENDING,
  })
  registrationStatus: MemberRegistrationStatus;

  /** Role carried by the invite: a suggestion; coordination sets Person.role on approval. */
  @Column({
    name: "requested_role",
    type: "enum",
    enum: Role,
    enumName: "people_role_enum",
    nullable: true,
    default: null,
  })
  requestedRole: Role | null;

  /** Digits only. Personal data (RNF-14): only the coordination detail returns it. */
  @Column({ name: "cpf", type: "varchar", length: 11, nullable: true, default: null })
  cpf: string | null;

  @Column({ name: "address", type: "varchar", length: 200, nullable: true, default: null })
  address: string | null;

  @Column({ name: "city", type: "varchar", length: 100, nullable: true, default: null })
  city: string | null;

  /** UF, two upper-case letters. */
  @Column({ name: "state", type: "varchar", length: 2, nullable: true, default: null })
  state: string | null;

  @Column({
    name: "institutional_email",
    type: "varchar",
    length: 200,
    nullable: true,
    default: null,
  })
  institutionalEmail: string | null;

  @Column({ name: "course", type: "varchar", length: 100, nullable: true, default: null })
  course: string | null;

  @Column({ name: "semester", type: "smallint", nullable: true, default: null })
  semester: number | null;

  /** Class (turma) at the university. */
  @Column({ name: "class_name", type: "varchar", length: 50, nullable: true, default: null })
  className: string | null;

  /**
   * Suggested by the person at sign-up, decided by coordination on approval.
   * Only an approved profile gives department scope (AuthUser.departmentIds).
   */
  @Column({ name: "department_id", type: "uuid", nullable: true, default: null })
  departmentId: string | null;

  @Column({
    name: "volunteer_term_url",
    type: "varchar",
    length: 500,
    nullable: true,
    default: null,
  })
  volunteerTermUrl: string | null;

  @Column({ name: "main_function", type: "varchar", length: 100, nullable: true, default: null })
  mainFunction: string | null;

  /** Calendar date "YYYY-MM-DD" (TypeORM hydrates `date` as string). */
  @Column({ name: "joined_at", type: "date", nullable: true, default: null })
  joinedAt: string | null;

  @Column({ name: "submitted_at", type: "timestamptz", nullable: true, default: null })
  submittedAt: Date | null;

  /** Null on an approved profile = approved by the backfill, before the validation existed. */
  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true, default: null })
  reviewedAt: Date | null;

  @Column({ name: "reviewed_by_id", type: "uuid", nullable: true, default: null })
  reviewedById: string | null;

  /** Note of the validation. The DTO warns not to register sensitive data in it. */
  @Column({ name: "review_note", type: "varchar", length: 500, nullable: true, default: null })
  reviewNote: string | null;
}
