import { ApiPropertyOptional, ApiSchema, OmitType, PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from "class-validator";
import { trim, trimToNull } from "@shared/dto/transforms";
import { EDITABLE_LESSON_STATUSES, LessonStatus } from "../enums/lesson-status.enum";
import { CreateLessonDto } from "./create-lesson.dto";
import { LESSON_POST_NOTES_MAX_LENGTH, LESSON_TITLE_MAX_LENGTH } from "./lesson-limits";

/**
 * Edit of a lesson. Every field is optional: omitted keeps. `objective`, `location`,
 * `expectedStudents`, `expectedMonitors`, `subject` and `postNotes` take null to clear; `title` and
 * `status` are never null.
 *
 * There is no `classId`, `lessonPlanId`, `sequenceOrder`, `date`, `startTime` or `endTime` on
 * purpose, and the whitelist drops them when sent. The class and the plan of a lesson never change
 * (RN-20). The day and the time only change through the reschedule, which records the original
 * date, so the edit cannot be used to move a lesson around it.
 */
@ApiSchema({
  description:
    "Every field is optional: omit to keep. classId, lessonPlanId and sequenceOrder are not editable (RN-20), and date, startTime and endTime only change through rescheduleLesson, which keeps originalDate: they are ignored when sent.",
})
export class UpdateLessonDto extends PartialType(
  OmitType(CreateLessonDto, [
    "classId",
    "lessonPlanId",
    "sequenceOrder",
    "title",
    "date",
    "startTime",
    "endTime",
  ] as const),
) {
  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: LESSON_TITLE_MAX_LENGTH,
    example: "Teclado, mouse e janelas",
    description:
      "Omit to keep. Never null. The title of the lesson is its own: it does not follow the lesson plan (RN-18).",
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @MaxLength(LESSON_TITLE_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: LESSON_POST_NOTES_MAX_LENGTH,
    example: "A turma terminou o exercício antes do previsto.",
    description:
      "Notes written after the lesson. Free text: do not record health information or diagnosis (RNF-13). Null or blank clears. Omit to keep.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(LESSON_POST_NOTES_MAX_LENGTH)
  @IsString()
  postNotes?: string | null;

  @ApiPropertyOptional({
    enum: LessonStatus,
    enumName: "LessonStatus",
    example: LessonStatus.CONFIRMED,
    // Also the description of the shared LessonStatus schema (the first property to use it names it).
    description:
      "Status of the lesson (F4.5). cancelled is rejected with 400 VALIDATION_FAILED: use cancelLesson, which records the reason. Omit to keep. Never null. No rule limits the moves between the other statuses yet.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(EDITABLE_LESSON_STATUSES)
  status?: LessonStatus;
}
