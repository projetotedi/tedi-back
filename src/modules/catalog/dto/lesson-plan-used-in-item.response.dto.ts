import { ApiProperty } from "@nestjs/swagger";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";

/** A course that has the lesson plan in its sequence, and where (RF-017). */
export class LessonPlanUsedInItemResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000002" })
  courseId!: string;

  @ApiProperty({ type: String, example: "Informática Intermediária" })
  courseName!: string;

  @ApiProperty({
    enum: CourseCategory,
    enumName: "CourseCategory",
    example: CourseCategory.INTERMEDIATE,
    description: "Level of the content of the course.",
  })
  category!: CourseCategory;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 2,
    description: "Place of the lesson plan in the sequence of this course, from 1.",
  })
  position!: number;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 4,
    description:
      "Number of lesson plans in the sequence of this course: the plan is the position-th of lessonPlanCount.",
  })
  lessonPlanCount!: number;

  @ApiProperty({
    enum: CourseStatus,
    enumName: "CourseStatus",
    example: CourseStatus.ACTIVE,
    description: "Derived from archivedAt of the course: archived when it is set (RN-27).",
  })
  courseStatus!: CourseStatus;
}
