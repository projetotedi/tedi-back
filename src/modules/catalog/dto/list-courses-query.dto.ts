import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseListSort } from "../enums/course-list-sort.enum";
import { CourseStatus } from "../enums/course-status.enum";

/** Query parameters of GET /courses (GUS-99). */
export class ListCoursesQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined ? Number(value) : undefined))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined ? Number(value) : undefined))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    example: "informatica",
    maxLength: 100,
    description: "Search by name, ignoring case and accents.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: CourseCategory, enumName: "CourseCategory" })
  @IsOptional()
  @IsEnum(CourseCategory)
  category?: CourseCategory;

  @ApiPropertyOptional({
    enum: CourseStatus,
    enumName: "CourseStatus",
    description:
      "Omitted lists active and archived courses. The selectors of a new class and of prerequisites send active.",
  })
  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;

  @ApiPropertyOptional({
    example: true,
    description: "true lists only courses with a prerequisite; false, only courses without one.",
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsBoolean()
  hasPrerequisite?: boolean;

  @ApiPropertyOptional({
    enum: CourseListSort,
    enumName: "CourseListSort",
    default: CourseListSort.NAME,
    description: "name is alphabetical; createdAt puts the newest first.",
  })
  @IsOptional()
  @IsEnum(CourseListSort)
  sort?: CourseListSort;
}
