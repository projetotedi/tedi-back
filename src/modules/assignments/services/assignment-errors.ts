import { HttpException } from "@nestjs/common";

/**
 * The business errors of the assignments, one helper each, so a service, a pipe and the mapping of
 * a constraint answer the same thing. The messages are English literals and the stable part is the
 * `error` code: the front translates by it (there is no i18n in the backend).
 *
 * The ones that point at an id of the BODY (the member) are 400 and carry the field in `details`:
 * the id is not in the URL, so a 404 would read as "the route does not exist"
 * (docs/ARCHITECTURE.md section 10.3). The same code is 404 in the route of the member itself.
 */

/** 404 for `/lessons/:id/assignments`, shared by the pipe of the id of the route and by the reads. */
export function lessonNotFound(): HttpException {
  return new HttpException({ error: "LESSON_NOT_FOUND", message: "Lesson not found." }, 404);
}

/** 409: a cancelled lesson does not happen, so nobody is assigned to it (F4.5). */
export function lessonCancelled(): HttpException {
  return new HttpException(
    { error: "LESSON_CANCELLED", message: "Cancelled lessons cannot receive assignments." },
    409,
  );
}

/**
 * 400 for the `personId` of the body of `POST /lessons/:id/assignments`: 404 would read as "route
 * not found". It is also the answer to the foreign key violation `fk_lesson_assignments_person_id`.
 * A student, an unknown id and a deleted person are all "not a member".
 */
export function memberNotFoundInBody(): HttpException {
  return new HttpException(
    {
      error: "MEMBER_NOT_FOUND",
      message: "Member not found.",
      details: [{ field: "personId", message: "personId does not match any member" }],
    },
    400,
  );
}

/** 404 for `/members/:id/assignments`, shared by the pipe of the id of the route and by the read. */
export function memberNotFound(): HttpException {
  return new HttpException({ error: "MEMBER_NOT_FOUND", message: "Member not found." }, 404);
}

/**
 * 409: the member cannot receive work: she has no access (it was disabled) or her registration is
 * still pending or was rejected. The member exists (that is 400 MEMBER_NOT_FOUND).
 */
export function memberInactive(): HttpException {
  return new HttpException(
    { error: "MEMBER_INACTIVE", message: "Inactive members cannot receive assignments." },
    409,
  );
}

/**
 * 409: one member holds at most one place in a lesson, as teacher or as monitor, never both and
 * never twice (RN-01). Also the answer to the unique violation
 * `uq_lesson_assignments_lesson_id_person_id_active`, when two requests race past the pre-check.
 */
export function duplicateRoleInLesson(): HttpException {
  return new HttpException(
    {
      error: "DUPLICATE_ROLE_IN_LESSON",
      message: "The member already has an active assignment in this lesson.",
    },
    409,
  );
}

/**
 * 409: a lesson has at most one confirmed teacher (RN-02). Also the answer to the unique violation
 * `uq_lesson_assignments_lesson_id_confirmed_teacher`, when two requests race past the pre-check.
 */
export function lessonTeacherTaken(): HttpException {
  return new HttpException(
    { error: "LESSON_TEACHER_TAKEN", message: "The lesson already has a confirmed teacher." },
    409,
  );
}

/** 404 for `/assignments/:id`, shared by the pipe of the id of the route and by the reads. */
export function assignmentNotFound(): HttpException {
  return new HttpException(
    { error: "ASSIGNMENT_NOT_FOUND", message: "Assignment not found." },
    404,
  );
}

/** 409: only a pending assignment is confirmed; a declined or cancelled one is final. */
export function assignmentNotPending(): HttpException {
  return new HttpException(
    {
      error: "ASSIGNMENT_NOT_PENDING",
      message: "Only a pending assignment can be confirmed.",
    },
    409,
  );
}

/** 409: only a pending or confirmed assignment is cancelled; a declined one was never in place. */
export function assignmentNotActive(): HttpException {
  return new HttpException(
    {
      error: "ASSIGNMENT_NOT_ACTIVE",
      message: "Only a pending or confirmed assignment can be cancelled.",
    },
    409,
  );
}

/**
 * 409 for the application of a member (GUS-160): she already holds a place in the lesson, pending or
 * confirmed, direct or applied for, as either role. Also the answer to the unique violation
 * `uq_lesson_assignments_lesson_id_person_id_active` on the routes of the applications. The routes
 * of the direct assignment answer DUPLICATE_ROLE_IN_LESSON for the same thing.
 */
export function alreadyApplied(): HttpException {
  return new HttpException(
    {
      error: "ALREADY_APPLIED",
      message: "The member already has an assignment or an application in this lesson.",
    },
    409,
  );
}

/**
 * 409: the lesson has no open place for the role (GUS-160): a teacher is already confirmed, or the
 * confirmed monitors reach the expected ones (or none are expected). Only confirmed assignments take
 * a place, so a pending application never fills one. On the approval, also the answer to the unique
 * violation `uq_lesson_assignments_lesson_id_confirmed_teacher`.
 */
export function roleFull(): HttpException {
  return new HttpException(
    { error: "ROLE_FULL", message: "The lesson has no open place for this role." },
    409,
  );
}

/** 409: a member applies to a lesson from today on, in America/Sao_Paulo (GUS-160). */
export function lessonInPast(): HttpException {
  return new HttpException(
    {
      error: "LESSON_IN_PAST",
      message: "Applications are only taken for lessons from today on.",
    },
    409,
  );
}

/**
 * 404 for `/applications/:id`, shared by the pipe of the id of the route and by the review: an
 * unknown or malformed id, and a direct assignment too, since the resource of the URL is the
 * application and a direct assignment is not one (docs/ARCHITECTURE.md section 10.3).
 */
export function applicationNotFound(): HttpException {
  return new HttpException(
    { error: "APPLICATION_NOT_FOUND", message: "Application not found." },
    404,
  );
}

/**
 * 409: only a pending application is approved or declined. A declined or cancelled one is final,
 * and an approved one leaves through `PATCH /assignments/:id/cancel`.
 */
export function applicationNotPending(): HttpException {
  return new HttpException(
    {
      error: "APPLICATION_NOT_PENDING",
      message: "Only a pending application can be approved or declined.",
    },
    409,
  );
}
