import { ApiProperty } from "@nestjs/swagger";

/**
 * One lesson of the preview: the plan it would come from, the day it would land on and whether that
 * day is inside the class. It is what the lesson would be, not a lesson: nothing is written.
 */
export class ClassLessonPreviewItemResponseDto {
  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 1,
    description:
      "Position of the plan in the sequence of the course: the `sequenceOrder` its lesson would carry. It keeps the real position, so it can skip a number when an archived plan is left out (see skippedLessonPlans).",
  })
  sequenceOrder!: number;

  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000011" })
  lessonPlanId!: string;

  @ApiProperty({
    type: String,
    example: "Conhecendo o computador",
    description: "The title the lesson would copy from the plan (RN-18).",
  })
  title!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-04-07",
    description: "Day of the lesson, YYYY-MM-DD, one week after the lesson before it.",
  })
  date!: string;

  @ApiProperty({
    type: "integer",
    example: 90,
    description:
      "The duration the lesson plan expects, in minutes. The lesson itself gets the time of the body (startTime to endTime), which is the top-level durationMinutes.",
  })
  expectedDurationMinutes!: number;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      "True when `date` is before the first day or after the last day of the class (RN-21). The preview only marks it: generating with any such lesson answers 409 LESSONS_OUTSIDE_CLASS_PERIOD.",
  })
  outsideClassPeriod!: boolean;
}
