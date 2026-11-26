import { ApiProperty, ApiPropertyOptional, ApiPropertyOptions } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { trim, trimToNull } from "@shared/dto/transforms";
import {
  LESSON_PLAN_CONTENT_MAX_LENGTH,
  LESSON_PLAN_MATERIAL_URL_MAX_LENGTH,
  LESSON_PLAN_MAX_CONTENTS,
  LESSON_PLAN_MAX_DURATION_MINUTES,
  LESSON_PLAN_OBJECTIVE_MAX_LENGTH,
  LESSON_PLAN_TITLE_MAX_LENGTH,
} from "./lesson-plan-limits";
import { trimEach } from "./trim-each";

export const LESSON_PLAN_CONTENTS_PROPERTY: ApiPropertyOptions = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: LESSON_PLAN_CONTENT_MAX_LENGTH },
  minItems: 1,
  maxItems: LESSON_PLAN_MAX_CONTENTS,
  example: ["Teclado e mouse", "Janelas do sistema"],
  description: "Contents of the lesson plan, in the order they are taught. At least one.",
};

export const LESSON_PLAN_DURATION_PROPERTY: ApiPropertyOptions = {
  type: "integer",
  minimum: 1,
  maximum: LESSON_PLAN_MAX_DURATION_MINUTES,
  example: 90,
  description: "Expected duration in minutes. It counts toward the workload of the courses.",
};

export class CreateLessonPlanDto {
  @ApiProperty({
    type: String,
    maxLength: LESSON_PLAN_TITLE_MAX_LENGTH,
    example: "Teclado, mouse e janelas",
  })
  @Transform(trim)
  @MaxLength(LESSON_PLAN_TITLE_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: LESSON_PLAN_OBJECTIVE_MAX_LENGTH,
    example: "Familiarizar o aluno com o teclado, o mouse e o uso básico das janelas.",
    description: "Null or empty means not informed.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(LESSON_PLAN_OBJECTIVE_MAX_LENGTH)
  @IsString()
  objective?: string | null;

  @ApiProperty(LESSON_PLAN_DURATION_PROPERTY)
  @Max(LESSON_PLAN_MAX_DURATION_MINUTES)
  @Min(1)
  @IsInt()
  expectedDurationMinutes!: number;

  @ApiProperty(LESSON_PLAN_CONTENTS_PROPERTY)
  @Transform(trimEach)
  @MaxLength(LESSON_PLAN_CONTENT_MAX_LENGTH, { each: true })
  @IsNotEmpty({ each: true })
  @IsString({ each: true })
  @ArrayMaxSize(LESSON_PLAN_MAX_CONTENTS)
  @ArrayMinSize(1)
  @IsArray()
  contents!: string[];

  @ApiPropertyOptional({
    type: String,
    format: "uri",
    nullable: true,
    maxLength: LESSON_PLAN_MATERIAL_URL_MAX_LENGTH,
    example: "https://drive.google.com/file/d/exemplo/view",
    description:
      "Link to the material, http or https. The system stores the link, not the file. Null or empty means not informed.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(LESSON_PLAN_MATERIAL_URL_MAX_LENGTH)
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  materialUrl?: string | null;
}
