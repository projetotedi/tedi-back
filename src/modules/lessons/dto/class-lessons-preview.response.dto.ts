import { ApiProperty } from "@nestjs/swagger";
import { TIME_OF_DAY_PATTERN } from "@shared/dates/time-of-day";
import { Weekday } from "../enums/weekday.enum";
import { ClassLessonPreviewItemResponseDto } from "./class-lesson-preview-item.response.dto";
import { SkippedLessonPlanResponseDto } from "./skipped-lesson-plan.response.dto";

/**
 * What `POST /classes/:id/lessons/generate` would do with the same body, without doing it: one
 * lesson per active plan of the sequence of the course, in order, each with its day, and the ones
 * that fall outside the period of the class marked. Writes nothing and emits nothing.
 */
export class ClassLessonsPreviewResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000c1" })
  classId!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-03",
    description: "First day of the class: no lesson can be before it.",
  })
  classStartDate!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-04-24",
    description:
      "Last day of the class: no lesson can be after it. The warning of the lessons outside the period reads it.",
  })
  classEndDate!: string;

  @ApiProperty({ enum: Weekday, enumName: "Weekday", example: Weekday.TUESDAY })
  weekday!: Weekday;

  @ApiProperty({ type: String, pattern: TIME_OF_DAY_PATTERN.source, example: "09:00" })
  startTime!: string;

  @ApiProperty({ type: String, pattern: TIME_OF_DAY_PATTERN.source, example: "11:00" })
  endTime!: string;

  @ApiProperty({
    type: "integer",
    example: 120,
    description:
      "From startTime to endTime, in minutes: how long each lesson would be. Calculated, not typed.",
  })
  durationMinutes!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Laboratório 2 — Bloco B",
    description: "The place every lesson would have. Null when not informed.",
  })
  location!: string | null;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 4,
    description: "How many lessons would be created: the number of items.",
  })
  lessonCount!: number;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    example: 1,
    description:
      "How many items are outsideClassPeriod. Above 0, generating answers 409 LESSONS_OUTSIDE_CLASS_PERIOD: the class must be extended (or the series moved) first.",
  })
  outsideClassPeriodCount!: number;

  @ApiProperty({
    type: [ClassLessonPreviewItemResponseDto],
    description:
      "One per active lesson plan of the sequence of the course, in the order of the sequence: the first on the first weekday on or after firstDate and each next one a week later. Never empty (a course without an active plan answers 409 COURSE_WITHOUT_SEQUENCE).",
  })
  items!: ClassLessonPreviewItemResponseDto[];

  @ApiProperty({
    type: [SkippedLessonPlanResponseDto],
    description:
      "The archived plans of the sequence, which originate no lesson (RN-27). The days stay consecutive: a skipped plan leaves no gap. Empty when none is archived.",
  })
  skippedLessonPlans!: SkippedLessonPlanResponseDto[];
}
