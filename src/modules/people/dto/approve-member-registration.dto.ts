import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { trim, trimToNull } from "@shared/dto/transforms";
import { Role } from "@shared/enums/role.enum";
import { IsJoinedAt } from "../validators/is-joined-at.validator";

/**
 * Body of PATCH /member-registrations/:id/approve (RN-08). Coordination defines the access
 * profile, department, main function and join date. SUPERADMIN is rejected by the service
 * with 400 INVALID_ROLE, as in the invites and in /access.
 */
export class ApproveMemberRegistrationDto {
  @ApiProperty({
    enum: Role,
    enumName: "Role",
    example: Role.MEMBER,
    description: "Access profile granted by the approval. `superadmin` answers 400 INVALID_ROLE.",
  })
  @IsEnum(Role)
  role!: Role;

  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    nullable: true,
    example: "01999a3e-1111-7000-8000-000000000001",
    description: "Required for member and director; optional for coordinator.",
  })
  @ValidateIf(
    (dto: ApproveMemberRegistrationDto, value: unknown) =>
      dto.role !== Role.COORDINATOR || value != null,
  )
  @IsUUID("all")
  departmentId?: string | null;

  @ApiProperty({ type: String, maxLength: 100, example: "Monitora de informática" })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  mainFunction!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-10-01",
    description: "YYYY-MM-DD, between 2000-01-01 and today (America/Sao_Paulo).",
  })
  @IsJoinedAt()
  joinedAt!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    example: "Documentos conferidos.",
    description:
      "Note of the validation, kept in the audit event. Do not record sensitive data in it.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
