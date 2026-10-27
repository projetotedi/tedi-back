import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { IsCalendarDate } from "@shared/dates/is-calendar-date.validator";
import { trim, trimToNull } from "@shared/dto/transforms";
import { ClassStatus } from "../enums/class-status.enum";
import {
  CLASS_CAPACITY_MAX,
  CLASS_CODE_MAX_LENGTH,
  CLASS_LOCATION_MAX_LENGTH,
  CLASS_NAME_MAX_LENGTH,
  EDITION_NAME_MAX_LENGTH,
  EDITION_NAME_PATTERN,
} from "./class-limits";

/** The id of a course is compared and stored in lower case, so the answer repeats it that way. */
const lowerCase = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.toLowerCase() : value;

export class CreateClassDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-000000000001",
    description:
      "Id of the course this class offers. It cannot be changed after the class is created (RN-13).",
  })
  @Transform(lowerCase)
  @IsUUID("all")
  courseId!: string;

  @ApiProperty({
    type: String,
    maxLength: CLASS_CODE_MAX_LENGTH,
    example: "INFO-A",
    description: "Unique inside its edition, ignoring case, archived classes included.",
  })
  @Transform(trim)
  @MaxLength(CLASS_CODE_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({
    type: String,
    maxLength: EDITION_NAME_MAX_LENGTH,
    pattern: EDITION_NAME_PATTERN.source,
    example: "2026.2",
    description: 'Year and term, "<year>.<term>". Created on demand when it does not exist.',
  })
  @Transform(trim)
  @MaxLength(EDITION_NAME_MAX_LENGTH)
  @Matches(EDITION_NAME_PATTERN, {
    message: "editionName must be a year and a term, like 2026.1",
  })
  @IsString()
  editionName!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-03",
    description: "First day of the class, YYYY-MM-DD.",
  })
  @IsCalendarDate()
  startDate!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-06-27",
    description:
      "Last day of the class, YYYY-MM-DD. On or after startDate (RN-21), else 400 INVALID_PERIOD.",
  })
  @IsCalendarDate()
  endDate!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: CLASS_LOCATION_MAX_LENGTH,
    example: "Laboratório 3, bloco B",
    description: "Null or empty means not informed. On edit, omit to keep and send null to clear.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(CLASS_LOCATION_MAX_LENGTH)
  @IsString()
  location?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: CLASS_NAME_MAX_LENGTH,
    example: "Informática Básica, turma A",
    description:
      "Optional label. Null or empty means not informed. On edit, omit to keep and send null to clear.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(CLASS_NAME_MAX_LENGTH)
  @IsString()
  name?: string | null;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    maximum: CLASS_CAPACITY_MAX,
    example: 15,
    description: "Number of seats.",
  })
  @Max(CLASS_CAPACITY_MAX)
  @Min(1)
  @IsInt()
  capacity!: number;

  @ApiPropertyOptional({
    enum: ClassStatus,
    enumName: "ClassStatus",
    default: ClassStatus.PLANNED,
    example: ClassStatus.PLANNED,
    // Also the description of the shared ClassStatus schema (the first property to use it names it).
    description: "Status of the class (RF-034). Omit for planned.",
  })
  @IsOptional()
  @IsEnum(ClassStatus)
  status?: ClassStatus;
}
