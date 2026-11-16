/**
 * What happened to an hour entry, one row of its history (`hour_entry_events`).
 *
 * `created` and `removed` are written by this module from GUS-162 on; `approved`, `adjusted` and
 * `rejected` are written by the review (GUS-164). The values are stored in the Postgres enum
 * `hour_entry_events_type_enum`: a new type needs `ALTER TYPE hour_entry_events_type_enum ADD VALUE`.
 */
export enum HourEntryEventType {
  CREATED = "created",
  APPROVED = "approved",
  ADJUSTED = "adjusted",
  REJECTED = "rejected",
  REMOVED = "removed",
}
