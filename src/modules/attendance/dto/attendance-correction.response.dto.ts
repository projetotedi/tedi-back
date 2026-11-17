import { ApiProperty } from "@nestjs/swagger";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import {
  STUDENT_ATTENDANCE_STATUS_DESCRIPTION,
  StudentAttendanceStatus,
} from "../enums/student-attendance-status.enum";

/** One correction of the attendance of a student: from which status to which, why, who and when. */
export class AttendanceCorrectionResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000c01" })
  id!: string;

  @ApiProperty({
    enum: StudentAttendanceStatus,
    enumName: "StudentAttendanceStatus",
    example: StudentAttendanceStatus.PRESENT,
    description: STUDENT_ATTENDANCE_STATUS_DESCRIPTION,
  })
  fromStatus!: StudentAttendanceStatus;

  @ApiProperty({
    enum: StudentAttendanceStatus,
    enumName: "StudentAttendanceStatus",
    example: StudentAttendanceStatus.ABSENT,
    description: STUDENT_ATTENDANCE_STATUS_DESCRIPTION,
  })
  toStatus!: StudentAttendanceStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Marcado por engano: o aluno saiu antes do início da aula.",
    description:
      "Why it was corrected. Null when the caller does not take the roll call of the lesson: it may carry health data.",
  })
  reason!: string | null;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description: "Who corrected it. Null when the person was removed.",
  })
  correctedBy!: PersonRefDto | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-03-10T15:05:00.000Z",
    description: "When it was corrected.",
  })
  correctedAt!: Date;
}
