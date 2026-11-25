import { ApiProperty } from "@nestjs/swagger";
import { TIME_OF_DAY_PATTERN } from "@shared/dates/time-of-day";

/**
 * The lesson of an item of the history of a member: what is needed to say which lesson it is and
 * when it was. Named after the attendance on purpose: it is a reference of this module, and
 * `LessonResponseDto` belongs to the lessons module.
 */
export class AttendanceLessonRefResponseDto {
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
}
