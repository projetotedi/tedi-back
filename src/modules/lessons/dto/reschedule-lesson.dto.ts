import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { IsCalendarDate } from "@shared/dates/is-calendar-date.validator";
import { IsTimeOfDay } from "@shared/dates/is-time-of-day.validator";
import { TIME_OF_DAY_PATTERN } from "@shared/dates/time-of-day";
import { trimToNull } from "@shared/dto/transforms";
import {
  LESSON_LOCATION_MAX_LENGTH,
  LESSON_RESCHEDULE_NOTE_MAX_LENGTH,
  LESSON_RESCHEDULE_REASON_MAX_LENGTH,
} from "./lesson-limits";

/**
 * Body of `PATCH /lessons/:id/reschedule`: the new day and time of the same lesson. The day and
 * the two times are always sent, even if one of them stays: a reschedule states the whole new
 * schedule.
 */
export class RescheduleLessonDto {
  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-17",
    description:
      "New day of the lesson, YYYY-MM-DD. It must fall inside the period of the class, ends included (else 400 LESSON_OUTSIDE_CLASS_PERIOD). The day it had goes to originalDate, unless the lesson was already rescheduled: the first original date is kept.",
  })
  @IsCalendarDate()
  date!: string;

  @ApiProperty({
    type: String,
    pattern: TIME_OF_DAY_PATTERN.source,
    example: "14:00",
    description: "New start of the lesson, HH:mm in 24 hours.",
  })
  @IsTimeOfDay()
  startTime!: string;

  @ApiProperty({
    type: String,
    pattern: TIME_OF_DAY_PATTERN.source,
    example: "15:30",
    description:
      "New end of the lesson, HH:mm in 24 hours. It must be after startTime (else 400 INVALID_TIME_RANGE).",
  })
  @IsTimeOfDay()
  endTime!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: LESSON_LOCATION_MAX_LENGTH,
    example: "Laboratório 2, bloco A",
    description:
      "New place of the lesson. Omit to keep the place it has. Null or blank clears it, since a rescheduled lesson can lose its room.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(LESSON_LOCATION_MAX_LENGTH)
  @IsString()
  location?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: LESSON_RESCHEDULE_REASON_MAX_LENGTH,
    example: "Laboratório em manutenção.",
    description:
      "Why the lesson moved. Optional. It describes this reschedule: omitted or null, it leaves the reason of the previous one empty. Free text: do not record health information or diagnosis (RNF-13).",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(LESSON_RESCHEDULE_REASON_MAX_LENGTH)
  @IsString()
  reason?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: LESSON_RESCHEDULE_NOTE_MAX_LENGTH,
    example: "Avisar a turma pelo grupo.",
    description:
      "A note about this reschedule. Optional; omitted or null, it leaves the note of the previous one empty. Free text: do not record health information or diagnosis (RNF-13).",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(LESSON_RESCHEDULE_NOTE_MAX_LENGTH)
  @IsString()
  note?: string | null;
}
