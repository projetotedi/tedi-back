import { ApiProperty, ApiSchema } from "@nestjs/swagger";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { RollCallEnrollmentResponseDto } from "./roll-call-enrollment.response.dto";
import { StudentAttendanceResponseDto } from "./student-attendance.response.dto";

/** One student of the roll call of a lesson: the item of `GET` and `PUT /lessons/:id/attendance/students`. */
@ApiSchema({
  description:
    "A student of the roll call of the lesson: an enrollment the class expects on the day of the lesson, or one already signed in it, with its status as of today, the student and the attendance.",
})
export class StudentRollCallItemResponseDto {
  @ApiProperty({ type: () => RollCallEnrollmentResponseDto })
  enrollment!: RollCallEnrollmentResponseDto;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description: "The student: id and name only. Null when the person was removed.",
  })
  student!: PersonRefDto | null;

  @ApiProperty({
    type: () => StudentAttendanceResponseDto,
    nullable: true,
    description: "The attendance of the student at the lesson. Null while it is not signed.",
  })
  attendance!: StudentAttendanceResponseDto | null;
}
