import { ApiProperty } from "@nestjs/swagger";
import {
  MEMBER_ATTENDANCE_STATUS_DESCRIPTION,
  MemberAttendanceStatus,
} from "../enums/member-attendance-status.enum";
import { AttendanceLessonRefResponseDto } from "./attendance-lesson-ref.response.dto";

/** One signed attendance of a member: the lesson, present or absent, and when it was signed. */
export class MemberAttendanceHistoryItemResponseDto {
  @ApiProperty({ type: () => AttendanceLessonRefResponseDto })
  lesson!: AttendanceLessonRefResponseDto;

  @ApiProperty({
    enum: MemberAttendanceStatus,
    enumName: "MemberAttendanceStatus",
    example: MemberAttendanceStatus.ABSENT,
    description: MEMBER_ATTENDANCE_STATUS_DESCRIPTION,
  })
  status!: MemberAttendanceStatus;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-03-10T18:30:00.000Z",
    description: "When it was signed the last time (the first signature or a correction).",
  })
  confirmedAt!: Date;
}
