import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { trim, trimToNull } from "@shared/dto/transforms";
import { IsExitDate } from "../validators/is-exit-date.validator";
import { MEMBER_EXIT_NOTE_MAX_LENGTH, MEMBER_EXIT_REASON_MAX_LENGTH } from "./member-exit-limits";

/** Body of PATCH /members/:id/deactivate (RF-011). Exit date and reason are required. */
export class DeactivateMemberDto {
  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-06-30",
    description:
      "YYYY-MM-DD, between 2000-01-01 and today (America/Sao_Paulo), and not before the join date of the member (400 EXIT_DATE_BEFORE_JOINED_AT).",
  })
  @IsExitDate()
  exitDate!: string;

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: MEMBER_EXIT_REASON_MAX_LENGTH,
    example: "Formou-se.",
    description:
      "Why the member left. Required, and not blank. Shown in GET /members and kept in the audit event: do not record health information or diagnosis (RNF-13).",
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MEMBER_EXIT_REASON_MAX_LENGTH)
  reason!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MEMBER_EXIT_NOTE_MAX_LENGTH,
    example: "Vai fazer mestrado em outra cidade.",
    description:
      "Optional note. Stored, never returned by the API nor kept in the audit event. Do not record health information or diagnosis (RNF-13).",
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(MEMBER_EXIT_NOTE_MAX_LENGTH)
  note?: string | null;
}
