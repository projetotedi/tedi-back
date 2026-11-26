import { ApiProperty } from "@nestjs/swagger";

/**
 * What a change of duration does to the workload of one course that uses the lesson plan
 * (RF-017, RN-24).
 */
export class LessonPlanUsageCourseResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000002" })
  courseId!: string;

  @ApiProperty({ type: String, example: "Informática Intermediária" })
  courseName!: string;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 2,
    description: "Place of the lesson plan in the sequence of this course, from 1.",
  })
  position!: number;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 4,
    description:
      "Number of lesson plans in the sequence of this course: the plan is the position-th of lessonPlanCount.",
  })
  lessonPlanCount!: number;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 360,
    description:
      "Workload of the course today: the sum of the durations of its sequence (plannedWorkloadMinutes of the sequence of the course).",
  })
  currentWorkloadMinutes!: number;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 390,
    description:
      "Workload of the course if this lesson plan had the new duration. Equals currentWorkloadMinutes when no new duration was sent.",
  })
  newWorkloadMinutes!: number;
}
