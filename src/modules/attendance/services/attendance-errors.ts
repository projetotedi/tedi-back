import { HttpException } from "@nestjs/common";

/**
 * The business errors of the attendance, one helper each, so a service and a pipe answer the same
 * thing. The messages are English literals and the stable part is the `error` code: the front
 * translates by it (there is no i18n in the backend). The codes owned by another module
 * (LESSON_NOT_FOUND, LESSON_CANCELLED, MEMBER_NOT_FOUND) are built here again, because a module does
 * not import the helpers of another.
 *
 * The ones about the ids of the BODY are 400 and carry the positions in `details`
 * (`entries.<i>.assignmentId`): the ids are not in the URL (docs/ARCHITECTURE.md section 10.3).
 */

interface FieldError {
  field: string;
  message: string;
}

/** The `details` of an error about some positions of the body, one item per position. */
function detailsOf(fields: readonly string[], message: string): { details?: FieldError[] } {
  return fields.length === 0 ? {} : { details: fields.map((field) => ({ field, message })) };
}

/** 404 for `/lessons/:id/attendance/members`, shared by the pipe of the id of the route and by the service. */
export function lessonNotFound(): HttpException {
  return new HttpException({ error: "LESSON_NOT_FOUND", message: "Lesson not found." }, 404);
}

/** 409: a cancelled lesson did not happen, so nobody signs an attendance in it (RN-07). */
export function lessonCancelled(): HttpException {
  return new HttpException(
    { error: "LESSON_CANCELLED", message: "Cancelled lessons do not take attendance." },
    409,
  );
}

/** 409: the attendance is signed for a lesson of today or before, in APP_TIME_ZONE. */
export function lessonInFuture(): HttpException {
  return new HttpException(
    {
      error: "LESSON_IN_FUTURE",
      message: "Attendance is signed for lessons of today or before.",
    },
    409,
  );
}

/** 400: the same assignment more than once in the body, in any letter case, at the positions `fields`. */
export function duplicateAssignment(fields: readonly string[]): HttpException {
  return new HttpException(
    {
      error: "DUPLICATE_ASSIGNMENT",
      message: "The same assignment appears more than once.",
      ...detailsOf(fields, "assignment appears more than once"),
    },
    400,
  );
}

/**
 * 400: assignments of the body that are not confirmed in THIS lesson (pending, declined, cancelled,
 * of another lesson or unknown), at the positions `fields`.
 */
export function assignmentNotConfirmed(fields: readonly string[]): HttpException {
  return new HttpException(
    {
      error: "ASSIGNMENT_NOT_CONFIRMED",
      message: "One or more assignments are not confirmed in this lesson.",
      ...detailsOf(fields, "assignment is not confirmed in this lesson"),
    },
    400,
  );
}

/** 404 for `/members/:id/attendance`, shared by the pipe of the id of the route and by the service. */
export function memberNotFound(): HttpException {
  return new HttpException({ error: "MEMBER_NOT_FOUND", message: "Member not found." }, 404);
}

/**
 * 403 FORBIDDEN: changing an attendance already signed (present to absent or back) is a correction,
 * and the profile does not have attendance.correct. The same code the guard answers to a profile
 * without the permission (docs/PERMISSIONS.md); no `details`, it is about who asks.
 */
export function attendanceCorrectionForbidden(): HttpException {
  return new HttpException(
    {
      error: "FORBIDDEN",
      message: "Only coordination and directors correct a signed attendance.",
    },
    403,
  );
}
