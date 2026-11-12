/**
 * A time of day as "HH:mm", 24 hours, zero-padded: "09:00" and "23:59" are valid; "9:00", "24:00",
 * "14:00:00" and "2 pm" are not. No seconds, no time zone: it is the wall-clock time of the project
 * (APP_TIME_ZONE), the same way `calendar-date.ts` handles the day.
 */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for an "HH:mm" string, from "00:00" to "23:59". */
export function isValidTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_PATTERN.test(value);
}

/**
 * Minutes since midnight: "00:00" is 0 and "14:30" is 870. `time` must be an "HH:mm" that
 * `isValidTimeOfDay` accepts; anything else is not checked here.
 */
export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);

  return hours * 60 + minutes;
}

/**
 * Minutes from `start` to `end`, both "HH:mm" on the same day: "14:00" to "15:30" is 90. It is
 * negative when `end` is before `start` and 0 when they are equal.
 */
export function minutesBetween(start: string, end: string): number {
  return minutesOfDay(end) - minutesOfDay(start);
}
