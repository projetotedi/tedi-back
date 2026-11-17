/**
 * The most entries of one `PUT /lessons/:id/attendance/members`: a ceiling on the size of the body.
 * A lesson has one teacher and a few monitors; more than 100 confirmed are signed in two batches.
 */
export const MEMBER_ATTENDANCE_MAX_ENTRIES = 100;

/**
 * The most entries of one `PUT /lessons/:id/attendance/students`: a ceiling on the size of the body.
 * A class has 15 to 30 students in practice; a bigger roll call is signed in more than one batch.
 */
export const STUDENT_ATTENDANCE_MAX_ENTRIES = 100;

/** The longest note of the justification of an absence: the length of `justification_note`. */
export const ABSENCE_JUSTIFICATION_NOTE_MAX_LENGTH = 500;

/** The longest reason of a correction of an attendance: the length of `attendance_corrections.reason`. */
export const ATTENDANCE_CORRECTION_REASON_MAX_LENGTH = 500;
