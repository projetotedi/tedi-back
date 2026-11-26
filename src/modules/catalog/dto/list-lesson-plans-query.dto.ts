import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidationArguments,
} from "class-validator";
import { LessonPlanListSort, LessonPlanUsageFilter } from "../enums/lesson-plan-list.enums";
import { LESSON_PLAN_MAX_DURATION_MINUTES } from "./lesson-plan-limits";

const toNumber = ({ value }: { value: unknown }) =>
  value !== undefined ? Number(value) : undefined;

/**
 * A number not below the one in `property` of the same query: the range of duration cannot end
 * before it starts. Either one missing, or not a number, passes here and is left to the others.
 */
function IsNotBelow(property: string): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: "isNotBelow",
      target: target.constructor,
      propertyName: String(propertyName),
      constraints: [property],
      options: { message: `${String(propertyName)} must not be below ${property}` },
      validator: {
        validate: (value: unknown, args: ValidationArguments) => {
          const other = (args.object as Record<string, unknown>)[property];
          return typeof value !== "number" || typeof other !== "number" || value >= other;
        },
      },
    });
  };
}

/** Query parameters of GET /lesson-plans (GUS-95). */
export class ListLessonPlansQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    example: "teclado",
    maxLength: 100,
    description: "Search by title, ignoring case and accents.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    example: "janela",
    maxLength: 100,
    description:
      "Only the plans with a content that contains this text, ignoring case and accents.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  content?: string;

  @ApiPropertyOptional({
    enum: LessonPlanUsageFilter,
    enumName: "LessonPlanUsageFilter",
    description:
      "in_use: not archived and in at least one course; unused: not archived and in no course; archived: only the archived ones. Omitted lists every plan that is not archived.",
  })
  @IsOptional()
  @IsEnum(LessonPlanUsageFilter)
  usage?: LessonPlanUsageFilter;

  @ApiPropertyOptional({
    example: 60,
    minimum: 1,
    description: "Only the plans of at least this many minutes.",
  })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(LESSON_PLAN_MAX_DURATION_MINUTES)
  minDuration?: number;

  @ApiPropertyOptional({
    example: 120,
    minimum: 1,
    description: "Only the plans of at most this many minutes. Not below minDuration.",
  })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(LESSON_PLAN_MAX_DURATION_MINUTES)
  @IsNotBelow("minDuration")
  maxDuration?: number;

  @ApiPropertyOptional({
    format: "uuid",
    description:
      "Leaves out the plans that are in the sequence of this course: the picker of the sequence sends it.",
  })
  @IsOptional()
  @IsUUID("all")
  excludeCourseId?: string;

  @ApiPropertyOptional({
    enum: LessonPlanListSort,
    enumName: "LessonPlanListSort",
    default: LessonPlanListSort.TITLE,
    description: "title is alphabetical; updatedAt puts the plan changed last first.",
  })
  @IsOptional()
  @IsEnum(LessonPlanListSort)
  sort?: LessonPlanListSort;
}
