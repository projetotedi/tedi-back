import { ApiProperty } from "@nestjs/swagger";
import { ENROLLMENT_STATUS_DESCRIPTION, EnrollmentStatus } from "../enums/enrollment-status.enum";
import { EnrollmentSkipReason } from "../enums/enrollment-skip-reason.enum";

/**
 * A student of the body that was not enrolled because she already has an enrollment in the class
 * (in any status). `enrollmentId` and `status` let the front offer the change of status instead (a
 * dropped student comes back through `PATCH /enrollments/:id`).
 */
export class EnrollmentSkippedResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000001" })
  studentId!: string;

  @ApiProperty({
    enum: EnrollmentSkipReason,
    enumName: "EnrollmentSkipReason",
    example: EnrollmentSkipReason.ALREADY_ENROLLED,
  })
  reason!: EnrollmentSkipReason;

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-0000000000f1",
    description: "The enrollment the student already has in the class.",
  })
  enrollmentId!: string;

  @ApiProperty({
    enum: EnrollmentStatus,
    enumName: "EnrollmentStatus",
    example: EnrollmentStatus.DROPPED,
    description: ENROLLMENT_STATUS_DESCRIPTION,
  })
  status!: EnrollmentStatus;
}
