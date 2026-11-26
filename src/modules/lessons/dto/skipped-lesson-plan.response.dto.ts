import { ApiProperty } from "@nestjs/swagger";

/**
 * A lesson plan that is in the sequence of the course but originates no lesson, because it is
 * archived (RN-27): the coordination sees which plans were left out of the series, and why.
 */
export class SkippedLessonPlanResponseDto {
  @ApiProperty({
    type: "integer",
    minimum: 1,
    example: 2,
    description: "Position of the plan in the sequence of the course.",
  })
  sequenceOrder!: number;

  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000012" })
  lessonPlanId!: string;

  @ApiProperty({ type: String, example: "Teclado, mouse e janelas" })
  title!: string;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-03-20T12:00:00.000Z",
    description: "When the plan was archived.",
  })
  archivedAt!: Date;
}
