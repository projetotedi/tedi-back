import { ApiProperty } from "@nestjs/swagger";
import { LessonPlanListStatus } from "../enums/lesson-plan-list.enums";

/** A line of the list of lesson plans (GUS-95). */
export class LessonPlanListItemDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000010" })
  id!: string;

  @ApiProperty({ type: String, example: "Teclado, mouse e janelas" })
  title!: string;

  @ApiProperty({
    type: [String],
    example: ["Teclado e mouse", "Janelas do sistema"],
    description: "The contents of the plan, in their order.",
  })
  contents!: string[];

  @ApiProperty({ type: Number, example: 90 })
  expectedDurationMinutes!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "https://drive.google.com/file/d/exemplo/view",
  })
  materialUrl!: string | null;

  @ApiProperty({
    type: Number,
    minimum: 0,
    example: 2,
    description:
      "Courses whose sequence has the plan, archived courses included: the same count as the sequence and the detail of the plan.",
  })
  courseCount!: number;

  @ApiProperty({
    enum: LessonPlanListStatus,
    enumName: "LessonPlanListStatus",
    example: LessonPlanListStatus.IN_USE,
    description:
      "archived when the plan is archived; else in_use when courseCount > 0, unused when not.",
  })
  status!: LessonPlanListStatus;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    description: "Null while the plan is not archived (RN-27).",
  })
  archivedAt!: Date | null;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}
