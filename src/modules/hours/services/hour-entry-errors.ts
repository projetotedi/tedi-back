import { HttpException } from "@nestjs/common";

/**
 * 404 for `/me/hour-entries/:id`: a malformed id, an unknown one, an entry of another person and
 * one already removed all answer the same, so the route never tells that someone else's entry
 * exists. Shared by the pipe of the id of the route and by the service, so both answer the same.
 */
export function hourEntryNotFound(): HttpException {
  return new HttpException(
    { error: "HOUR_ENTRY_NOT_FOUND", message: "Hour entry not found." },
    404,
  );
}

/** 409: only a pending entry can be removed; a reviewed one is part of the bank of hours. */
export function entryNotPending(): HttpException {
  return new HttpException(
    { error: "ENTRY_NOT_PENDING", message: "Only pending hour entries can be removed." },
    409,
  );
}

/**
 * 409: lesson hours of an attendance (GUS-168) are not removed by the person, in any status: they
 * change only with the attendance (a correction to absent, or the cancellation of the lesson).
 */
export function attendanceEntryNotRemovable(): HttpException {
  return new HttpException(
    {
      error: "ATTENDANCE_ENTRY_NOT_REMOVABLE",
      message:
        "Lesson hours of an attendance cannot be removed; the attendance is corrected instead.",
    },
    409,
  );
}

/** 400: hours are logged for work already done, never after today in APP_TIME_ZONE. */
export function hourEntryDateInFuture(): HttpException {
  return new HttpException(
    {
      error: "HOUR_ENTRY_DATE_IN_FUTURE",
      message: "Hours cannot be logged for a future date.",
      details: [{ field: "date", message: "date must not be after today" }],
    },
    400,
  );
}

/**
 * 404 for `/members/:id/hour-entries`: a malformed id, an unknown or deleted person and a person
 * without an approved member registration, from the pipe of the id of the route and from the
 * service alike. The same code and text as the member record of the people module, built here
 * because a module does not import the helpers of another.
 */
export function memberNotFound(): HttpException {
  return new HttpException({ error: "MEMBER_NOT_FOUND", message: "Member not found." }, 404);
}

/** 400: logging for oneself goes through `/me`, so `on_behalf` always means "logged by someone else". */
export function selfOnBehalfNotAllowed(): HttpException {
  return new HttpException(
    {
      error: "SELF_ON_BEHALF_NOT_ALLOWED",
      message: "Log your own hours with POST /me/hour-entries.",
    },
    400,
  );
}

/** 400: a period whose start is after its end, anchored on `to`. */
export function invalidPeriod(): HttpException {
  return new HttpException(
    {
      error: "INVALID_PERIOD",
      message: "from must be on or before to.",
      details: [{ field: "to", message: "to must be on or after from" }],
    },
    400,
  );
}

/** The `details` of an error about some positions of the body, one item per position. */
function detailsOf(fields: readonly string[], message: string): { details?: FieldError[] } {
  return fields.length === 0 ? {} : { details: fields.map((field) => ({ field, message })) };
}

interface FieldError {
  field: string;
  message: string;
}

/**
 * 400 for ids of the body of `PATCH /hour-entries/validate` that are unknown or removed: an id in
 * the body is 400, an id in the URL is 404 (docs/ARCHITECTURE.md section 10.3). `fields` are the
 * positions, as `ids.<i>`.
 */
export function hourEntriesNotFound(fields: readonly string[]): HttpException {
  return new HttpException(
    {
      error: "HOUR_ENTRY_NOT_FOUND",
      message: "One or more hour entries do not exist.",
      ...detailsOf(fields, "hour entry not found"),
    },
    400,
  );
}

/** 400: the same entry more than once in the body, in any letter case, at the positions `fields`. */
export function duplicateHourEntry(fields: readonly string[]): HttpException {
  return new HttpException(
    {
      error: "DUPLICATE_HOUR_ENTRY",
      message: "The same hour entry appears more than once.",
      ...detailsOf(fields, "hour entry appears more than once"),
    },
    400,
  );
}

/** 409: nobody reviews her own hours. `fields` are the positions in a batch, empty for one entry. */
export function selfReviewNotAllowed(fields: readonly string[] = []): HttpException {
  return new HttpException(
    {
      error: "SELF_REVIEW_NOT_ALLOWED",
      message: "You cannot review your own hour entry.",
      ...detailsOf(fields, "you cannot review your own hour entry"),
    },
    409,
  );
}

/**
 * 409: only a pending entry can be reviewed; a reviewed one is final. The same code as the removal
 * (`entryNotPending`), with its own message. `fields` are the positions in a batch, empty for one.
 */
export function entryNotPendingForReview(fields: readonly string[] = []): HttpException {
  return new HttpException(
    {
      error: "ENTRY_NOT_PENDING",
      message: "Only pending hour entries can be reviewed.",
      ...detailsOf(fields, "hour entry is not pending"),
    },
    409,
  );
}

/** 400: an adjustment changes the minutes; keeping the declared ones is a validation. */
export function adjustedMinutesUnchanged(): HttpException {
  return new HttpException(
    {
      error: "ADJUSTED_MINUTES_UNCHANGED",
      message:
        "validatedMinutes must differ from the declared minutes; validate the entry instead.",
      details: [
        {
          field: "validatedMinutes",
          message: "validatedMinutes must differ from the declared minutes",
        },
      ],
    },
    400,
  );
}

/**
 * The link of an entry to a class and a lesson (GUS-172). The ids come in the body, so an unknown
 * one is 400 (docs/ARCHITECTURE.md section 10.3), with the field in `details`. The codes owned by
 * `classes` and `lessons` are built here again, because a module does not import the helpers of
 * another.
 */

/** 400: the `classId` of the body is not a class. */
export function linkedClassNotFound(): HttpException {
  return new HttpException(
    {
      error: "CLASS_NOT_FOUND",
      message: "Class not found.",
      details: [{ field: "classId", message: "class not found" }],
    },
    400,
  );
}

/** 400: the `lessonId` of the body is not a lesson. */
export function linkedLessonNotFound(): HttpException {
  return new HttpException(
    {
      error: "LESSON_NOT_FOUND",
      message: "Lesson not found.",
      details: [{ field: "lessonId", message: "lesson not found" }],
    },
    400,
  );
}

/** 400: the lesson and the class of the body do not match: the class of an entry is the lesson's. */
export function lessonNotInClass(): HttpException {
  return new HttpException(
    {
      error: "LESSON_NOT_IN_CLASS",
      message: "The lesson does not belong to the class.",
      details: [{ field: "lessonId", message: "lesson does not belong to classId" }],
    },
    400,
  );
}

/** 409: a cancelled lesson did not happen, so no entry is linked to it. */
export function linkedLessonCancelled(): HttpException {
  return new HttpException(
    {
      error: "LESSON_CANCELLED",
      message: "Hours cannot be linked to a cancelled lesson.",
      details: [{ field: "lessonId", message: "lesson is cancelled" }],
    },
    409,
  );
}

/**
 * 409: archived classes are read-only (RN-27). `field` is the id of the body the class came from:
 * `classId`, or `lessonId` when the class is the lesson's.
 */
export function linkedClassArchived(field: "classId" | "lessonId"): HttpException {
  return new HttpException(
    {
      error: "CLASS_ARCHIVED",
      message: "Hours cannot be linked to an archived class.",
      details: [{ field, message: "class is archived" }],
    },
    409,
  );
}
