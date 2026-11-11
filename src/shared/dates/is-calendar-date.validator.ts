import { registerDecorator, ValidationOptions } from "class-validator";
import { isValidCalendarDate } from "./calendar-date";

/**
 * The first date a Postgres `date` column takes as text: Postgres has no year 0000, so a value
 * from there would pass the calendar check and then fail at the insert as a 500.
 */
const MIN_CALENDAR_DATE = "0001-01-01";

/**
 * "YYYY-MM-DD" that exists in the calendar (2026-02-30 and 2026-3-3 do not), from year 0001 on.
 * Nothing else is checked: no upper bound, no relation to today. A field that needs a range (the
 * birth date, the join date) has its own decorator on top of `isValidCalendarDate`. Meant for the
 * dates of the agenda, such as the period of a class and, later, the day of a lesson.
 */
export function IsCalendarDate(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: "isCalendarDate",
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `${String(propertyName)} must be a date in YYYY-MM-DD format`,
        ...options,
      },
      validator: {
        // YYYY-MM-DD strings compare chronologically when compared lexicographically.
        validate: (value: unknown) =>
          typeof value === "string" && isValidCalendarDate(value) && value >= MIN_CALENDAR_DATE,
      },
    });
  };
}
