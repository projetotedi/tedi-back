import { ApiPropertyOptional, OmitType, PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { trim } from "@shared/dto/transforms";
import {
  CreateLessonPlanDto,
  LESSON_PLAN_CONTENTS_PROPERTY,
  LESSON_PLAN_DURATION_PROPERTY,
} from "./create-lesson-plan.dto";
import {
  LESSON_PLAN_CONTENT_MAX_LENGTH,
  LESSON_PLAN_MAX_CONTENTS,
  LESSON_PLAN_MAX_DURATION_MINUTES,
  LESSON_PLAN_TITLE_MAX_LENGTH,
} from "./lesson-plan-limits";
import { trimEach } from "./trim-each";

export class UpdateLessonPlanDto extends PartialType(
  OmitType(CreateLessonPlanDto, ["title", "expectedDurationMinutes", "contents"] as const),
) {
  @ApiPropertyOptional({
    type: String,
    maxLength: LESSON_PLAN_TITLE_MAX_LENGTH,
    example: "Teclado, mouse e janelas",
    description: "Omit to keep. Never null.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @MaxLength(LESSON_PLAN_TITLE_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({
    ...LESSON_PLAN_DURATION_PROPERTY,
    example: 120,
    description: `${LESSON_PLAN_DURATION_PROPERTY.description} Omit to keep. Never null.`,
  })
  @ValidateIf((_, value) => value !== undefined)
  @Max(LESSON_PLAN_MAX_DURATION_MINUTES)
  @Min(1)
  @IsInt()
  expectedDurationMinutes?: number;

  @ApiPropertyOptional({
    ...LESSON_PLAN_CONTENTS_PROPERTY,
    description: "Replaces the whole list, in this order. Omit to keep. Never null or empty.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimEach)
  @MaxLength(LESSON_PLAN_CONTENT_MAX_LENGTH, { each: true })
  @IsNotEmpty({ each: true })
  @IsString({ each: true })
  @ArrayMaxSize(LESSON_PLAN_MAX_CONTENTS)
  @ArrayMinSize(1)
  @IsArray()
  contents?: string[];
}
