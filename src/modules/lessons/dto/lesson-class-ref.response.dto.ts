import { ApiProperty } from "@nestjs/swagger";

/**
 * The class (turma) of a lesson, as the page of a lesson shows it. Named after the lesson on purpose:
 * it is a reference of this module, and `ClassResponseDto` belongs to the classes module.
 */
export class LessonClassRefDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000c1" })
  id!: string;

  @ApiProperty({ type: String, example: "INFO-A", description: "Unique inside its edition." })
  code!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Informática Básica, turma A",
    description: "Optional label. Null when not informed.",
  })
  name!: string | null;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-03",
    description: "First day of the class: the earliest day a lesson of it can have.",
  })
  startDate!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-06-27",
    description: "Last day of the class: the latest day a lesson of it can have.",
  })
  endDate!: string;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description:
      "Null while the class is active. An archived class is read-only: its lessons cannot be created, edited, cancelled or rescheduled (RN-27).",
  })
  archivedAt!: Date | null;
}
