import { ApiProperty } from "@nestjs/swagger";

/** The teacher side of the coverage of a lesson: a lesson has one teacher, and it is either confirmed or not. */
export class LessonTeacherCoverageDto {
  @ApiProperty({
    type: "integer",
    example: 1,
    description:
      "Teachers confirmed for the lesson: 0 or 1, since a lesson has at most one confirmed teacher. A pending assignment is not counted.",
  })
  confirmed!: number;

  @ApiProperty({
    type: "integer",
    example: 1,
    description: "Always 1: a lesson has one teacher.",
  })
  expected!: number;
}

/** The monitors side of the coverage of a lesson. */
export class LessonMonitorCoverageDto {
  @ApiProperty({
    type: "integer",
    example: 2,
    description: "Monitors confirmed for the lesson. A pending assignment is not counted.",
  })
  confirmed!: number;

  @ApiProperty({
    type: "integer",
    nullable: true,
    example: 2,
    description:
      "The expectedMonitors of the lesson. Null when it was not informed: nothing is expected then.",
  })
  expected!: number | null;
}

/**
 * Who is confirmed in a lesson against who is expected (F5.4). Only confirmed assignments count:
 * a pending one is not staff yet, and a cancelled or declined one never was or no longer is.
 */
export class LessonCoverageDto {
  @ApiProperty({ type: () => LessonTeacherCoverageDto })
  teacher!: LessonTeacherCoverageDto;

  @ApiProperty({ type: () => LessonMonitorCoverageDto })
  monitors!: LessonMonitorCoverageDto;
}
