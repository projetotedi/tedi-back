/**
 * The day of the week a series of lessons falls on (GUS-154). Lower case English names, the same
 * way the other enums of the API are written: the front translates them.
 *
 * It lives in the body of `POST /classes/:id/lessons/preview` and `/generate` and in the OpenAPI
 * (`Weekday`), and nowhere else: a lesson stores its `date`, never the day of the week, so there
 * is no database enum behind it and no migration.
 */
export enum Weekday {
  MONDAY = "monday",
  TUESDAY = "tuesday",
  WEDNESDAY = "wednesday",
  THURSDAY = "thursday",
  FRIDAY = "friday",
  SATURDAY = "saturday",
  SUNDAY = "sunday",
}
