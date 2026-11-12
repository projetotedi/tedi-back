import { ApiProperty } from "@nestjs/swagger";

/**
 * How many classes a course has, for the column "Turmas" of the list of courses, one answer for
 * every course asked.
 */
export class ClassesSummaryByCourseResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000001" })
  courseId!: string;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    example: 3,
    description:
      "Classes of the course that are not archived (RN-27). It is the total of GET /courses/{id}/classes without a filter. 0 when the course has none, or when the id is not a course.",
  })
  total!: number;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    example: 2,
    description:
      "Classes of the course that are not archived and are planned or in progress: the ones on offer, apart from the history (completed and cancelled). Never more than total.",
  })
  active!: number;
}
