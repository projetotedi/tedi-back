import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { IsCalendarDate } from "@shared/dates/is-calendar-date.validator";
import { LessonStatus } from "../enums/lesson-status.enum";
import { LESSON_SEARCH_MAX_LENGTH } from "./lesson-limits";

/**
 * Query parameters for GET /lessons. Every one is optional and they combine with AND. The calendar
 * (GET /lessons/calendar) takes the same filters, without the page, and with the period required:
 * `LessonsCalendarQueryDto`.
 */
export class ListLessonsQueryDto {
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
    type: String,
    maxLength: LESSON_SEARCH_MAX_LENGTH,
    example: "senhas privacidade",
    description:
      "Words to look for in the title and in the subject of the lesson. Every word has to show up, each one in either of the two, in any order and not necessarily next to each other: senhas privacidade finds Senhas e privacidade. Case and accents are ignored.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(LESSON_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    description:
      "Only the lessons of this class, archived class included. Without it, the lessons of an archived class are left out (RN-27). An id that matches no class answers an empty list.",
  })
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    description:
      "Only the lessons of the classes of this course. The lessons of its archived classes are left out. An id that matches no course answers an empty list.",
  })
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    description:
      "Only the lessons created from this lesson plan. An id that matches no plan answers an empty list.",
  })
  @IsOptional()
  @IsUUID()
  lessonPlanId?: string;

  @ApiPropertyOptional({
    enum: LessonStatus,
    enumName: "LessonStatus",
    description:
      "Only the lessons with this status. One value. Omit for every status: the cancelled lessons are listed too.",
  })
  @IsOptional()
  @IsEnum(LessonStatus)
  status?: LessonStatus;

  @ApiPropertyOptional({
    type: String,
    format: "date",
    example: "2026-03-01",
    description:
      "First day of the period, YYYY-MM-DD, included. It can come alone. With `to`, it cannot be after it (else 400 INVALID_DATE_RANGE).",
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: "date",
    example: "2026-04-11",
    description:
      "Last day of the period, YYYY-MM-DD, included. It can come alone. With `from`, it cannot be before it (else 400 INVALID_DATE_RANGE).",
  })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}
