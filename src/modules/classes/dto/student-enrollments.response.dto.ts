import { ApiProperty } from "@nestjs/swagger";
import { StudentEnrollmentItemResponseDto } from "./student-enrollment-item.response.dto";

/** A course the student completed (RN-16): derived from her completed enrollments. */
export class CompletedCourseResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000b1" })
  courseId!: string;

  @ApiProperty({ type: String, example: "Informática Básica" })
  name!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2025-12-12",
    description:
      "The latest statusChangedAt of the completed enrollments of the course, YYYY-MM-DD.",
  })
  completedAt!: string;
}

/** What the history of a student adds up to. */
export class StudentEnrollmentsSummaryResponseDto {
  @ApiProperty({ type: "integer", example: 1, description: "Active enrollments." })
  activeClasses!: number;

  @ApiProperty({
    type: () => CompletedCourseResponseDto,
    isArray: true,
    description: "One item per course with a completed enrollment, by completedAt and then name.",
  })
  completedCourses!: CompletedCourseResponseDto[];

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: "2025-08-04T13:00:00.000Z",
    description: "The earliest enrolledAt; null without enrollments.",
  })
  firstEnrollmentAt!: Date | null;
}

/** The enrollment history of a student (GET /students/:id/enrollments). Never the reason. */
export class StudentEnrollmentsResponseDto {
  @ApiProperty({
    type: () => StudentEnrollmentItemResponseDto,
    isArray: true,
    description: "Every enrollment that is not removed, the newest first; archived classes too.",
  })
  enrollments!: StudentEnrollmentItemResponseDto[];

  @ApiProperty({ type: () => StudentEnrollmentsSummaryResponseDto })
  summary!: StudentEnrollmentsSummaryResponseDto;
}
