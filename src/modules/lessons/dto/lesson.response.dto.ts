import { ApiProperty } from "@nestjs/swagger";
import { TIME_OF_DAY_PATTERN } from "@shared/dates/time-of-day";
import { LessonStatus } from "../enums/lesson-status.enum";
import { LessonClassRefDto } from "./lesson-class-ref.response.dto";
import { LessonCourseRefDto } from "./lesson-course-ref.response.dto";
import { LessonEditionRefDto } from "./lesson-edition-ref.response.dto";
import { LessonPlanRefDto } from "./lesson-plan-ref.response.dto";

/**
 * A lesson, with the class, the course, the edition and the lesson plan it comes from. The one
 * answer of every route of the module: the five of them return it, so the client has a single type
 * (create, read, edit, cancel and reschedule).
 */
export class LessonResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000f1" })
  id!: string;

  @ApiProperty({ type: () => LessonClassRefDto })
  class!: LessonClassRefDto;

  @ApiProperty({ type: () => LessonCourseRefDto, description: "The course the class offers." })
  course!: LessonCourseRefDto;

  @ApiProperty({ type: () => LessonEditionRefDto, description: "The edition of the class." })
  edition!: LessonEditionRefDto;

  @ApiProperty({
    type: () => LessonPlanRefDto,
    nullable: true,
    description:
      "The lesson plan this lesson was created from. Null for a lesson created on its own. It never changes (RN-20).",
  })
  lessonPlan!: LessonPlanRefDto | null;

  @ApiProperty({
    type: "integer",
    nullable: true,
    example: 1,
    description:
      "Position the plan had in the sequence of the course when the lesson was created. Null for a lesson outside the sequence. A snapshot: a later reordering of the sequence does not change it.",
  })
  sequenceOrder!: number | null;

  @ApiProperty({
    type: String,
    example: "Teclado, mouse e janelas",
    description:
      "The lesson's own title: copied from the plan when it was created, editable afterwards (RN-18).",
  })
  title!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Familiarizar o aluno com o teclado, o mouse e o uso básico das janelas.",
    description:
      "The lesson's own objective: copied from the plan when it was created, editable afterwards (RN-18).",
  })
  objective!: string | null;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-10",
    description: "Day of the lesson, YYYY-MM-DD, inside the period of the class.",
  })
  date!: string;

  @ApiProperty({ type: String, pattern: TIME_OF_DAY_PATTERN.source, example: "14:00" })
  startTime!: string;

  @ApiProperty({ type: String, pattern: TIME_OF_DAY_PATTERN.source, example: "15:30" })
  endTime!: string;

  @ApiProperty({
    type: "integer",
    example: 90,
    description:
      "From startTime to endTime, in minutes. Calculated when read, not stored (RF-039).",
  })
  durationMinutes!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Laboratório 3, bloco B",
    description: "Null when not informed.",
  })
  location!: string | null;

  @ApiProperty({
    type: "integer",
    nullable: true,
    example: 15,
    description: "Students expected. Null when not informed.",
  })
  expectedStudents!: number | null;

  @ApiProperty({
    type: "integer",
    nullable: true,
    example: 2,
    description: "Monitors expected. Null when not informed.",
  })
  expectedMonitors!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Primeiro contato com o computador",
    description: "Free text about what the lesson covers. Null when not informed.",
  })
  subject!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "A turma terminou o exercício antes do previsto.",
    description: "Notes written after the lesson. Null when there are none.",
  })
  postNotes!: string | null;

  @ApiProperty({
    enum: LessonStatus,
    enumName: "LessonStatus",
    example: LessonStatus.PLANNED,
    description:
      "Status of the lesson (F4.5). A lesson that was rescheduled keeps its status. cancelled is final: the lesson stays, with its reason, and cannot be edited or rescheduled.",
  })
  status!: LessonStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: "Why the lesson was cancelled. Set exactly when the status is cancelled.",
  })
  cancelReason!: string | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description: "When the lesson was cancelled. Set exactly when the status is cancelled.",
  })
  cancelledAt!: Date | null;

  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    example: null,
    description: "Id of the person who cancelled the lesson.",
  })
  cancelledById!: string | null;

  @ApiProperty({
    type: String,
    format: "date",
    nullable: true,
    example: null,
    description:
      "The first day the lesson was scheduled for, set by its first reschedule and kept by the next ones. Null for a lesson that was never rescheduled.",
  })
  originalDate!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: "Why the lesson moved, in its last reschedule. Null when none was given.",
  })
  rescheduleReason!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: "Note about its last reschedule. Null when none was given.",
  })
  rescheduleNote!: string | null;

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-0000-7000-8000-0000000000aa",
    description: "Id of the person who created the lesson.",
  })
  createdById!: string;

  @ApiProperty({ type: String, format: "date-time", example: "2026-10-01T13:00:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time", example: "2026-10-01T13:00:00.000Z" })
  updatedAt!: Date;
}
