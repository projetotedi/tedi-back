import { HttpException } from "@nestjs/common";
import { calendarDaysBetween } from "@shared/dates/calendar-date";

/**
 * 400 INVALID_DATE_RANGE, with the field in `details` so the front anchors the error on the end of
 * the period. The one place that builds it: the list and the calendar of lessons answer the same.
 */
export function invalidDateRange(): HttpException {
  return new HttpException(
    {
      error: "INVALID_DATE_RANGE",
      message: "to must be on or after from.",
      details: [{ field: "to", message: "to must be on or after from" }],
    },
    400,
  );
}

/**
 * 400 DATE_RANGE_TOO_LONG: the period holds more days than the route takes, both ends counted. The
 * field in `details` is the end of the period, as in `invalidDateRange`.
 */
export function dateRangeTooLong(maxDays: number): HttpException {
  return new HttpException(
    {
      error: "DATE_RANGE_TOO_LONG",
      message: `The period cannot be longer than ${maxDays} days, counting both ends.`,
      details: [{ field: "to", message: `to must be at most ${maxDays - 1} days after from` }],
    },
    400,
  );
}

/**
 * Checks the period of a list of lessons, both "YYYY-MM-DD" that the DTO already validated:
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
