import { ApiPropertyOptional, OmitType, PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { trim } from "@shared/dto/transforms";
import { CourseCategory } from "../enums/course-category.enum";
import {
  COURSE_DESCRIPTION_MAX_LENGTH,
  COURSE_MAX_PREREQUISITES,
  COURSE_NAME_MAX_LENGTH,
} from "./course-limits";
import { COURSE_PREREQUISITE_IDS_PROPERTY, CreateCourseDto } from "./create-course.dto";
import { lowerCaseEach } from "./lower-case-each";

export class UpdateCourseDto extends PartialType(
  OmitType(CreateCourseDto, ["name", "description", "category", "prerequisiteIds"] as const),
) {
  @ApiPropertyOptional({
    type: String,
    maxLength: COURSE_NAME_MAX_LENGTH,
    example: "Informática Básica",
    description:
      "Omit to keep. Never null. Unique among all courses, archived ones included, ignoring case.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @MaxLength(COURSE_NAME_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: COURSE_DESCRIPTION_MAX_LENGTH,
    example: "Fundamentos do uso do computador: teclado, mouse, arquivos e internet.",
    description: "Omit to keep. Never null.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @MaxLength(COURSE_DESCRIPTION_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  description?: string;

  @ApiPropertyOptional({
    enum: CourseCategory,
    enumName: "CourseCategory",
    example: CourseCategory.INTERMEDIATE,
    description:
      "Omit to keep. Never null. Changing the category does not change the classes already created (RN-18).",
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(CourseCategory)
  category?: CourseCategory;

  @ApiPropertyOptional({
    ...COURSE_PREREQUISITE_IDS_PROPERTY,
    description:
      "Replaces the whole list. Omit to keep, send [] to clear. Never null. A course cannot require itself or form a cycle.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(lowerCaseEach)
  @IsUUID("all", { each: true })
  @ArrayUnique()
  @ArrayMaxSize(COURSE_MAX_PREREQUISITES)
  @IsArray()
  prerequisiteIds?: string[];
}
