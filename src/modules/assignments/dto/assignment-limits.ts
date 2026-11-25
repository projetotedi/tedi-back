/** The note of an assignment: free text, as long as the `note` column (`varchar(500)`). */
export const ASSIGNMENT_NOTE_MAX_LENGTH = 500;

/** "Minhas aulas" without `to`: four weeks from `from`, both ends counted (GUS-160). */
export const MY_LESSONS_DEFAULT_DAYS = 28;

/**
 * The longest period of "Minhas aulas" and of the lessons with an open place, both ends counted:
 * six weeks, the limit of the calendar, which is what makes answering without a page safe.
 */
export const MY_LESSONS_MAX_DAYS = 42;
