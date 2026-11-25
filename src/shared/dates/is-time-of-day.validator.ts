import { registerDecorator, ValidationOptions } from "class-validator";
import { isValidTimeOfDay } from "./time-of-day";

/**
 * "HH:mm" in 24 hours, from 00:00 to 23:59 ("9:00", "24:00" and "14:00:00" do not pass). Nothing
 * else is checked: a field that needs a range or an order between two times (a lesson ends after
 * it starts) does that on its own. Meant for the times of the agenda, such as the start and the end
 * of a lesson. The twin of `IsCalendarDate`, which does the same for the day.
 */
export function IsTimeOfDay(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: "isTimeOfDay",
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `${String(propertyName)} must be a time in HH:mm format`,
        ...options,
      },
      validator: {
        validate: (value: unknown) => typeof value === "string" && isValidTimeOfDay(value),
      },
    });
  };
}
