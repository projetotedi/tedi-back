import { ApiProperty, ApiSchema } from "@nestjs/swagger";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import {
  STUDENT_ATTENDANCE_STATUS_DESCRIPTION,
  StudentAttendanceStatus,
} from "../enums/student-attendance-status.enum";
import { AbsenceJustificationResponseDto } from "./absence-justification.response.dto";
import { AttendanceCorrectionResponseDto } from "./attendance-correction.response.dto";

/**
 * The attendance of a student at a lesson: the item of the roll call when it is signed, and the
 * answer of `justifyAbsence` and `correctStudentAttendance`.
 */
@ApiSchema({
  description:
    "The attendance of a student at a lesson: the status, who signed it first and when, whether the absence is justified, and the history of its corrections.",
})
export class StudentAttendanceResponseDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-000000000a11",
    description: "The id the PATCH routes take (justifyAbsence, correctStudentAttendance).",
  })
  id!: string;

  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000f1" })
  lessonId!: string;

  @ApiProperty({ type: String, format: "uuid", example: "01952ef7-0000-7000-8000-000000000010" })
  enrollmentId!: string;

  @ApiProperty({
    enum: StudentAttendanceStatus,
    enumName: "StudentAttendanceStatus",
    example: StudentAttendanceStatus.ABSENT,
    description: STUDENT_ATTENDANCE_STATUS_DESCRIPTION,
  })
  status!: StudentAttendanceStatus;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description:
      "Who signed the attendance the first time; a correction does not change it. Null when the person was removed.",
  })
  signedBy!: PersonRefDto | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-03-10T14:05:00.000Z",
    description: "When it was signed the first time.",
  })
  signedAt!: Date;

  @ApiProperty({
    type: Boolean,
    example: true,
    description:
      "Whether the absence is justified. Always told, also to whoever does not see the justification itself.",
  })
  justified!: boolean;

  @ApiProperty({
    type: () => AbsenceJustificationResponseDto,
    nullable: true,
    description:
      "Null when not justified, or when the caller does not take the roll call of the lesson (it may carry health data): read justified.",
  })
  justification!: AbsenceJustificationResponseDto | null;

  @ApiProperty({
    type: () => AttendanceCorrectionResponseDto,
    isArray: true,
    description: "The corrections of the attendance, the oldest first. Empty when it has none.",
  })
  corrections!: AttendanceCorrectionResponseDto[];
}
