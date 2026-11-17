import { ApiProperty, ApiSchema } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { trim } from "@shared/dto/transforms";
import {
  STUDENT_ATTENDANCE_STATUS_DESCRIPTION,
  StudentAttendanceStatus,
} from "../enums/student-attendance-status.enum";
import { ATTENDANCE_CORRECTION_REASON_MAX_LENGTH } from "./attendance-limits";

/** The body of `PATCH /student-attendance/:id/correct`: the new status and why. */
@ApiSchema({
  description:
    "The correction of a signed attendance: the new status, which must differ from the current one, and the reason, required. It goes to the history of the attendance.",
})
export class CorrectStudentAttendanceDto {
  @ApiProperty({
    enum: StudentAttendanceStatus,
    enumName: "StudentAttendanceStatus",
    example: StudentAttendanceStatus.ABSENT,
    description: STUDENT_ATTENDANCE_STATUS_DESCRIPTION,
  })
  @IsEnum(StudentAttendanceStatus)
  status!: StudentAttendanceStatus;

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: ATTENDANCE_CORRECTION_REASON_MAX_LENGTH,
    example: "Marcado por engano: o aluno saiu antes do início da aula.",
    description:
      "Why the attendance is corrected. Required: missing, empty or blank after the trim is 400 VALIDATION_FAILED. It goes to the history of the attendance, never to an event (it may carry health data).",
  })
  @Transform(trim)
  @MaxLength(ATTENDANCE_CORRECTION_REASON_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
