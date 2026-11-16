import { ApiProperty } from "@nestjs/swagger";
import { ENROLLMENT_STATUS_DESCRIPTION, EnrollmentStatus } from "../enums/enrollment-status.enum";
import { ClassCourseResponseDto } from "./class-course.response.dto";
import { EnrollmentClassRefResponseDto } from "./enrollment-class-ref.response.dto";

/** One enrollment of the history of a student, with its class and the course of the class. */
export class StudentEnrollmentItemResponseDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-0000000000f1",
    description: "Id of the enrollment.",
  })
  id!: string;

  @ApiProperty({
    enum: EnrollmentStatus,
    enumName: "EnrollmentStatus",
    example: EnrollmentStatus.COMPLETED,
    description: ENROLLMENT_STATUS_DESCRIPTION,
  })
  status!: EnrollmentStatus;

  @ApiProperty({ type: String, format: "date-time", example: "2025-08-04T13:00:00.000Z" })
  enrolledAt!: Date;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2025-12-12",
    description: "From when the current status holds, YYYY-MM-DD in America/Sao_Paulo.",
  })
  statusChangedAt!: string;

  @ApiProperty({ type: () => EnrollmentClassRefResponseDto })
  class!: EnrollmentClassRefResponseDto;

  @ApiProperty({ type: () => ClassCourseResponseDto })
  course!: ClassCourseResponseDto;
}
