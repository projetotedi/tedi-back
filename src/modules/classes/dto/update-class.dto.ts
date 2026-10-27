import { ApiPropertyOptional, ApiSchema, OmitType, PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { IsCalendarDate } from "@shared/dates/is-calendar-date.validator";
import { trim } from "@shared/dto/transforms";
import { ClassStatus } from "../enums/class-status.enum";
import {
  CLASS_CAPACITY_MAX,
  CLASS_CODE_MAX_LENGTH,
  EDITION_NAME_MAX_LENGTH,
  EDITION_NAME_PATTERN,
} from "./class-limits";
import { CreateClassDto } from "./create-class.dto";

/**
 * Edit of a class. Every field is optional: omitted keeps. `name` and `location` take null to
 * clear; every other field is never null.
 *
 * There is no `courseId` on purpose: a class is the offering of one course and never changes it
 * (RN-13), so a `courseId` in the body is ignored.
 */
@ApiSchema({
  description:
    "Every field is optional: omit to keep. courseId is not editable (RN-13): the course of a class never changes, and a courseId in the body is ignored.",
})
export class UpdateClassDto extends PartialType(
  OmitType(CreateClassDto, [
    "courseId",
    "code",
    "editionName",
    "startDate",
    "endDate",
    "capacity",
    "status",
  ] as const),
) {
  @ApiPropertyOptional({
    type: String,
    maxLength: CLASS_CODE_MAX_LENGTH,
    example: "INFO-A",
    description:
      "Omit to keep. Never null. Unique inside its edition, ignoring case, archived classes included.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @MaxLength(CLASS_CODE_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  code?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: EDITION_NAME_MAX_LENGTH,
    pattern: EDITION_NAME_PATTERN.source,
    example: "2026.2",
    description:
      'Omit to keep. Never null. Year and term, "<year>.<term>". Created on demand when it does not exist.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @MaxLength(EDITION_NAME_MAX_LENGTH)
  @Matches(EDITION_NAME_PATTERN, {
    message: "editionName must be a year and a term, like 2026.1",
  })
  @IsString()
  editionName?: string;

  @ApiPropertyOptional({
    type: String,
    format: "date",
    example: "2026-03-03",
    description: "Omit to keep. Never null. First day of the class, YYYY-MM-DD.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsCalendarDate()
  startDate?: string;

  @ApiPropertyOptional({
    type: String,
    format: "date",
    example: "2026-06-27",
    description:
      "Omit to keep. Never null. Last day of the class, YYYY-MM-DD. The period that results, with the dates sent and the ones kept, must end on or after it starts (RN-21), else 400 INVALID_PERIOD.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsCalendarDate()
  endDate?: string;

  @ApiPropertyOptional({
    type: "integer",
    minimum: 1,
    maximum: CLASS_CAPACITY_MAX,
    example: 15,
    description:
      "Omit to keep. Never null. Number of seats. It cannot go below the number of active enrollments (409 CAPACITY_BELOW_ENROLLED).",
  })
  @ValidateIf((_, value) => value !== undefined)
  @Max(CLASS_CAPACITY_MAX)
  @Min(1)
  @IsInt()
  capacity?: number;

  @ApiPropertyOptional({
    enum: ClassStatus,
    enumName: "ClassStatus",
    example: ClassStatus.IN_PROGRESS,
    description: "Omit to keep. Never null. No rule limits the moves between statuses yet.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(ClassStatus)
  status?: ClassStatus;
}
