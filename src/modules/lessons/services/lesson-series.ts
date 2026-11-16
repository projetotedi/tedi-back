import { Weekday } from "../enums/weekday.enum";
import { ClassPeriod, isWithinClassPeriod } from "./lesson-schedule";

/**
 * The calendar of a series of lessons: which days the plans of a sequence land on when the class
 * meets every week on the same day (F4.2). Pure functions on "YYYY-MM-DD" strings, with no Nest, no
 * database and no clock, so every rule of the dates is tested without any of them.
 *
 * The arithmetic is on the calendar day, done in UTC only because that is the one calendar that
 * has no daylight saving: a day is never 23 or 25 hours here, and no time zone of the machine
 * changes a result. It is the same reason `calendar-date.ts` builds its dates in UTC.
 */

/** The weekdays in the order of `Date#getUTCDay()`: 0 is Sunday. */
const WEEKDAYS: readonly Weekday[] = [
  Weekday.SUNDAY,
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
];

const DAYS_IN_WEEK = 7;

/** `date` ("YYYY-MM-DD", a day that exists) as midnight UTC of that day. */
function toUtcDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);

  // Date.UTC maps years 0 to 99 to 1900-1999, so build the date with setUTCFullYear instead.
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);

  return result;
}

/** Midnight UTC of a day as "YYYY-MM-DD", never as an ISO string that could carry a sign. */
function toCalendarDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/** The day of the week of `date` ("YYYY-MM-DD", a day that exists): 2026-04-07 is a tuesday. */
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[toUtcDate(date).getUTCDay()];
}

/**
 * `date` moved by `days` calendar days ("YYYY-MM-DD", a day that exists). Negative moves back. It
 * crosses months and years and knows the leap day: 2028-02-22 plus 7 is 2028-02-29.
 */
export function addDays(date: string, days: number): string {
  const result = toUtcDate(date);
  result.setUTCDate(result.getUTCDate() + days);

  return toCalendarDate(result);
}

/**
 * The first day that is `weekday`, counting `date` itself: `date` when it already is one, otherwise
 * the next one, at most six days ahead. "From" this date, never before it (2026-04-06, a monday,
 * with tuesday gives 2026-04-07).
 */
export function firstOccurrenceOnOrAfter(date: string, weekday: Weekday): string {
  const daysAhead =
    (WEEKDAYS.indexOf(weekday) - WEEKDAYS.indexOf(weekdayOf(date)) + DAYS_IN_WEEK) % DAYS_IN_WEEK;

  return addDays(date, daysAhead);
}

/**
 * `count` days, one a week: the first `weekday` on or after `firstDate`, then every seven days
 * after it. `[]` for a count of 0.
 */
export function weeklyDates(firstDate: string, weekday: Weekday, count: number): string[] {
  const first = firstOccurrenceOnOrAfter(firstDate, weekday);

  return Array.from({ length: Math.max(0, count) }, (_, index) =>
    addDays(first, index * DAYS_IN_WEEK),
  );
}

/**
 * A lesson plan of the sequence of a course, as the series needs it: what the lesson will copy
 * (title and objective, RN-18), the duration the preview shows and the place in the sequence.
 */
export interface SeriesPlan {
  /** Place of the plan in the sequence of the course, from 1: the `sequenceOrder` of its lesson. */
  position: number;
  lessonPlanId: string;
  title: string;
  objective: string | null;
  expectedDurationMinutes: number;
}

/** A plan of the series with the day its lesson lands on and whether that day is in the class. */
export interface SeriesItem extends SeriesPlan {
  /** "YYYY-MM-DD". */
  date: string;
  /** True when `date` is before the first day or after the last day of the class (RN-21). */
  outsideClassPeriod: boolean;
}

/**
 * One item per plan, in the order of `plans`: the first plan on the first `weekday` on or after
 * `firstDate`, and each next one a week after the one before. The series is one lesson a week with
 * no holidays and no skipped days (those are not part of the card), and a plan the caller left
 * out of `plans` (an archived one) leaves no gap: the days stay consecutive.
 *
 * It does not refuse a day outside the period of the class: it marks it, and the caller decides
 * (the preview shows it, the generation refuses it, RN-21). Ends are inside, as everywhere else.
 */
export function buildSeries(
  plans: readonly SeriesPlan[],
  firstDate: string,
  weekday: Weekday,
  period: ClassPeriod,
): SeriesItem[] {
  const dates = weeklyDates(firstDate, weekday, plans.length);

  return plans.map((plan, index) => ({
    ...plan,
    date: dates[index],
    outsideClassPeriod: !isWithinClassPeriod(dates[index], period),
  }));
}
