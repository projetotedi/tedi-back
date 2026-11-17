import { ApiProperty } from "@nestjs/swagger";
import {
  ENROLLMENT_STATUS_DESCRIPTION,
  EnrollmentStatus,
} from "@modules/classes/services/enrollment-roster.service";

/** The enrollment of a student of the roll call, with its status as of today: nothing else of it. */
export class RollCallEnrollmentResponseDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01952ef7-0000-7000-8000-000000000010",
    description: "Id of the enrollment: the enrollmentId the PUT takes.",
  })
  id!: string;

  @ApiProperty({
    enum: EnrollmentStatus,
    enumName: "EnrollmentStatus",
    example: EnrollmentStatus.ACTIVE,
    description: ENROLLMENT_STATUS_DESCRIPTION,
  })
  status!: EnrollmentStatus;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-03",
    description: "From when the current status holds, YYYY-MM-DD in America/Sao_Paulo.",
  })
  statusChangedAt!: string;
}
