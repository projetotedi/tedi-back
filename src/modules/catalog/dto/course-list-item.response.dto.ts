import { ApiProperty } from "@nestjs/swagger";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import { CourseReferenceResponseDto } from "./course-reference.response.dto";

/** A line of the list of courses (GUS-99). */
export class CourseListItemDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000002" })
  id!: string;

  @ApiProperty({ type: String, example: "Informática Intermediária" })
  name!: string;

  @ApiProperty({
    enum: CourseCategory,
    enumName: "CourseCategory",
    example: CourseCategory.INTERMEDIATE,
  })
  category!: CourseCategory;

  @ApiProperty({
    enum: CourseStatus,
    enumName: "CourseStatus",
    example: CourseStatus.ACTIVE,
  })
  status!: CourseStatus;

  @ApiProperty({
    type: Number,
    example: 12,
    description: "Lesson plans in the sequence of the course, archived ones included.",
  })
  lessonPlanCount!: number;

  @ApiProperty({
    type: Number,
    example: 1440,
    description: "Sum of the expected duration of the lesson plans of the sequence, in minutes.",
  })
  plannedWorkloadMinutes!: number;

  @ApiProperty({
    type: [CourseReferenceResponseDto],
    description:
      "Courses required before this one, archived ones included, ordered by name. Empty when there are none.",
  })
  prerequisites!: CourseReferenceResponseDto[];

  @ApiProperty({ type: String, format: "date-time", example: "2026-09-01T12:00:00.000Z" })
  createdAt!: Date;
}
