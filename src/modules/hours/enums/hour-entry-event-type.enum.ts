/**
 * What happened to an hour entry, one row of its history (`hour_entry_events`).
 *
 * `created` and `removed` are written by this module from GUS-162 on; `approved`, `adjusted` and
 * `rejected` are written by the review (GUS-164), and `approved` also by the attendance when lesson
 * hours are born approved. `reversed` (GUS-168): the hours of a presence were reversed, by a
 * correction to absent or by the cancellation of the lesson; the row of the entry is soft-deleted.
 *
 * The values are stored in the Postgres enum `hour_entry_events_type_enum`: a new type needs
 * `ALTER TYPE hour_entry_events_type_enum ADD VALUE`, always LAST (the e2e of the schema compares
 * the order of the labels with this enum).
 */
export enum HourEntryEventType {
  CREATED = "created",
  APPROVED = "approved",
  ADJUSTED = "adjusted",
  REJECTED = "rejected",
  REMOVED = "removed",
  REVERSED = "reversed",
}
