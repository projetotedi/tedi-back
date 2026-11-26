import { addCalendarDays, calendarDaysBetween } from "@shared/dates/calendar-date";
import { dateRangeTooLong, invalidDateRange } from "@shared/dates/date-range-errors";
import { MY_LESSONS_DEFAULT_DAYS, MY_LESSONS_MAX_DAYS } from "../dto/assignment-limits";

/** The period of "Minhas aulas" and of the lessons with an open place, both ends included. */
export interface MyLessonsPeriod {
  from: string;
  to: string;
}

/**
 * The period of "Minhas aulas" (GUS-160, C6), from the query, whose days the DTO already validated,
 * and today in America/Sao_Paulo (the caller reads it from its clock):
 * - without `from`, it is today; without `to`, it is `from` and 27 days after it: four weeks, both
 *   ends counted (`MY_LESSONS_DEFAULT_DAYS`);
 * - 400 INVALID_DATE_RANGE when `to` is before `from`, so a `to` alone before today is one too;
 * - 400 DATE_RANGE_TOO_LONG over `MY_LESSONS_MAX_DAYS` days, both ends counted.
 * Both errors are the shared ones (`@shared/dates/date-range-errors`): the same body as the list
 * and the calendar of the lessons.
 * Pure: it reads nothing, so the errors come before any read.
 */
export function resolveMyLessonsPeriod(
  query: { from?: string; to?: string },
  today: string,
): MyLessonsPeriod {
  const from = query.from ?? today;
  const to = query.to ?? addCalendarDays(from, MY_LESSONS_DEFAULT_DAYS - 1);

  const daysBetween = calendarDaysBetween(from, to);
  if (daysBetween < 0) throw invalidDateRange();
  if (daysBetween + 1 > MY_LESSONS_MAX_DAYS) throw dateRangeTooLong(MY_LESSONS_MAX_DAYS);

  return { from, to };
}
