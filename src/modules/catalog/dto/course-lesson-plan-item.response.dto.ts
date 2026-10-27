import { ApiProperty } from "@nestjs/swagger";

/** A lesson plan seen from the sequence of a course (RF-014, RF-016). */
export class CourseLessonPlanItemResponseDto {
  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 1,
    description: "Place of the lesson plan in the sequence of this course, from 1.",
  })
  position!: number;

  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000001" })
  lessonPlanId!: string;

  @ApiProperty({ type: String, example: "Teclado, mouse e janelas" })
  title!: string;

  @ApiProperty({
    type: [String],
    example: ["Teclado e mouse", "Janelas do sistema"],
    description: "Contents in the order they are taught.",
  })
  contents!: string[];

  @ApiProperty({
    type: "integer",
    example: 90,
    description: "Expected duration in minutes. It counts toward the workload of the course.",
  })
  expectedDurationMinutes!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "https://drive.google.com/file/d/exemplo/view",
    description: "Link to the material. The system stores the link, not the file.",
  })
  materialUrl!: string | null;

  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 2,
    description: "How many courses use this lesson plan, this one and archived ones included.",
  })
  courseCount!: number;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description:
      "Not null: the lesson plan was archived after it entered the sequence. It stays, tagged 'Arquivado' (RN-27).",
  })
  archivedAt!: Date | null;
}
