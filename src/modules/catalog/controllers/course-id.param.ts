import { ParseUUIDPipe } from "@nestjs/common";
import { courseNotFound } from "../services/courses.service";

/**
 * The `:id` of a course route. An id that is not a UUID answers 404 COURSE_NOT_FOUND, the same as
 * an id that does not exist, and not the 400 of the stock pipe. Shared by the controllers whose
 * routes live under `/courses/:id`.
 */
export const COURSE_ID = new ParseUUIDPipe({ exceptionFactory: () => courseNotFound() });

export const COURSE_ID_PARAM = { name: "id", format: "uuid", description: "Id of the course." };
