import { ApiProperty } from "@nestjs/swagger";
import { CourseLessonPlanItemResponseDto } from "./course-lesson-plan-item.response.dto";

/** The sequence of lesson plans of a course and the workload it adds up to (RF-014, RF-018). */
export class CourseLessonPlansResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000002" })
  courseId!: string;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    example: 270,
    description:
      "Sum of expectedDurationMinutes of the sequence, never typed (RF-018, RN-24). 0 for an empty sequence.",
  })
  plannedWorkloadMinutes!: number;

  @ApiProperty({
    type: [CourseLessonPlanItemResponseDto],
    description: "The lesson plans of the course ordered by position. Empty when there are none.",
  })
  items!: CourseLessonPlanItemResponseDto[];
}
