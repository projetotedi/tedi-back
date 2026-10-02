import { registerDecorator, ValidationOptions } from "class-validator";
import { isValidCalendarDate, todayInAppTimeZone } from "@shared/dates/calendar-date";

export const MIN_JOINED_AT = "2000-01-01";

/**
 * "YYYY-MM-DD", a real calendar date, between MIN_JOINED_AT and today in APP_TIME_ZONE.
 * Same care as IsBirthDate: the lower bound catches typos, a future date is not a join date.
 * A class-validator decorator cannot receive injected services, so "today" comes from the
 * real clock.
 */
export function IsJoinedAt(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: "isJoinedAt",
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `${String(propertyName)} must be a date in YYYY-MM-DD format between ${MIN_JOINED_AT} and today`,
        ...options,
      },
      validator: {
        // YYYY-MM-DD strings compare chronologically when compared lexicographically.
        validate: (value: unknown) =>
          typeof value === "string" &&
          isValidCalendarDate(value) &&
          value >= MIN_JOINED_AT &&
          value <= todayInAppTimeZone(),
      },
    });
  };
}
