import { ApiProperty } from "@nestjs/swagger";
import { CourseCategory, CourseStatus } from "@modules/catalog/services/courses.service";

/**
 * The course a class offers, as the class shows it. It is read from the course on every answer and
 * never stored in the class (RN-14): changing the category of a course changes what its classes
 * show, the ones that already exist included.
 *
 * `enumName` is the same as in the catalog DTOs on purpose, so the contract has one schema for
 * `CourseCategory` and one for `CourseStatus`, and the front generates one type for each.
 */
export class ClassCourseResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000001" })
  id!: string;

  @ApiProperty({ type: String, example: "Informática Básica" })
  name!: string;

  @ApiProperty({
    enum: CourseCategory,
    enumName: "CourseCategory",
    example: CourseCategory.BASIC,
    description:
      "Always the current category of the course: a class has no category of its own (RN-14).",
  })
  category!: CourseCategory;

  @ApiProperty({
    enum: CourseStatus,
    enumName: "CourseStatus",
    example: CourseStatus.ACTIVE,
    description:
      "Status of the course now. An archived course keeps its classes, and takes no new class (RF-020).",
  })
  status!: CourseStatus;
}
