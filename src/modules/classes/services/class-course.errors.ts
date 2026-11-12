import { HttpException } from "@nestjs/common";

/**
 * The errors about the course of a class. The one place that builds them: the create and the edit
 * of a class, the foreign key violation and the reads by course all answer the same.
 *
 * `COURSE_NOT_FOUND` has two statuses, as in the rest of the API (docs/ARCHITECTURE.md, section
 * 10.3): 400 when the id of the course comes in the body of the request (it is a field that does
 * not point to anything), 404 when it comes in the URL (`/courses/:id/classes`). The front tells
 * them apart by the status.
 */

/** The `courseId` of the body is not a course: 400. */
export function courseNotFoundInBody(): HttpException {
  return new HttpException({ error: "COURSE_NOT_FOUND", message: "Course not found." }, 400);
}

/** The course of the URL is not a course, or is not even a UUID: 404, as the catalog answers it. */
export function courseNotFound(): HttpException {
  return new HttpException({ error: "COURSE_NOT_FOUND", message: "Course not found." }, 404);
}

/**
 * The course of the body is archived, and an archived course takes no new class (RF-020): 409. It
 * is an exception to the 400 that section 10.3 gives to an `<ENTITY>_ARCHIVED` whose id is in the
 * body, because the card of this rule asks for 409.
 */
export function courseArchived(): HttpException {
  return new HttpException(
    { error: "COURSE_ARCHIVED", message: "An archived course cannot receive new classes." },
    409,
  );
}

/** The course of a class changes only while it is planned and has no active enrollments: 409. */
export function courseChangeNotAllowed(): HttpException {
  return new HttpException(
    {
      error: "COURSE_CHANGE_NOT_ALLOWED",
      message:
        "The course of a class can only change while it is planned and has no active enrollments.",
    },
    409,
  );
}
