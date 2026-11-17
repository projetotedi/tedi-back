import { ApiProperty, ApiPropertyOptional, ApiSchema } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { trimToNull } from "@shared/dto/transforms";
import {
  ABSENCE_JUSTIFICATION_REASON_DESCRIPTION,
  AbsenceJustificationReason,
} from "../enums/absence-justification-reason.enum";
import { ABSENCE_JUSTIFICATION_NOTE_MAX_LENGTH } from "./attendance-limits";

/** The body of `PATCH /student-attendance/:id/justify`. */
@ApiSchema({
  description:
    "The justification of an absence: why, and optionally a note. Justifying again replaces it; the same reason and note change nothing. The absence stays an absence.",
})
export class JustifyAbsenceDto {
  @ApiProperty({
    enum: AbsenceJustificationReason,
    enumName: "AbsenceJustificationReason",
    example: AbsenceJustificationReason.HEALTH,
    description: ABSENCE_JUSTIFICATION_REASON_DESCRIPTION,
  })
  @IsEnum(AbsenceJustificationReason)
  reason!: AbsenceJustificationReason;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: ABSENCE_JUSTIFICATION_NOTE_MAX_LENGTH,
    example: "Consulta médica marcada.",
    description:
      "A note about the absence. Optional; trimmed, and empty becomes null. It may carry health data: it never goes to an event, and only whoever takes the roll call of the lesson reads it.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(ABSENCE_JUSTIFICATION_NOTE_MAX_LENGTH)
  @IsString()
  note?: string | null;
}
