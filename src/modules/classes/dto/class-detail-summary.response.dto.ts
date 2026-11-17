import { ApiProperty } from "@nestjs/swagger";

/**
 * The progress of the class on its sheet (RF-035): how full it is today and, once the lessons and
 * the attendance feed it, how far it went.
 *
 * `lessonsDone`, `lessonsTotal` and `averageAttendance` are always in the answer, as `null`
 * for now. They are required and nullable on purpose (never `required: false`): the front reads
 * them as `number | null` and shows "no data yet" instead of guessing a zero.
 */
export class ClassDetailSummaryResponseDto {
  @ApiProperty({
    type: "integer",
    minimum: 0,
    example: 12,
    description: "Active enrollments.",
  })
  enrolledCount!: number;

  @ApiProperty({ type: "integer", example: 15, description: "Number of seats." })
  capacity!: number;

  @ApiProperty({
    type: "number",
    minimum: 0,
    example: 0.8,
    description:
      "enrolledCount / capacity, rounded to two decimals. Can pass 1 if the class is over capacity.",
  })
  occupancyRate!: number;

  @ApiProperty({
    type: "integer",
    nullable: true,
    example: null,
    description: "Null until the lessons module feeds the sheet of the class (RF-035).",
  })
  lessonsDone!: number | null;

  @ApiProperty({
    type: "integer",
    nullable: true,
    example: null,
    description: "Null until the lessons module feeds the sheet of the class (RF-035).",
  })
  lessonsTotal!: number | null;

  @ApiProperty({
    type: "number",
    nullable: true,
    minimum: 0,
    maximum: 1,
    example: null,
    description: "Fraction from 0 to 1. Null until the attendance module exists (E6).",
  })
  averageAttendance!: number | null;
}
