import { ApiProperty, ApiPropertyOptional, ApiPropertyOptions } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { trim, trimToNull } from "@shared/dto/transforms";
import { CourseCategory } from "../enums/course-category.enum";
import {
  COURSE_DESCRIPTION_MAX_LENGTH,
  COURSE_MAX_PREREQUISITES,
  COURSE_NAME_MAX_LENGTH,
  COURSE_OBJECTIVE_MAX_LENGTH,
} from "./course-limits";
import { lowerCaseEach } from "./lower-case-each";

export const COURSE_PREREQUISITE_IDS_PROPERTY: ApiPropertyOptions = {
  type: "array",
  items: { type: "string", format: "uuid" },
  maxItems: COURSE_MAX_PREREQUISITES,
  uniqueItems: true,
  example: ["01999a3e-7c1b-7000-8000-000000000001"],
  description:
    "Ids of the courses a student must have taken before this one (RF-021). Omit for none.",
};

export class CreateCourseDto {
  @ApiProperty({
    type: String,
    maxLength: COURSE_NAME_MAX_LENGTH,
    example: "Informática Básica",
    description: "Unique among all courses, archived ones included, ignoring case.",
  })
  @Transform(trim)
  @MaxLength(COURSE_NAME_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    type: String,
    maxLength: COURSE_DESCRIPTION_MAX_LENGTH,
    example: "Fundamentos do uso do computador: teclado, mouse, arquivos e internet.",
  })
  @Transform(trim)
  @MaxLength(COURSE_DESCRIPTION_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: COURSE_OBJECTIVE_MAX_LENGTH,
    example: "Deixar o aluno à vontade para usar o computador no dia a dia.",
    description: "Null or empty means not informed.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(COURSE_OBJECTIVE_MAX_LENGTH)
  @IsString()
  objective?: string | null;

  @ApiProperty({
    enum: CourseCategory,
    enumName: "CourseCategory",
    example: CourseCategory.BASIC,
    description: "Level of the content. A class takes the category of its course when created.",
  })
  @IsEnum(CourseCategory)
  category!: CourseCategory;

  @ApiPropertyOptional(COURSE_PREREQUISITE_IDS_PROPERTY)
  @ValidateIf((_, value) => value !== undefined)
  @Transform(lowerCaseEach)
  @IsUUID("all", { each: true })
  @ArrayUnique()
  @ArrayMaxSize(COURSE_MAX_PREREQUISITES)
  @IsArray()
  prerequisiteIds?: string[];
}
