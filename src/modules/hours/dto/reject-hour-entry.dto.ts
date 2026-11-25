import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { trim } from "@shared/dto/transforms";
import { HOUR_ENTRY_REVIEW_NOTE_MAX_LENGTH } from "./hour-entry-limits";

/** The body of `PATCH /hour-entries/:id/reject`. The reason is mandatory. */
export class RejectHourEntryDto {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: HOUR_ENTRY_REVIEW_NOTE_MAX_LENGTH,
    example: "Atividade fora do projeto.",
    description:
      "Why the entry was rejected. Trimmed; blank is refused. The member sees it in her statement.",
  })
  @Transform(trim)
  @MaxLength(HOUR_ENTRY_REVIEW_NOTE_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
