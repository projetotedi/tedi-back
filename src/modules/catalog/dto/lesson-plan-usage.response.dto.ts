import { ApiProperty } from "@nestjs/swagger";
import { LessonPlanUsageCourseResponseDto } from "./lesson-plan-usage-course.response.dto";

/**
 * Simulation of a change of duration (RF-017): the workload of each course that uses the lesson
 * plan, today and with the new duration. Nothing is saved: whoever confirms is PATCH
 * /lesson-plans/:id.
 */
export class LessonPlanUsageResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000001" })
  lessonPlanId!: string;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 90,
    description: "Expected duration of the lesson plan today, in minutes.",
  })
  currentDurationMinutes!: number;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 120,
    description:
      "Duration simulated, in minutes. Equals currentDurationMinutes when the query has no expectedDurationMinutes.",
  })
  newDurationMinutes!: number;

  @ApiProperty({
    type: [LessonPlanUsageCourseResponseDto],
    description:
      "Courses that have this lesson plan in their sequence, ordered by course name, archived courses included. Empty when the plan is unused.",
  })
  courses!: LessonPlanUsageCourseResponseDto[];
}
