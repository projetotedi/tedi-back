import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { DepartmentResponseDto } from "./department.response.dto";

/**
 * Member registration in full: Person data plus MemberProfile data. Coordination only
 * (invites.manage): it carries the full CPF (RNF-14), address and phone.
 * `id` is the id of the Person (RN-09); the profile id stays internal.
 */
export class MemberRegistrationResponseDto {
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
    description: "Stored as the e-mail of the person.",
  })
  personalEmail!: string | null;

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
    type: String,
    nullable: true,
    example: "52998224725",
    description: "Digits only. Full CPF: this route is for coordination only (RNF-14).",
  })
  cpf!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "Rua das Acácias, 120, apto 42" })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "São Paulo" })
  city!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "SP" })
  state!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "ana.torres@example.edu" })
  institutionalEmail!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "Sistemas de Informação" })
  course!: string | null;

  @ApiProperty({ type: "integer", nullable: true, example: 7 })
  semester!: number | null;

  @ApiProperty({ type: String, nullable: true, example: "SI-2024-N" })
  className!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "https://drive.google.com/file/d/exemplo/view",
  })
  volunteerTermUrl!: string | null;

  @ApiProperty({
    type: () => DepartmentResponseDto,
    nullable: true,
    description: "Suggested by the person while pending; decided by coordination on approval.",
  })
  department!: DepartmentResponseDto | null;

  @ApiProperty({
    enum: Role,
    enumName: "Role",
    nullable: true,
    example: Role.MEMBER,
    description: "Role carried by the invite: a suggestion; coordination decides on approval.",
  })
  requestedRole!: Role | null;

  @ApiProperty({
    enum: Role,
    enumName: "Role",
    nullable: true,
    example: null,
    description: "Access profile. Null until the approval.",
  })
  role!: Role | null;

  @ApiProperty({ type: Boolean, example: false })
  accessEnabled!: boolean;

  @ApiProperty({
    enum: MemberRegistrationStatus,
    enumName: "MemberRegistrationStatus",
    example: MemberRegistrationStatus.PENDING,
  })
  registrationStatus!: MemberRegistrationStatus;

  @ApiProperty({ type: String, nullable: true, example: "Monitora de informática" })
  mainFunction!: string | null;

  @ApiProperty({ type: String, format: "date", nullable: true, example: "2026-10-01" })
  joinedAt!: string | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: "2026-10-01T13:00:00.000Z",
  })
  submittedAt!: Date | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description: "Null while pending. Null on an approved registration = approved before GUS-91.",
  })
  reviewedAt!: Date | null;

  @ApiProperty({ type: String, format: "uuid", nullable: true, example: null })
  reviewedById!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "Documentos conferidos." })
  reviewNote!: string | null;

  @ApiProperty({ type: String, format: "date-time", example: "2026-10-01T13:00:00.000Z" })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-10-01T13:00:00.000Z",
    description: "The most recent change between the person and the profile.",
  })
  updatedAt!: Date;
}
