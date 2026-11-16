import { registerDecorator, ValidationOptions } from "class-validator";

/**
 * A "YYYY-MM-DD" string on or after `min` (such strings compare chronologically as text). A value
 * that is not a string passes here and is left to IsCalendarDate, which reports it.
 */
export function IsOnOrAfterDate(min: string, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: "isOnOrAfterDate",
      target: target.constructor,
      propertyName: String(propertyName),
      constraints: [min],
      options: { message: `${String(propertyName)} must be on or after ${min}`, ...options },
      validator: {
        validate: (value: unknown) => typeof value !== "string" || value >= min,
      },
    });
  };
}
