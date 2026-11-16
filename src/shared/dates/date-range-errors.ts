import { HttpException } from "@nestjs/common";

/**
 * The errors of a period `[from, to]` asked in a query: the one place that builds them, so every
 * route that takes a period answers the same body (the list and the calendar of the lessons, and
 * "Minhas aulas" and the lessons with an open place of the assignments). The `details` point at the
 * end of the period, where the front anchors the error. Whoever checks the period decides when to
 * throw them (`lessons/services/lesson-date-range.ts`, `assignments/services/my-lessons-period.ts`).
 */

/** 400 INVALID_DATE_RANGE: `to` is before `from` (one day, `from` equal to `to`, is a period). */
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

/** 400 DATE_RANGE_TOO_LONG: the period holds more days than the route takes, both ends counted. */
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
