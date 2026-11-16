import { registerDecorator, ValidationOptions } from "class-validator";
import { isValidCalendarDate, todayInAppTimeZone } from "@shared/dates/calendar-date";
import { MIN_JOINED_AT } from "./is-joined-at.validator";

/**
 * Exit date of a member (GUS-147): "YYYY-MM-DD", a real calendar date, between MIN_JOINED_AT and
 * today in APP_TIME_ZONE ("YYYY-MM-DD" strings compare chronologically as text). A future exit is
 * refused: the deactivation disables the access now, so a future date would close the login
 * before the person left. The floor against the join date of the member is checked by the
 * service, which has the profile. Same care as IsJoinedAt: a class-validator decorator cannot
 * receive injected services, so "today" comes from the real clock.
 */
export function IsExitDate(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: "isExitDate",
      target: target.constructor,
      propertyName: String(propertyName),
      options: {
        message: `${String(propertyName)} must be a date in YYYY-MM-DD format between ${MIN_JOINED_AT} and today`,
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === "string" &&
          isValidCalendarDate(value) &&
          value >= MIN_JOINED_AT &&
          value <= todayInAppTimeZone(),
      },
    });
  };
}
