import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { trim } from "@shared/dto/transforms";
import { LESSON_CANCEL_REASON_MAX_LENGTH } from "./lesson-limits";

/** Body of `PATCH /lessons/:id/cancel`. The reason is the whole body, and it is required. */
export class CancelLessonDto {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: LESSON_CANCEL_REASON_MAX_LENGTH,
    example: "Feriado municipal.",
    description:
      "Why the lesson is cancelled. Required, and not blank. Free text: do not record health information or diagnosis (RNF-13).",
  })
  @Transform(trim)
  @MaxLength(LESSON_CANCEL_REASON_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
