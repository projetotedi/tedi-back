/** Calendar of the project (UTFPR, Paraná). The server runs in UTC on Render. */
export const APP_TIME_ZONE = "America/Sao_Paulo";

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True for a "YYYY-MM-DD" string that exists in the calendar.
 * Rejects 2023-02-30, 1958-4-12, 12/04/1958 and datetimes.
 */
export function isValidCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Date.UTC maps years 0 to 99 to 1900-1999, so build the date with setUTCFullYear instead.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Today's date in APP_TIME_ZONE as "YYYY-MM-DD".
 * Uses Intl parts, never toISOString (which would give the UTC date).
 */
export function todayInAppTimeZone(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Whole years between birthDate and today (both "YYYY-MM-DD").
 * A Feb 29 birthday is reached on Mar 1 in non-leap years.
 */
export function ageOn(birthDate: string, today: string): number {
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);

  const reachedBirthday =
    todayMonth > birthMonth || (todayMonth === birthMonth && todayDay >= birthDay);

  return todayYear - birthYear - (reachedBirthday ? 0 : 1);
}
