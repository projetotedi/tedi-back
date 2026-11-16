import { ApiProperty } from "@nestjs/swagger";
import { TIME_OF_DAY_PATTERN } from "@shared/dates/time-of-day";
import { LessonStatus } from "../enums/lesson-status.enum";
import { LessonListClassRefDto } from "./lesson-list-class-ref.response.dto";
import { LessonPersonRefDto } from "./lesson-person-ref.response.dto";

/**
 * A lesson on a row of the list or on the calendar: what both draw, and nothing more. The lesson
 * in full (objective, location, notes, cancellation, reschedule) is `LessonResponseDto`, from
 * `GET /lessons/:id`. The two routes answer this same item, so the client has one type.
 */
export class LessonListItemResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000f1" })
  id!: string;

  @ApiProperty({ type: () => LessonListClassRefDto })
  class!: LessonListClassRefDto;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-10",
    description: "Day of the lesson, YYYY-MM-DD.",
  })
  date!: string;

  @ApiProperty({ type: String, pattern: TIME_OF_DAY_PATTERN.source, example: "14:00" })
  startTime!: string;

  @ApiProperty({ type: String, pattern: TIME_OF_DAY_PATTERN.source, example: "15:30" })
  endTime!: string;

  @ApiProperty({
    type: String,
    example: "Teclado, mouse e janelas",
    description: "The lesson's own title (RN-18).",
  })
  title!: string;

  @ApiProperty({
    enum: LessonStatus,
    enumName: "LessonStatus",
    example: LessonStatus.PLANNED,
    description:
      "Status of the lesson (F4.5). A cancelled lesson is listed like the others: the calendar draws it with a style of its own.",
  })
  status!: LessonStatus;

  @ApiProperty({
    type: () => LessonPersonRefDto,
    nullable: true,
    example: null,
    description:
      "The teacher of the lesson. Always null until the allocation exists (E5, GUS-158): the front shows a dash.",
  })
  teacher!: LessonPersonRefDto | null;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      "True when the lesson has fewer monitors allocated than it expects (F4.4, RF-050). Always false until the allocation exists (GUS-158).",
  })
  belowExpectedMonitors!: boolean;
}
