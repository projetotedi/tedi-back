import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from "class-validator";
import { trim } from "@shared/dto/transforms";
import { HOUR_ENTRY_MAX_MINUTES, HOUR_ENTRY_REVIEW_NOTE_MAX_LENGTH } from "./hour-entry-limits";

/** The body of `PATCH /hour-entries/:id/adjust`: the minutes coordination accepts, and why. */
export class AdjustHourEntryDto {
  @ApiProperty({
    type: "integer",
    minimum: 1,
    maximum: HOUR_ENTRY_MAX_MINUTES,
    example: 120,
    description:
      "Minutes accepted, a whole number from 1 to 1440, different from the declared minutes (else 400 ADJUSTED_MINUTES_UNCHANGED). More than declared is allowed; 0 is a rejection.",
  })
  @Max(HOUR_ENTRY_MAX_MINUTES)
  @Min(1)
  @IsInt()
  validatedMinutes!: number;

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: HOUR_ENTRY_REVIEW_NOTE_MAX_LENGTH,
    example: "A reunião durou duas horas, conforme a ata.",
    description:
      "Why the minutes changed. Trimmed; blank is refused. The member sees it in her statement.",
  })
  @Transform(trim)
  @MaxLength(HOUR_ENTRY_REVIEW_NOTE_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  justification!: string;
}
