import { ApiProperty } from "@nestjs/swagger";
import { ClassCourseResponseDto } from "./class-course.response.dto";

/**
 * The course of the class on its sheet (GUS-104): what every answer of a class shows
 * (`ClassCourseResponseDto`, with the category the course has now, RN-14) plus the size of its
 * plan. Both numbers come from the sequence of lesson plans of the course, so they are the same
 * ones `GET /courses/{id}` answers (RF-018, RN-24).
 *
 * The `extends` keeps one schema for `CourseCategory` and one for `CourseStatus` in the contract.
 */
export class ClassDetailCourseResponseDto extends ClassCourseResponseDto {
  @ApiProperty({
    type: "integer",
    minimum: 0,
    example: 6,
    description:
      "Lesson plans in the sequence of the course, archived plans that stayed in it included (same number as GET /courses/{id}).",
  })
  lessonPlanCount!: number;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    example: 540,
    description: "Sum of the expected durations of the sequence (RF-018, RN-24), never stored.",
  })
  plannedWorkloadMinutes!: number;
}
