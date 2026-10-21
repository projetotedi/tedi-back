import { ApiProperty } from "@nestjs/swagger";

export class LessonPlanResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000001" })
  id!: string;

  @ApiProperty({ type: String, example: "Teclado, mouse e janelas" })
  title!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Familiarizar o aluno com o teclado, o mouse e o uso básico das janelas.",
  })
  objective!: string | null;

  @ApiProperty({ type: "integer", example: 90, description: "Expected duration in minutes." })
  expectedDurationMinutes!: number;

  @ApiProperty({
    type: [String],
    example: ["Teclado e mouse", "Janelas do sistema"],
    description: "Contents in the order they are taught.",
  })
  contents!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: "https://drive.google.com/file/d/exemplo/view",
    description: "Link to the material. The system stores the link, not the file.",
  })
  materialUrl!: string | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description: "Null while the lesson plan is active (RN-27).",
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
    description: "Id of the person who created the lesson plan.",
  })
  createdById!: string;

  @ApiProperty({ type: String, format: "date-time", example: "2026-10-01T13:00:00.000Z" })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-10-01T13:00:00.000Z",
    description: "The most recent change to the lesson plan or to its contents.",
  })
  updatedAt!: Date;
}
