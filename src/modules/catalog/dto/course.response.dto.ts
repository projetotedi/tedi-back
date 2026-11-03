import { ApiProperty } from "@nestjs/swagger";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import { CourseReferenceResponseDto } from "./course-reference.response.dto";

export class CourseResponseDto {
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

  @ApiProperty({
    type: [CourseReferenceResponseDto],
    description: "Courses required before this one, ordered by name. Empty when there are none.",
  })
  prerequisites!: CourseReferenceResponseDto[];

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description: "Null while the course is active (RN-27).",
  })
  archivedAt!: Date | null;

  @ApiProperty({ type: String, format: "uuid", nullable: true, example: null })
  archivedById!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  archiveReason!: string | null;

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-0000-7000-8000-0000000000aa",
    description: "Id of the person who created the course.",
  })
  createdById!: string;

  @ApiProperty({ type: String, format: "date-time", example: "2026-10-01T13:00:00.000Z" })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-10-01T13:00:00.000Z",
    description: "The most recent change to the course or to its prerequisites.",
  })
  updatedAt!: Date;
}
