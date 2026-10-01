import { registerDecorator, ValidationOptions } from "class-validator";
import { isValidCalendarDate, todayInAppTimeZone } from "@shared/dates/calendar-date";

export const MIN_BIRTH_DATE = "1900-01-01";

/**
 * "YYYY-MM-DD", a real calendar date, between MIN_BIRTH_DATE and today in APP_TIME_ZONE.
 * The lower bound catches typos such as 0958-04-12. A class-validator decorator cannot
 * receive injected services, so "today" comes from the real clock.
 */
export function IsBirthDate(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: "isBirthDate",
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `${String(propertyName)} must be a date in YYYY-MM-DD format between ${MIN_BIRTH_DATE} and today`,
        ...options,
      },
      validator: {
        // YYYY-MM-DD strings compare chronologically when compared lexicographically.
        validate: (value: unknown) =>
          typeof value === "string" &&
          isValidCalendarDate(value) &&
          value >= MIN_BIRTH_DATE &&
          value <= todayInAppTimeZone(),
      },
    });
  };
}
