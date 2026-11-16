import { ApiProperty, OmitType } from "@nestjs/swagger";
import { IsCalendarDate } from "@shared/dates/is-calendar-date.validator";
import { LESSON_CALENDAR_MAX_DAYS } from "./lesson-limits";
import { ListLessonsQueryDto } from "./list-lessons-query.dto";

/**
 * Query parameters for GET /lessons/calendar: the filters of the list (`search`, `classId`,
 * `courseId`, `lessonPlanId` and `status`, with the same validation and the same meaning), no
 * `page` and no `limit`, because the calendar answers every lesson of the period in one call, and
 * `from` and `to` required. A `page` or a `limit` that comes is dropped by the whitelist.
 *
 * Only the format of the two days is checked here. That `from` is not after `to` (INVALID_DATE_RANGE)
 * and that the period is at most 42 days (DATE_RANGE_TOO_LONG) are business errors of the service.
 */
export class LessonsCalendarQueryDto extends OmitType(ListLessonsQueryDto, [
  "page",
  "limit",
  "from",
  "to",
] as const) {
  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-01",
    description:
      "First day of the period, YYYY-MM-DD, included. Required. It cannot be after `to` (else 400 INVALID_DATE_RANGE).",
  })
  @IsCalendarDate()
  from!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-04-11",
    description: `Last day of the period, YYYY-MM-DD, included. Required. The period holds at most ${LESSON_CALENDAR_MAX_DAYS} days counting both ends, six weeks, a month grid (else 400 DATE_RANGE_TOO_LONG).`,
  })
  @IsCalendarDate()
  to!: string;
}
