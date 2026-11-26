import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { DepartmentResponseDto } from "./department.response.dto";

/**
 * Row of the validation queue (GET /member-registrations).
 * Explicit projection: no CPF, address, phone nor e-mails (RNF-13/14).
 */
export class MemberRegistrationListItemDto {
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
    enum: Role,
    enumName: "Role",
    nullable: true,
    example: Role.MEMBER,
    description: "Role carried by the invite: a suggestion; coordination decides on approval.",
  })
  requestedRole!: Role | null;

  @ApiProperty({
    type: () => DepartmentResponseDto,
    nullable: true,
    description: "Department suggested by the person; confirmed on approval.",
  })
  department!: DepartmentResponseDto | null;

  @ApiProperty({ type: String, nullable: true, example: "Sistemas de Informação" })
  course!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "SI-2024-N" })
  className!: string | null;

  @ApiProperty({ type: "integer", nullable: true, example: 7 })
  semester!: number | null;

  @ApiProperty({
    enum: MemberRegistrationStatus,
    enumName: "MemberRegistrationStatus",
    example: MemberRegistrationStatus.PENDING,
  })
  registrationStatus!: MemberRegistrationStatus;

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
    description: "Null while pending.",
  })
  reviewedAt!: Date | null;
}
