import { ApiProperty } from "@nestjs/swagger";
import { LESSON_CALENDAR_COLOR_COUNT } from "./lesson-limits";

/**
 * The class (turma) of a row of the list or of the calendar of lessons: what the row and its chip
 * show. Not the `LessonClassRefDto` of the page of a lesson, which has the period and the archive
 * of the class; here it is the label and the color.
 */
export class LessonListClassRefDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000c1" })
  id!: string;

  @ApiProperty({ type: String, example: "INFO-A", description: "Unique inside its edition." })
  code!: string;

  @ApiProperty({
    type: String,
    example: "Informática Básica, turma A",
    description:
      "The label of the class on the row: its name, or its code when it has no name. Never null.",
  })
  name!: string;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    maximum: LESSON_CALENDAR_COLOR_COUNT - 1,
    example: 0,
    description: `Color slot of the class in the calendar, from 0 to ${LESSON_CALENDAR_COLOR_COUNT - 1}: the front uses calendar/event-(colorIndex + 1). It follows the order the classes were created in and does not change with the filter, the page or the period, nor when another class is archived. Classes created in sequence get different slots until the slots run out, and then they repeat.`,
  })
  colorIndex!: number;
}
