import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";

/** Query of GET /member-registrations. */
export class ListMemberRegistrationsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined ? Number(value) : undefined))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined ? Number(value) : undefined))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: MemberRegistrationStatus,
    enumName: "MemberRegistrationStatus",
    default: MemberRegistrationStatus.PENDING,
    description: "Defaults to pending (the validation queue).",
  })
  @IsOptional()
  @IsEnum(MemberRegistrationStatus)
  status?: MemberRegistrationStatus;

  @ApiPropertyOptional({ example: "Ana", maxLength: 100, description: "Search by name or RA" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
