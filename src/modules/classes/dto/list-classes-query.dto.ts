import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { CourseCategory } from "@modules/catalog/services/courses.service";
import { ClassListSort } from "../enums/class-list-sort.enum";
import { ClassStatus } from "../enums/class-status.enum";

const toNumber = ({ value }: { value: unknown }): unknown =>
  value !== undefined ? Number(value) : undefined;

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
};

/**
 * The values of `status`, from the comma separated text or from the repeated parameter
 * (`status=a&status=b`), trimmed, the empty ones dropped and each one once. Anything that is not
 * text is returned as it came, for the validators to reject.
 */
const toStatusList = ({ value }: { value: unknown }): unknown => {
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  if (!parts.every((part): part is string => typeof part === "string")) return value;

  return [
    ...new Set(
      parts
        .flatMap((part) => part.split(","))
        .map((status) => status.trim())
        .filter((status) => status.length > 0),
    ),
  ];
};

/** Query parameters of GET /classes (GUS-103). */
export class ListClassesQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    example: "info",
    maxLength: 100,
    description:
      "Search by the code or the name of the class, or by the name of its course, ignoring case and accents.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Only the classes of this edition." })
  @IsOptional()
  @IsUUID()
  editionId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Only the classes of this course." })
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({
    enum: CourseCategory,
    enumName: "CourseCategory",
    description: "Only the classes whose course has this category (RN-14).",
  })
  @IsOptional()
  @IsEnum(CourseCategory)
  category?: CourseCategory;

  @ApiPropertyOptional({
    type: String,
    example: "planned,in_progress",
    description:
      "One or more statuses, comma separated (planned, in_progress, completed, cancelled). Omitted lists every status.",
  })
  @IsOptional()
  @Transform(toStatusList)
  @IsArray()
  @ArrayMaxSize(Object.values(ClassStatus).length)
  @IsEnum(ClassStatus, { each: true })
  status?: ClassStatus[];

  @ApiPropertyOptional({
    example: false,
    description:
      "true lists only the archived classes. Omitted (or false) lists only the classes that are not archived (RN-27).",
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional({
    enum: ClassListSort,
    enumName: "ClassListSort",
    default: ClassListSort.START_DATE,
    description: "startDate puts the class that starts last first; code is alphabetical.",
  })
  @IsOptional()
  @IsEnum(ClassListSort)
  sort?: ClassListSort;
}
