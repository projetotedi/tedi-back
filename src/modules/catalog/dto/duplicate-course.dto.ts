import { PickType } from "@nestjs/swagger";
import { CreateCourseDto } from "./create-course.dto";

/**
 * Body of POST /courses/:id/duplicate (GUS-117): only the name of the new course. The rest (description,
 * objective, category and the sequence of lesson plans) is copied from the source. The name keeps a single
 * rule, the one of CreateCourseDto: trimmed, 1 to 200 characters, unique ignoring case.
 */
export class DuplicateCourseDto extends PickType(CreateCourseDto, ["name"] as const) {}
