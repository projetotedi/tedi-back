import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";
import { CLASSES_SUMMARY_MAX_COURSES } from "./class-limits";

/**
 * The ids of `courseIds`, from the comma separated text or from the repeated parameter
 * (`courseIds=a&courseIds=b`), trimmed and in lower case, the empty ones dropped. Anything that is
 * not text is returned as it came, for the validators to reject.
 */
const toCourseIdList = ({ value }: { value: unknown }): unknown => {
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  if (!parts.every((part): part is string => typeof part === "string")) return value;

  return parts
    .flatMap((part) => part.split(","))
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0);
};

/**
 * Query parameters for GET /classes/summary-by-course.
 *
 * `courseIds` is documented as one comma separated text, not as an array: the client that Orval
 * generates writes an array as a repeated parameter, and one text is what the screen sends. The
 * server takes both. The same id twice is not an error: the answer has one item for it.
 */
export class ClassesSummaryByCourseQueryDto {
  @ApiProperty({
    type: String,
    example: "01999a3e-7c1b-7000-8000-000000000001,01999a3e-7c1b-7000-8000-000000000002",
    description: `Ids of the courses, comma separated: from 1 to ${CLASSES_SUMMARY_MAX_COURSES} ids (maxItems ${CLASSES_SUMMARY_MAX_COURSES}), else 400 VALIDATION_FAILED. A repeated id counts once, and spaces around an id are ignored.`,
  })
  @Transform(toCourseIdList)
  @IsUUID("all", { each: true })
  @ArrayMaxSize(CLASSES_SUMMARY_MAX_COURSES)
  @ArrayMinSize(1)
  @IsArray()
  courseIds!: string[];
}
