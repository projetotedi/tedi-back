import { HttpException } from "@nestjs/common";

/**
 * The business errors of the enrollments (GUS-108), one helper each, so the services and the pipe
 * of the id answer the same thing. The messages are English literals and the stable part is the
 * `error` code: the front translates by it (there is no i18n in the backend).
 *
 * The 404 STUDENT_NOT_FOUND of an id in the URL (`/students/:id/enrollments`) is `studentNotFound` of
 * `people`, imported from the service that PeopleModule exports. What is built here are the errors of
 * this task that `people` has no helper for: the 400 STUDENT_NOT_FOUND and the 409 STUDENT_ARCHIVED
 * about ids of the body, with the positions, and the 409 STUDENT_ARCHIVED of a reactivation.
 *
 * The ones about the ids of the BODY carry the positions in `details` (`studentIds.<i>`): the ids
 * are not in the URL (docs/ARCHITECTURE.md section 10.3). STUDENT_ARCHIVED is 409 even so, as the
 * card asks (section 19, M18).
 *
 * ENROLLMENT_NOT_REMOVABLE has two helpers, one per reason, with the same code and the message that
 * says which: `enrollmentNotRemovable` (not active) and `enrollmentHasAttendance` (an active one
 * with an attendance signed, GUS-166, section 18.1, S15).
 */

interface FieldError {
  field: string;
  message: string;
}

/** The `details` of an error about some positions of the body, one item per position. */
function detailsOf(fields: readonly string[], message: string): { details?: FieldError[] } {
  return fields.length === 0 ? {} : { details: fields.map((field) => ({ field, message })) };
}

/** 404 for `/enrollments/:id`, shared by the pipe of the id of the route and by the service. */
export function enrollmentNotFound(): HttpException {
  return new HttpException(
    { error: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found." },
    404,
  );
}

/** 400: the same student more than once in the body, in any letter case, at the positions `fields`. */
export function duplicateStudent(fields: readonly string[]): HttpException {
  return new HttpException(
    {
      error: "DUPLICATE_STUDENT",
      message: "The same student appears more than once.",
      ...detailsOf(fields, "student appears more than once"),
    },
    400,
  );
}

/**
 * 400: ids of the body that are not students (no student profile, or the person or the profile was
 * removed), at the positions `fields`.
 */
export function studentNotFoundInBody(fields: readonly string[]): HttpException {
  return new HttpException(
    {
      error: "STUDENT_NOT_FOUND",
      message: "One or more students were not found.",
      ...detailsOf(fields, "student not found"),
    },
    400,
  );
}

/**
 * 409: an archived student takes no enrollment (RN-27). With the positions of the body when the ids
 * came in it (`POST`); without `details` for the reactivation of one enrollment (`PATCH`).
 */
export function studentArchived(fields: readonly string[] = []): HttpException {
  return new HttpException(
    {
      error: "STUDENT_ARCHIVED",
      message: "Archived students cannot be enrolled.",
      ...detailsOf(fields, "student is archived"),
    },
    409,
  );
}

/** 409: a completed or cancelled class takes no enrollment and no reactivation. */
export function classClosed(): HttpException {
  return new HttpException(
    {
      error: "CLASS_CLOSED",
      message: "A completed or cancelled class takes no new enrollments.",
    },
    409,
  );
}

/**
 * 409: more students than seats left. The seats left go in the message and, as a decimal string, in
 * `details[0].message`, on `field` (`studentIds` for the batch, `status` for a reactivation): the
 * global filter only copies `statusCode`, `message`, `error` and `details`, so a field of its own at
 * the root would be dropped.
 */
export function classFull(remaining: number, asked: number, field: string): HttpException {
  return new HttpException(
    {
      error: "CLASS_FULL",
      message: `The class has ${String(remaining)} seats left and ${String(asked)} students were asked.`,
      details: [{ field, message: String(remaining) }],
    },
    409,
  );
}

/**
 * 409: the student got a live enrollment in the class between the check and the insert. The lock of
 * the class makes it impossible; this is only the safety net of `uq_enrollments_class_id_student_id`.
 */
export function alreadyEnrolled(): HttpException {
  return new HttpException(
    { error: "ALREADY_ENROLLED", message: "The student is already enrolled in this class." },
    409,
  );
}

/** 400: the new status cannot hold from a day after today in America/Sao_Paulo. */
export function effectiveDateInFuture(): HttpException {
  return new HttpException(
    {
      error: "EFFECTIVE_DATE_IN_FUTURE",
      message: "The effective date cannot be after today.",
      details: [{ field: "effectiveDate", message: "must not be after today" }],
    },
    400,
  );
}

/** 400: the new status cannot hold from a day before the day of the enrollment. */
export function effectiveDateBeforeEnrollment(): HttpException {
  return new HttpException(
    {
      error: "EFFECTIVE_DATE_BEFORE_ENROLLMENT",
      message: "The effective date cannot be before the day of the enrollment.",
      details: [
        { field: "effectiveDate", message: "must not be before the day of the enrollment" },
      ],
    },
    400,
  );
}

/** 409: dropped and completed enrollments are history (RN-16); only an active one is removed. */
export function enrollmentNotRemovable(): HttpException {
  return new HttpException(
    {
      error: "ENROLLMENT_NOT_REMOVABLE",
      message: "Only an active enrollment can be removed; use the status change for the others.",
    },
    409,
  );
}

/**
 * 409: an active enrollment with an attendance signed in a lesson is history too (GUS-166): the
 * attendance keeps pointing to it, so it leaves the class through the status (dropped) instead.
 */
export function enrollmentHasAttendance(): HttpException {
  return new HttpException(
    {
      error: "ENROLLMENT_NOT_REMOVABLE",
      message: "An enrollment with attendance cannot be removed; change its status instead.",
    },
    409,
  );
}
