import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { IsCalendarDate } from "@shared/dates/is-calendar-date.validator";
import { trim, trimToNull } from "@shared/dto/transforms";
import {
  HourEntryCategory,
  LOGGABLE_HOUR_ENTRY_CATEGORIES,
} from "../enums/hour-entry-category.enum";
import {
  HOUR_ENTRY_ACTIVITY_MAX_LENGTH,
  HOUR_ENTRY_MAX_MINUTES,
  HOUR_ENTRY_NOTES_MAX_LENGTH,
} from "./hour-entry-limits";

/**
 * The body of `POST /me/hour-entries` and `POST /members/:id/hour-entries`. Whose hours they are,
 * the status, the origin and who logged it come from the route and the session, never from the
 * body: the global pipe drops any other field.
 */
export class CreateHourEntryDto {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: HOUR_ENTRY_ACTIVITY_MAX_LENGTH,
    example: "Planejamento da aula de teclado e mouse",
    description: "What was done. Trimmed; blank is refused.",
  })
  @Transform(trim)
  @MaxLength(HOUR_ENTRY_ACTIVITY_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  activity!: string;

  @ApiProperty({
    enum: HourEntryCategory,
    enumName: "HourEntryCategory",
    example: HourEntryCategory.PLANNING,
    description:
      "Kind of work (F7.7). lesson is refused here (400 VALIDATION_FAILED): lesson hours only come from the confirmed attendance (RN-03).",
  })
  @IsIn(LOGGABLE_HOUR_ENTRY_CATEGORIES)
  category!: HourEntryCategory;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-10",
    description:
      "Day of the work, YYYY-MM-DD. Today or before, in America/Sao_Paulo (else 400 HOUR_ENTRY_DATE_IN_FUTURE).",
  })
  @IsCalendarDate()
  date!: string;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    maximum: HOUR_ENTRY_MAX_MINUTES,
    example: 150,
    description: "Minutes worked, a whole number: 2h30 is 150. From 1 to 1440 (one day).",
  })
  @Max(HOUR_ENTRY_MAX_MINUTES)
  @Min(1)
  @IsInt()
  declaredMinutes!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: HOUR_ENTRY_NOTES_MAX_LENGTH,
    example: "Revisei os exercícios do plano 3.",
    description: "Free notes of the person. Omitted, null or blank means none.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(HOUR_ENTRY_NOTES_MAX_LENGTH)
  @IsString()
  notes?: string | null;
}
