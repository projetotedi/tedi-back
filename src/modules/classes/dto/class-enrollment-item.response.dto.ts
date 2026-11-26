import { ApiProperty } from "@nestjs/swagger";
import { ENROLLMENT_STATUS_DESCRIPTION, EnrollmentStatus } from "../enums/enrollment-status.enum";
import { EnrollmentStudentResponseDto } from "./enrollment-student.response.dto";

/**
 * The description of the attendance rate of an enrollment (F6.3, GUS-166, S14), the same in the list
 * of a class and in the history of a student.
 */
export const ATTENDANCE_RATE_DESCRIPTION =
  "The attendance rate of the enrollment (F6.3): its presences over the roll calls recorded for it in lessons that were not cancelled, from 0 to 1 with two decimals. A justified absence counts as an absence. Null while no roll call of it is recorded, and without the attendance module.";

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
    minimum: 0,
    maximum: 1,
    example: 0.75,
    description: ATTENDANCE_RATE_DESCRIPTION,
  })
  attendanceRate!: number | null;
}
