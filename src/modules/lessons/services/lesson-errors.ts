import { HttpException } from "@nestjs/common";

/**
 * The business errors of the lessons, one helper each, so a service, a pipe and the mapping of a
 * constraint answer the same thing. The messages are English literals and the stable part is the
 * `error` code: the front translates by it (there is no i18n in the backend).
 *
 * The ones that point at an id of the BODY (the class, the lesson plan) are 400 and carry the
 * field in `details`: the id is not in the URL, so a 404 would read as "the route does not exist"
 * (docs/ARCHITECTURE.md section 10.3). The same codes are 404 and 409 in the routes of their own
 * resource.
 */

/** 404 for `/lessons/:id`, shared by the pipe of the id of the route and by the reads. */
export function lessonNotFound(): HttpException {
  return new HttpException({ error: "LESSON_NOT_FOUND", message: "Lesson not found." }, 404);
}

/** 409: a cancelled lesson is final, it is neither edited nor rescheduled (F4.5). */
export function lessonCancelled(): HttpException {
  return new HttpException(
    { error: "LESSON_CANCELLED", message: "Cancelled lessons cannot be edited or rescheduled." },
    409,
  );
}

/**
 * 400 for the `classId` of the body of `POST /lessons`: 404 would read as "route not found". It is
 * also the answer to the foreign key violation `fk_lessons_class_id`. The text is the same as the
 * 404 CLASS_NOT_FOUND of `/classes/:id`, and so is the collision of codes, as with COURSE_NOT_FOUND.
 */
export function classNotFoundInBody(): HttpException {
  return new HttpException(
    {
      error: "CLASS_NOT_FOUND",
      message: "Class not found.",
      details: [{ field: "classId", message: "classId does not match any class" }],
    },
    400,
  );
}

/**
 * 409: archived classes are read-only (RN-27), so a lesson of one cannot be created, edited,
 * cancelled or rescheduled. 409 on the four writes, the creation included: the id of the class is
 * in the body there, where the rule of the other modules would say 400, but a 409 is what the card
 * fixes and what the front already maps.
 */
export function classArchived(): HttpException {
  return new HttpException(
    { error: "CLASS_ARCHIVED", message: "Archived classes are read-only." },
    409,
  );
}

/** 400 for the `lessonPlanId` of the body of `POST /lessons`, also the foreign key `fk_lessons_lesson_plan_id`. */
export function lessonPlanNotFoundInBody(): HttpException {
  return new HttpException(
    {
      error: "LESSON_PLAN_NOT_FOUND",
      message: "Lesson plan not found.",
      details: [{ field: "lessonPlanId", message: "lessonPlanId does not match any lesson plan" }],
    },
    400,
  );
}

/** 400: an archived plan does not originate a new lesson (RN-27); the lessons it already has keep it. */
export function lessonPlanArchivedInBody(): HttpException {
  return new HttpException(
    {
      error: "LESSON_PLAN_ARCHIVED",
      message: "An archived lesson plan cannot originate a lesson.",
      details: [{ field: "lessonPlanId", message: "lessonPlanId is an archived lesson plan" }],
    },
    400,
  );
}

/**
 * 400: the `sequenceOrder` of the body is the position the lesson plan has in the sequence of the
 * course of the class, and it is not (the plan is elsewhere in the sequence, or not in it at all).
 */
export function lessonPlanNotInCourseSequence(): HttpException {
  return new HttpException(
    {
      error: "LESSON_PLAN_NOT_IN_COURSE_SEQUENCE",
      message: "The lesson plan is not at that position in the sequence of the course.",
      details: [
        {
          field: "sequenceOrder",
          message: "sequenceOrder is not the position of the lesson plan in the course sequence",
        },
      ],
    },
    400,
  );
}
