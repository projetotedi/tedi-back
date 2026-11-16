import { calendarDaysBetween } from "@shared/dates/calendar-date";
import { dateRangeTooLong, invalidDateRange } from "@shared/dates/date-range-errors";

/**
 * Checks the period of a list of lessons, both "YYYY-MM-DD" that the DTO already validated. The
 * errors are the shared ones (`@shared/dates/date-range-errors`), the same body as the period of
 * "Minhas aulas":
 * - 400 INVALID_DATE_RANGE when `to` is before `from` (one day, `from` equal to `to`, is a period);
 * - 400 DATE_RANGE_TOO_LONG when `maxDays` is given and the period has more days than that, both
 *   ends counted: 2026-03-01 to 2026-04-11 is 42 days.
 *
 * It only checks when both days are there: the list takes `from` and `to` one at a time, and a
 * single end has nothing to be compared with. Without `maxDays` the length is not limited (the
 * list is paginated; the calendar is not, and passes the limit).
 */
export function assertDateRange(from?: string, to?: string, maxDays?: number): void {
  if (from === undefined || to === undefined) return;

  const daysBetween = calendarDaysBetween(from, to);
  if (daysBetween < 0) throw invalidDateRange();
  if (maxDays !== undefined && daysBetween + 1 > maxDays) throw dateRangeTooLong(maxDays);
}
