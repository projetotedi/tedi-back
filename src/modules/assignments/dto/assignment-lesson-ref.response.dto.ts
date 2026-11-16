import { ApiProperty } from "@nestjs/swagger";
import { TIME_OF_DAY_PATTERN } from "@shared/dates/time-of-day";
import { LessonStatus } from "@modules/lessons/services/lessons.service";

/**
 * The lesson of an assignment, as the list of a member shows it: what is needed to say which lesson
 * it is and when it is, and nothing about its class or course. Named after the assignment on
 * purpose: it is a reference of this module, and `LessonResponseDto` belongs to the lessons module.
 */
export class AssignmentLessonRefDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000f1" })
  id!: string;

  @ApiProperty({ type: String, example: "Teclado, mouse e janelas" })
  title!: string;

  @ApiProperty({ type: String, format: "date", example: "2026-03-10" })
  date!: string;

  @ApiProperty({ type: String, pattern: TIME_OF_DAY_PATTERN.source, example: "14:00" })
  startTime!: string;

  @ApiProperty({ type: String, pattern: TIME_OF_DAY_PATTERN.source, example: "15:30" })
  endTime!: string;

  @ApiProperty({
    enum: LessonStatus,
    enumName: "LessonStatus",
    example: LessonStatus.PLANNED,
    description: "Status of the lesson (F4.5): the same type as the lesson itself.",
  })
  status!: LessonStatus;
}
