import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { DepartmentResponseDto } from "./department.response.dto";

/** Safe projection for a row in GET /members. */
export class MemberListItemResponseDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String, example: "Ana Torres" })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: "a2210001" })
  ra!: string | null;

  @ApiProperty({ enum: Role, enumName: "Role", nullable: true })
  role!: Role | null;

  @ApiProperty({ type: Boolean })
  accessEnabled!: boolean;

  @ApiProperty({ type: () => DepartmentResponseDto, nullable: true })
  department!: DepartmentResponseDto | null;

  @ApiProperty({ type: String, nullable: true, example: "Monitor" })
  mainFunction!: string | null;

  @ApiProperty({ type: String, format: "date", nullable: true, example: "2025-03-01" })
  joinedAt!: string | null;

  @ApiProperty({
    enum: MemberRegistrationStatus,
    enumName: "MemberRegistrationStatus",
    nullable: true,
  })
  registrationStatus!: MemberRegistrationStatus | null;
}
