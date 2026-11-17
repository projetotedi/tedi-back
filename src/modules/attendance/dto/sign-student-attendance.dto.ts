import { ApiProperty, ApiSchema } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsUUID,
  ValidateNested,
} from "class-validator";
import {
  STUDENT_ATTENDANCE_STATUS_DESCRIPTION,
  StudentAttendanceStatus,
} from "../enums/student-attendance-status.enum";
import { STUDENT_ATTENDANCE_MAX_ENTRIES } from "./attendance-limits";

/** One entry of the batch: an enrollment of the roll call of the lesson and whether the student was there. */
export class StudentAttendanceEntryDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01952ef7-0000-7000-8000-000000000010",
    description:
      "An enrollment of the roll call of the lesson of the URL (enrollment.id of the list); any other is 400 ENROLLMENT_NOT_IN_ROLL_CALL.",
  })
  @IsUUID("all")
  enrollmentId!: string;

  @ApiProperty({
    enum: StudentAttendanceStatus,
    enumName: "StudentAttendanceStatus",
    example: StudentAttendanceStatus.PRESENT,
    description: STUDENT_ATTENDANCE_STATUS_DESCRIPTION,
  })
  @IsEnum(StudentAttendanceStatus)
  status!: StudentAttendanceStatus;
}

/** The body of `PUT /lessons/:id/attendance/students`: the attendance to sign, all or none. */
@ApiSchema({
  description:
    "The attendance of enrollments of the roll call of the lesson of the URL, from 1 to 100 entries, all or none, signed by the actor at one instant. The same status of an attendance already signed is a no-op; another status is 409 STUDENT_ATTENDANCE_ALREADY_SIGNED: a signed attendance changes through correctStudentAttendance, with a reason.",
})
export class SignStudentAttendanceDto {
  /**
   * No @ArrayUnique on purpose: it would answer VALIDATION_FAILED, and a repeated enrollment has its
   * own code, DUPLICATE_ENROLLMENT, which the service answers with the positions.
   */
  @ApiProperty({
    type: () => StudentAttendanceEntryDto,
    isArray: true,
    minItems: 1,
    maxItems: STUDENT_ATTENDANCE_MAX_ENTRIES,
    description:
      "From 1 to 100 entries. The same enrollment twice, in any letter case, is 400 DUPLICATE_ENROLLMENT.",
  })
  @ValidateNested({ each: true })
  @Type(() => StudentAttendanceEntryDto)
  @ArrayMaxSize(STUDENT_ATTENDANCE_MAX_ENTRIES)
  @ArrayMinSize(1)
  @IsArray()
  entries!: StudentAttendanceEntryDto[];
}
