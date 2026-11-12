import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { DepartmentResponseDto } from "./department.response.dto";
import { PersonRefDto } from "./person-ref.response.dto";

const WITHOUT_MEMBER_PROFILE =
  "Null for a person without a member profile (e.g. the seeded admin).";

/**
 * Member record (GUS-144): the Person joined with her member profile, for coordination and for
 * the director of the same department (`members.view`). Every key is always present: what is
 * not filled in (or does not exist for this person) is `null`, never absent.
 *
 * The CPF never comes in full: only `cpfMasked` (RNF-14). The full CPF stays on the coordination
 * route (GET /member-registrations/:id). Allocations, attendance and the hours bank are not part
 * of this response.
 */
export class MemberDetailResponseDto {
  // Person

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-000000000001",
    description: "Id of the Person.",
  })
  id!: string;

  @ApiProperty({ type: String, example: "Ana Torres" })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: "a2210001" })
  ra!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "ana.torres@example.com",
    description: "Personal e-mail.",
  })
  email!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "11981813030",
    description: "Digits only.",
  })
  phone!: string | null;

  @ApiProperty({ type: String, format: "date", nullable: true, example: "1999-07-22" })
  birthDate!: string | null;

  @ApiProperty({
    enum: Role,
    enumName: "Role",
    nullable: true,
    example: Role.MEMBER,
    description:
      "Access profile. Null while the registration is pending or rejected: the role is only granted on approval.",
  })
  role!: Role | null;

  @ApiProperty({ type: Boolean, example: true })
  accessEnabled!: boolean;

  // Member profile

  @ApiProperty({
    type: String,
    nullable: true,
    example: "***.***.247-25",
    description: `CPF with only the last five digits visible; the full CPF is only on GET /member-registrations/:id (RNF-14). ${WITHOUT_MEMBER_PROFILE}`,
  })
  cpfMasked!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Rua das Acácias, 120, apto 42",
    description: WITHOUT_MEMBER_PROFILE,
  })
  address!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "São Paulo",
    description: WITHOUT_MEMBER_PROFILE,
  })
  city!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "SP",
    description: `UF. ${WITHOUT_MEMBER_PROFILE}`,
  })
  state!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "ana.torres@example.edu",
    description: WITHOUT_MEMBER_PROFILE,
  })
  institutionalEmail!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Sistemas de Informação",
    description: WITHOUT_MEMBER_PROFILE,
  })
  course!: string | null;

  @ApiProperty({ type: "integer", nullable: true, example: 7, description: WITHOUT_MEMBER_PROFILE })
  semester!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "SI-2024-N",
    description: `Class (turma) at the university. ${WITHOUT_MEMBER_PROFILE}`,
  })
  className!: string | null;

  @ApiProperty({
    type: () => DepartmentResponseDto,
    nullable: true,
    description:
      "Department of the member profile (the one suggested at sign-up while the registration is pending). Null without a member profile or without a department.",
  })
  department!: DepartmentResponseDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Monitora de informática",
    description: WITHOUT_MEMBER_PROFILE,
  })
  mainFunction!: string | null;

  @ApiProperty({
    type: String,
    format: "date",
    nullable: true,
    example: "2026-10-01",
    description: WITHOUT_MEMBER_PROFILE,
  })
  joinedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "https://drive.google.com/file/d/exemplo/view",
    description: WITHOUT_MEMBER_PROFILE,
  })
  volunteerTermUrl!: string | null;

  @ApiProperty({
    enum: MemberRegistrationStatus,
    enumName: "MemberRegistrationStatus",
    nullable: true,
    example: MemberRegistrationStatus.APPROVED,
    description: WITHOUT_MEMBER_PROFILE,
  })
  registrationStatus!: MemberRegistrationStatus | null;

  // Registration review

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: "2026-10-20T13:00:00.000Z",
    description:
      "When the registration was approved or rejected (UTC). Null while pending and for profiles approved by the backfill, before the validation existed.",
  })
  reviewedAt!: Date | null;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description:
      "Who approved or rejected the registration. Null while pending, for profiles approved by the backfill, or when that person was deleted.",
  })
  reviewedBy!: PersonRefDto | null;
}
