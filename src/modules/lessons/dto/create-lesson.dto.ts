import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { IsCalendarDate } from "@shared/dates/is-calendar-date.validator";
import { IsTimeOfDay } from "@shared/dates/is-time-of-day.validator";
import { TIME_OF_DAY_PATTERN } from "@shared/dates/time-of-day";
import { trim, trimToNull } from "@shared/dto/transforms";
import {
  LESSON_EXPECTED_MONITORS_MAX,
  LESSON_EXPECTED_STUDENTS_MAX,
  LESSON_LOCATION_MAX_LENGTH,
  LESSON_OBJECTIVE_MAX_LENGTH,
  LESSON_SEQUENCE_ORDER_MAX,
  LESSON_SUBJECT_MAX_LENGTH,
  LESSON_TITLE_MAX_LENGTH,
} from "./lesson-limits";

/** The id of a class or a lesson plan is compared and stored in lower case, so the answer repeats it that way. */
const lowerCase = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.toLowerCase() : value;

/**
 * `sequenceOrder` is the position that a lesson plan has in the sequence of a course, so it only
 * means something next to a `lessonPlanId`: without the plan, a position is a body that contradicts
 * itself, and it is answered as VALIDATION_FAILED on `sequenceOrder`.
 */
@ValidatorConstraint({ name: "sequenceOrderNeedsLessonPlan", async: false })
class SequenceOrderNeedsLessonPlan implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    return (args.object as { lessonPlanId?: unknown }).lessonPlanId != null;
  }

  defaultMessage(): string {
    return "sequenceOrder needs a lessonPlanId";
  }
}

export class CreateLessonDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-0000000000c1",
    description:
      "Id of the class this lesson belongs to. It cannot be changed after the lesson is created (RN-20).",
  })
  @Transform(lowerCase)
  @IsUUID("all")
  classId!: string;

  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    nullable: true,
    example: "01999a3e-7c1b-7000-8000-000000000001",
    description:
      "Id of the lesson plan this lesson comes from. Omit (or send null) for a lesson on its own. The plan must be active (archived: 400 LESSON_PLAN_ARCHIVED). It cannot be changed after the lesson is created (RN-20).",
  })
  @IsOptional()
  @Transform(lowerCase)
  @IsUUID("all")
  lessonPlanId?: string | null;

  @ApiPropertyOptional({
    type: "integer",
    nullable: true,
    minimum: 1,
    maximum: LESSON_SEQUENCE_ORDER_MAX,
    example: 1,
    description:
      "Position of the lesson plan in the sequence of the course of the class, when the lesson comes from that sequence. Needs a lessonPlanId, and the plan must be in the sequence at exactly this position (else 400 LESSON_PLAN_NOT_IN_COURSE_SEQUENCE). Omit for an extra lesson. It cannot be changed after the lesson is created (RN-20).",
  })
  @ValidateIf((lesson: CreateLessonDto) => lesson.sequenceOrder != null)
  @Validate(SequenceOrderNeedsLessonPlan)
  @Max(LESSON_SEQUENCE_ORDER_MAX)
  @Min(1)
  @IsInt()
  sequenceOrder?: number | null;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: LESSON_TITLE_MAX_LENGTH,
    example: "Teclado, mouse e janelas",
    description:
      "Required when there is no lessonPlanId. With a lessonPlanId, omit it to copy the title of the plan (RN-18): the copy is the lesson's own and editing the plan later does not change it. A title sent wins over the copy. Never null.",
  })
  @ValidateIf(
    (lesson: CreateLessonDto) => lesson.lessonPlanId == null || lesson.title !== undefined,
  )
  @Transform(trim)
  @MaxLength(LESSON_TITLE_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: LESSON_OBJECTIVE_MAX_LENGTH,
    example: "Familiarizar o aluno com o teclado, o mouse e o uso básico das janelas.",
    description:
      "With a lessonPlanId, omit it to copy the objective of the plan (RN-18); send null to leave it empty instead. Without a plan, omit or send null for none. Blank means null. On edit, omit to keep and send null to clear.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(LESSON_OBJECTIVE_MAX_LENGTH)
  @IsString()
  objective?: string | null;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-10",
    description:
      "Day of the lesson, YYYY-MM-DD. It must fall inside the period of the class, ends included (else 400 LESSON_OUTSIDE_CLASS_PERIOD).",
  })
  @IsCalendarDate()
  date!: string;

  @ApiProperty({
    type: String,
    pattern: TIME_OF_DAY_PATTERN.source,
    example: "14:00",
    description: "Start of the lesson, HH:mm in 24 hours.",
  })
  @IsTimeOfDay()
  startTime!: string;

  @ApiProperty({
    type: String,
    pattern: TIME_OF_DAY_PATTERN.source,
    example: "15:30",
    description:
      "End of the lesson, HH:mm in 24 hours. It must be after startTime (else 400 INVALID_TIME_RANGE): a lesson does not cross midnight.",
  })
  @IsTimeOfDay()
  endTime!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: LESSON_LOCATION_MAX_LENGTH,
    example: "Laboratório 3, bloco B",
    description: "Null or blank means not informed. On edit, omit to keep and send null to clear.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(LESSON_LOCATION_MAX_LENGTH)
  @IsString()
  location?: string | null;

  @ApiPropertyOptional({
    type: "integer",
    nullable: true,
    minimum: 0,
    maximum: LESSON_EXPECTED_STUDENTS_MAX,
    example: 15,
    description:
      "Students expected. Null means not informed: it is not copied from the class. On edit, omit to keep and send null to clear.",
  })
  @IsOptional()
  @Max(LESSON_EXPECTED_STUDENTS_MAX)
  @Min(0)
  @IsInt()
  expectedStudents?: number | null;

  @ApiPropertyOptional({
    type: "integer",
    nullable: true,
    minimum: 0,
    maximum: LESSON_EXPECTED_MONITORS_MAX,
    example: 2,
    description:
      "Monitors expected. Null means not informed. On edit, omit to keep and send null to clear.",
  })
  @IsOptional()
  @Max(LESSON_EXPECTED_MONITORS_MAX)
  @Min(0)
  @IsInt()
  expectedMonitors?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: LESSON_SUBJECT_MAX_LENGTH,
    example: "Primeiro contato com o computador",
    description:
      "Free text about what the lesson covers, apart from the title. Null or blank means not informed. On edit, omit to keep and send null to clear.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(LESSON_SUBJECT_MAX_LENGTH)
  @IsString()
  subject?: string | null;
}
