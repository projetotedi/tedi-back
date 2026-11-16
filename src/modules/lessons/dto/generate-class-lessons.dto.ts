import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { IsCalendarDate } from "@shared/dates/is-calendar-date.validator";
import { IsTimeOfDay } from "@shared/dates/is-time-of-day.validator";
import { TIME_OF_DAY_PATTERN } from "@shared/dates/time-of-day";
import { trimToNull } from "@shared/dto/transforms";
import { Weekday } from "../enums/weekday.enum";
import { LESSON_LOCATION_MAX_LENGTH } from "./lesson-limits";

/**
 * Body of `POST /classes/:id/lessons/preview` and `/generate` (GUS-154): when the class meets. The
 * same body on both, so the preview is exactly what the generation would do. The class is the one
 * of the URL, and the lessons come from the sequence of its course: nothing else is sent. The
 * whitelist drops whatever else comes (the expected students and monitors and the subject of a
 * lesson are edited on each lesson afterwards).
 */
export class GenerateClassLessonsDto {
  @ApiProperty({
    enum: Weekday,
    enumName: "Weekday",
    example: Weekday.TUESDAY,
    description:
      "The day of the week of the lessons: one lesson a week, always on this day. Lower case English name.",
  })
  @IsEnum(Weekday)
  weekday!: Weekday;

  @ApiProperty({
    type: String,
    pattern: TIME_OF_DAY_PATTERN.source,
    example: "09:00",
    description: "Start of every lesson, HH:mm in 24 hours.",
  })
  @IsTimeOfDay()
  startTime!: string;

  @ApiProperty({
    type: String,
    pattern: TIME_OF_DAY_PATTERN.source,
    example: "11:00",
    description:
      "End of every lesson, HH:mm in 24 hours. It must be after startTime (else 400 INVALID_TIME_RANGE): a lesson does not cross midnight.",
  })
  @IsTimeOfDay()
  endTime!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-04-07",
    description:
      "Where the series starts, YYYY-MM-DD. The first lesson is on the first weekday on or after this date: this very date when it already is that weekday, otherwise the next one (a monday with weekday tuesday starts the next day). Each next lesson is a week after the one before.",
  })
  @IsCalendarDate()
  firstDate!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: LESSON_LOCATION_MAX_LENGTH,
    example: "Laboratório 2 — Bloco B",
    description:
      "Place of every lesson. Null or blank means not informed. A lesson can have its place changed afterwards.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(LESSON_LOCATION_MAX_LENGTH)
  @IsString()
  location?: string | null;
}
