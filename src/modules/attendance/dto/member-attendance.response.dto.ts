import { ApiProperty, ApiSchema } from "@nestjs/swagger";
import { AssignmentRole } from "@modules/assignments/services/confirmed-staff.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { MemberAttendanceStatus } from "../enums/member-attendance-status.enum";

/**
 * The description of MemberAttendanceStatus, the same on every property that names it: swagger keeps
 * the description of the first property that names an enum as the description of the enum itself.
 */
export const MEMBER_ATTENDANCE_STATUS_DESCRIPTION =
  "present or absent. A presence generates the lesson hours of the member (an hour entry of origin attendance); an absence generates nothing.";

/**
 * One confirmed assignment of a lesson with the attendance of its member: the item of
 * `GET /lessons/:id/attendance/members` and of the answer of its `PUT`.
 */
@ApiSchema({
  description:
    "A confirmed assignment of the lesson, the teacher first, with the attendance of its member. status, confirmedBy, confirmedAt and hourEntryId are null while the attendance is not signed.",
})
export class MemberAttendanceResponseDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01952ef7-0000-7000-8000-000000000006",
    description: "The confirmed assignment of the line: the id the PUT takes in assignmentId.",
  })
  assignmentId!: string;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description: "The member. Null when the person was removed.",
  })
  person!: PersonRefDto | null;

  // No description on purpose: it would change the schema AssignmentRole, owned by the assignments.
  @ApiProperty({
    enum: AssignmentRole,
    enumName: "AssignmentRole",
    example: AssignmentRole.MONITOR,
  })
  role!: AssignmentRole;

  @ApiProperty({
    enum: MemberAttendanceStatus,
    enumName: "MemberAttendanceStatus",
    nullable: true,
    example: MemberAttendanceStatus.PRESENT,
    description: MEMBER_ATTENDANCE_STATUS_DESCRIPTION,
  })
  status!: MemberAttendanceStatus | null;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description:
      "Who signed the attendance the last time (the first signature or a correction). Null while it is not signed, or when the person was removed.",
  })
  confirmedBy!: PersonRefDto | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: "2026-03-10T18:30:00.000Z",
    description: "When it was signed the last time. Null while it is not signed.",
  })
  confirmedAt!: Date | null;

  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    example: "01999a3e-7c1b-7000-8000-000000000a01",
    description:
      "The hour entry the presence generated; its history is GET /hour-entries/:id/history (a reversed one stays there). Null for an absence and while it is not signed.",
  })
  hourEntryId!: string | null;
}
