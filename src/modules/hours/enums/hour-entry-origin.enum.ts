/**
 * How an hour entry came to be.
 *
 * - `manual`: the person logged it for herself, so its author is the person;
 * - `on_behalf`: someone else logged it for her (a director of her department, coordination), so
 *   its author is never the person;
 * - `attendance`: the confirmed attendance of a lesson created it (GUS-168), and its author is
 *   whoever confirmed it.
 *
 * The check `ck_hour_entries_origin_author` keeps the first two rules in the database. The values
 * are stored in the Postgres enum `hour_entries_origin_enum`.
 */
export enum HourEntryOrigin {
  MANUAL = "manual",
  ON_BEHALF = "on_behalf",
  ATTENDANCE = "attendance",
}
