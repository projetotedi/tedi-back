import { ApiProperty } from "@nestjs/swagger";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import { CourseLessonPlanItemResponseDto } from "./course-lesson-plan-item.response.dto";
import { PersonReferenceResponseDto } from "./person-reference.response.dto";
import { RelatedCourseResponseDto } from "./related-course.response.dto";

/**
 * Page of a course (GUS-100): the data, the prerequisites, the courses that require it, the
 * sequence of lesson plans in order and the workload it adds up to, all in one call. An archived
 * course is read the same way, with status archived (RN-27). The classes of the course are not
 * here: they come from GET /courses/:id/classes (GUS-102).
 */
export class CourseDetailDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000002" })
  id!: string;

  @ApiProperty({ type: String, example: "Informática Intermediária" })
  name!: string;

  @ApiProperty({
    type: String,
    example: "Planilhas, textos e apresentações para o dia a dia.",
  })
  description!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Preparar o aluno para as ferramentas de escritório.",
  })
  objective!: string | null;

  @ApiProperty({
    enum: CourseCategory,
    enumName: "CourseCategory",
    example: CourseCategory.INTERMEDIATE,
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

  @ApiProperty({ type: String, format: "date-time", example: "2026-10-01T13:00:00.000Z" })
  createdAt!: Date;

  @ApiProperty({
    type: () => PersonReferenceResponseDto,
    nullable: true,
    description: "Null when the person who created the course was removed.",
  })
  createdBy!: PersonReferenceResponseDto | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-10-01T13:00:00.000Z",
    description:
      "The most recent change to the course, to its prerequisites or to its lesson plan sequence.",
  })
  updatedAt!: Date;

  @ApiProperty({
    type: [RelatedCourseResponseDto],
    description:
      "Courses required before this one, archived ones included, ordered by name. Empty when there are none.",
  })
  prerequisites!: RelatedCourseResponseDto[];

  @ApiProperty({
    type: [RelatedCourseResponseDto],
    description:
      "Courses that require this one, archived ones included, ordered by name. Empty when no course requires it.",
  })
  requiredBy!: RelatedCourseResponseDto[];

  @ApiProperty({
    type: [CourseLessonPlanItemResponseDto],
    description: "The lesson plans of the course ordered by position. Empty when there are none.",
  })
  lessonPlans!: CourseLessonPlanItemResponseDto[];

  @ApiProperty({
    type: "integer",
    minimum: 0,
    example: 270,
    description:
      "Sum of expectedDurationMinutes of the lesson plans, never typed (RF-018, RN-24). 0 when there are none.",
  })
  plannedWorkloadMinutes!: number;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    example: 3,
    description: "How many lesson plans the course has. 0 when there are none.",
  })
  lessonPlanCount!: number;
}
