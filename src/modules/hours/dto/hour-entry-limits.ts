export const HOUR_ENTRY_ACTIVITY_MAX_LENGTH = 200;
export const HOUR_ENTRY_NOTES_MAX_LENGTH = 2000;
/** One day: the ceiling of a single entry, to catch a typo, not a rule of the bank of hours. */
export const HOUR_ENTRY_MAX_MINUTES = 1440;
/** The first day an entry or a period of the hours can take: an earlier one is a typo. */
export const HOUR_ENTRY_MIN_DATE = "2000-01-01";
/** The justification of an adjustment and the reason of a rejection; the column is `text`. */
export const HOUR_ENTRY_REVIEW_NOTE_MAX_LENGTH = 500;
/** Ids validated in one call: a whole page of the queue, whose `limit` is at most 100. */
export const HOUR_ENTRY_REVIEW_MAX_BATCH = 100;
