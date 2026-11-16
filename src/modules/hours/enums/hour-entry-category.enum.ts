/**
 * What kind of work an hour entry is (F7.7).
 *
 * The values are stored in the Postgres enum `hour_entries_category_enum`: a new category needs a
 * migration with `ALTER TYPE hour_entries_category_enum ADD VALUE`.
 */
export enum HourEntryCategory {
  LESSON = "lesson",
  PLANNING = "planning",
  EVENT = "event",
  MANAGEMENT = "management",
  MEETING = "meeting",
  SUPPORT = "support",
  OTHER = "other",
}

/**
 * The categories a person can log by hand, for herself or on behalf of a member: every one but
 * `lesson`. Lesson hours only come from the confirmed attendance (RN-03), so a lesson logged by hand
 * would be counted twice when the attendance arrives.
 */
export const LOGGABLE_HOUR_ENTRY_CATEGORIES: readonly HourEntryCategory[] = Object.values(
  HourEntryCategory,
).filter((category) => category !== HourEntryCategory.LESSON);
