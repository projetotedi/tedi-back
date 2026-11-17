import { ApiProperty } from "@nestjs/swagger";
import { ENROLLMENT_STATUS_DESCRIPTION, EnrollmentStatus } from "../enums/enrollment-status.enum";
import { EnrollmentStudentResponseDto } from "./enrollment-student.response.dto";

/** One enrollment of the list of a class (GET /classes/:id/enrollments). Never the reason. */
export class ClassEnrollmentItemResponseDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-0000000000f1",
    description: "Id of the enrollment.",
  })
  id!: string;

  @ApiProperty({ type: () => EnrollmentStudentResponseDto })
  student!: EnrollmentStudentResponseDto;

  @ApiProperty({
    enum: EnrollmentStatus,
    enumName: "EnrollmentStatus",
    example: EnrollmentStatus.ACTIVE,
    description: ENROLLMENT_STATUS_DESCRIPTION,
  })
  status!: EnrollmentStatus;

  @ApiProperty({ type: String, format: "date-time", example: "2026-03-03T13:00:00.000Z" })
  enrolledAt!: Date;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-03",
    description: "From when the current status holds, YYYY-MM-DD in America/Sao_Paulo.",
  })
  statusChangedAt!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: "Always null until the student roll call (GUS-166).",
  })
  attendanceRate!: number | null;
}
