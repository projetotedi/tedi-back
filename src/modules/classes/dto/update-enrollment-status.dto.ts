import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { IsCalendarDate } from "@shared/dates/is-calendar-date.validator";
import { trimToNull } from "@shared/dto/transforms";
import { ENROLLMENT_STATUS_DESCRIPTION, EnrollmentStatus } from "../enums/enrollment-status.enum";
import { ENROLLMENT_STATUS_REASON_MAX_LENGTH } from "./enrollment-limits";

/** The body of `PATCH /enrollments/:id`: the new status, from when it holds and why (RF-027). */
export class UpdateEnrollmentStatusDto {
  @ApiProperty({
    enum: EnrollmentStatus,
    enumName: "EnrollmentStatus",
    example: EnrollmentStatus.DROPPED,
    description: ENROLLMENT_STATUS_DESCRIPTION,
  })
  @IsEnum(EnrollmentStatus)
  status!: EnrollmentStatus;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-04-10",
    description:
      'From when the new status holds ("A partir de"), YYYY-MM-DD, between the day of the enrollment and today (America/Sao_Paulo), both included.',
  })
  @IsCalendarDate()
  effectiveDate!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: ENROLLMENT_STATUS_REASON_MAX_LENGTH,
    example: "Mudou de cidade.",
    description:
      "Optional reason; it replaces the reason of the last change, and a change without one clears it. Never in a listing nor in an event (RNF-13).",
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(ENROLLMENT_STATUS_REASON_MAX_LENGTH)
  reason?: string | null;
}
