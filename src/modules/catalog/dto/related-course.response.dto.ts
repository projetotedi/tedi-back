import { ApiProperty } from "@nestjs/swagger";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";

/**
 * A course linked to another one by a prerequisite (RF-021), seen from the page of the other
 * course. Archived ones are included, with their status (RN-27).
 */
export class RelatedCourseResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000001" })
  id!: string;

  @ApiProperty({ type: String, example: "Informática Básica" })
  name!: string;

  @ApiProperty({
    enum: CourseCategory,
    enumName: "CourseCategory",
    example: CourseCategory.BASIC,
    description: "Level of the content.",
  })
  category!: CourseCategory;

  @ApiProperty({
    enum: CourseStatus,
    enumName: "CourseStatus",
    example: CourseStatus.ACTIVE,
    description: "Derived from archivedAt: archived when it is set, active otherwise (RN-27).",
  })
  status!: CourseStatus;
}
