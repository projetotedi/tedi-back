/**
 * The most entries of one `PUT /lessons/:id/attendance/members`: a ceiling on the size of the body.
 * A lesson has one teacher and a few monitors; more than 100 confirmed are signed in two batches.
 */
export const MEMBER_ATTENDANCE_MAX_ENTRIES = 100;
