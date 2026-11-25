import { ApiProperty } from "@nestjs/swagger";
import { EnrollmentWarningCode } from "../enums/enrollment-warning-code.enum";

/**
 * A prerequisite that an enrolled student did not complete (RF-032). A warning, not a refusal: the
 * student is in `enrolled` all the same.
 */
export class EnrollmentWarningResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000001" })
  studentId!: string;

  @ApiProperty({
    enum: EnrollmentWarningCode,
    enumName: "EnrollmentWarningCode",
    example: EnrollmentWarningCode.PREREQUISITE_NOT_COMPLETED,
  })
  code!: EnrollmentWarningCode;

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-000000000003",
    description: "The prerequisite course the student did not complete.",
  })
  courseId!: string;

  @ApiProperty({ type: String, example: "Informática Básica" })
  courseName!: string;
}
