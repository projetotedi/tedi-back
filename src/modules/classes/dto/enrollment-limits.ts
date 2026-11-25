/** The most students one `POST /classes/:id/enrollments` enrolls (the body takes 1 to 100 ids). */
export const ENROLLMENT_MAX_STUDENTS = 100;

/**
 * The longest reason of a change of status. The column `enrollments.status_reason` is
 * varchar(500): the schema e2e keeps the two equal.
 */
export const ENROLLMENT_STATUS_REASON_MAX_LENGTH = 500;
