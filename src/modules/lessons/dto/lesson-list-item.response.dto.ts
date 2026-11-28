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
    example: { id: "01999a3e-0000-7000-8000-0000000000aa", name: "Maria Silva Santos" },
    description:
      "The CONFIRMED teacher of the lesson (F5.2, RN-02): her id and her name. Null when the lesson has none, and the front shows a dash: a pending assignment is a candidate, not the teacher. A cancelled lesson has none either: cancelling a lesson cancels its assignments (GUS-179).",
  })
  teacher!: LessonPersonRefDto | null;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      "True when the lesson has fewer CONFIRMED monitors than it expects (F4.4, F5.4, RF-050): a pending monitor does not count. False for a cancelled lesson and when the lesson does not say how many monitors it expects (expectedMonitors null, so nothing is missing). The teacher is not part of it: a lesson without a teacher shows a dash in teacher. It is the same rule as belowExpectedMonitors of the lesson in full.",
  })
  belowExpectedMonitors!: boolean;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      'True when the roll call of the students is pending, the "Chamada pendente" of the row (GUS-166): the lesson is not cancelled, it has ended and some student has no attendance. The same rule as attendance.pending of the lesson in full. False without the attendance module.',
  })
  attendancePending!: boolean;
}
