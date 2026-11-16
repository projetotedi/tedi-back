import { ApiProperty } from "@nestjs/swagger";

/** How many students the roll call of a lesson has, and how many of them are signed (GUS-166). */
export class LessonStudentAttendanceCountDto {
  @ApiProperty({
    type: "integer",
    example: 12,
    description:
      "The students of the roll call of the lesson: the enrollments of the class the lesson expects on its day (enrolled on or before it, and active, or dropped or completed only after it), plus the ones with an attendance signed in the lesson whatever their status today. 0 without the attendance module.",
  })
  total!: number;

  @ApiProperty({
    type: "integer",
    example: 10,
    description:
      "The students with an attendance signed in the lesson, present or absent. Never above total. 0 without the attendance module.",
  })
  signed!: number;
}

/** The roll call of the students of a lesson, as every answer of the lessons shows it (GUS-166). */
export class LessonAttendanceDto {
  @ApiProperty({ type: () => LessonStudentAttendanceCountDto })
  students!: LessonStudentAttendanceCountDto;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      "True when the roll call is pending: the lesson is not cancelled, it has ended (its day is before today, or it is today and its endTime has come, in America/Sao_Paulo) and students.signed is below students.total. False for a lesson without students, and without the attendance module.",
  })
  pending!: boolean;
}
