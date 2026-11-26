/**
 * Where an hour entry stands in the review by coordination (F7.2).
 *
 * An entry is born `pending`, except lesson hours, born `approved` while LESSON_HOURS_INITIAL_STATUS
 * says so (GUS-168), and only a pending entry can be removed by its person. `approved`, `adjusted`
 * (approved with other minutes, with a justification) and `rejected` (with a reason) are set by the
 * review, which is another card (GUS-164).
 *
 * The values are stored in the Postgres enum `hour_entries_status_enum`, which the history
 * (`hour_entry_events.from_status` and `to_status`) reuses: a new status needs a migration with
 * `ALTER TYPE hour_entries_status_enum ADD VALUE`.
 */
export enum HourEntryStatus {
  PENDING = "pending",
  APPROVED = "approved",
  ADJUSTED = "adjusted",
  REJECTED = "rejected",
}
