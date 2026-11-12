import { ApiProperty } from "@nestjs/swagger";

/**
 * The lesson plan a lesson was created from. It is where the lesson came from, not what it is: the
 * title and the objective of the lesson are its own copy (RN-18), so this reference can show a
 * title that is no longer the one of the lesson.
 */
export class LessonPlanRefDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000011" })
  id!: string;

  @ApiProperty({
    type: String,
    example: "Teclado, mouse e janelas",
    description: "The title the plan has now, which may differ from the one the lesson copied.",
  })
  title!: string;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description:
      "Null while the plan is active. An archived plan still shows on the lessons that already came from it (RN-27), but cannot originate a new lesson.",
  })
  archivedAt!: Date | null;
}
