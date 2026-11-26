import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional } from "class-validator";
import { IsCalendarDate } from "@shared/dates/is-calendar-date.validator";
import { MY_LESSONS_DEFAULT_DAYS, MY_LESSONS_MAX_DAYS } from "./assignment-limits";

/**
 * Query of `GET /me/assignments` and `GET /me/open-lessons`: the same period for both, so the
 * screen asks the two with the same parameters (or none). Only the format of the days is checked
 * here; that `from` is not after `to` and the length of the period are business errors of the
 * service (INVALID_DATE_RANGE, DATE_RANGE_TOO_LONG), as in the calendar of the lessons.
 */
export class MyLessonsPeriodQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: "date",
    example: "2026-03-09",
    description:
      "First day of the period, YYYY-MM-DD, included. Without it, today in America/Sao_Paulo.",
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: "date",
    example: "2026-04-05",
    description: `Last day of the period, YYYY-MM-DD, included. Without it, ${MY_LESSONS_DEFAULT_DAYS - 1} days after from (four weeks, both ends counted). It cannot be before from (else 400 INVALID_DATE_RANGE), and the period holds at most ${MY_LESSONS_MAX_DAYS} days counting both ends (else 400 DATE_RANGE_TOO_LONG).`,
  })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}
