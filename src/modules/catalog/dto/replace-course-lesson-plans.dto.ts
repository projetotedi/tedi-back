import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsUUID } from "class-validator";
import { COURSE_MAX_LESSON_PLANS } from "./course-limits";
import { lowerCaseEach } from "./lower-case-each";

export class ReplaceCourseLessonPlansDto {
  @ApiProperty({
    type: "array",
    items: { type: "string", format: "uuid" },
    maxItems: COURSE_MAX_LESSON_PLANS,
    uniqueItems: true,
    example: ["01999a3e-7c1b-7000-8000-000000000001", "01999a3e-7c1b-7000-8000-000000000002"],
    description:
      "The whole sequence, in the order of the course. Replaces the current one; [] clears it. A repeated id answers 400 DUPLICATE_LESSON_PLAN.",
  })
  // No @ArrayUnique on purpose: it would answer VALIDATION_FAILED, and a repeated plan has its own
  // code, DUPLICATE_LESSON_PLAN, which CourseLessonPlansService answers (the front translates it).
  @Transform(lowerCaseEach)
  @IsUUID("all", { each: true })
  @ArrayMaxSize(COURSE_MAX_LESSON_PLANS)
  @IsArray()
  lessonPlanIds!: string[];
}
