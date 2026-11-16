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
import { MemberAttendanceStatus } from "../enums/member-attendance-status.enum";
import { MEMBER_ATTENDANCE_MAX_ENTRIES } from "./attendance-limits";
import { MEMBER_ATTENDANCE_STATUS_DESCRIPTION } from "./member-attendance.response.dto";

/** One entry of the batch: a confirmed assignment of the lesson and whether its member was there. */
export class MemberAttendanceEntryDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01952ef7-0000-7000-8000-000000000006",
    description:
      "A CONFIRMED assignment of the lesson of the URL; any other (pending, declined, cancelled, of another lesson or unknown) is 400 ASSIGNMENT_NOT_CONFIRMED.",
  })
  @IsUUID("all")
  assignmentId!: string;

  @ApiProperty({
    enum: MemberAttendanceStatus,
    enumName: "MemberAttendanceStatus",
    example: MemberAttendanceStatus.PRESENT,
    description: MEMBER_ATTENDANCE_STATUS_DESCRIPTION,
  })
  @IsEnum(MemberAttendanceStatus)
  status!: MemberAttendanceStatus;
}

/** The body of `PUT /lessons/:id/attendance/members`: the attendance to sign, all or none. */
@ApiSchema({
  description:
    "The attendance of confirmed assignments of the lesson of the URL, from 1 to 100 entries, all or none. The first signature of a member signs it; the same status again changes nothing; the other status is a correction (attendance.correct). Present records the lesson hours of the member; correcting to absent reverses them. Nobody signs her own attendance.",
})
export class ConfirmMemberAttendanceDto {
  /**
   * No @ArrayUnique on purpose: it would answer VALIDATION_FAILED, and a repeated assignment has its
   * own code, DUPLICATE_ASSIGNMENT, which the service answers with the positions.
   */
  @ApiProperty({
    type: () => MemberAttendanceEntryDto,
    isArray: true,
    minItems: 1,
    maxItems: MEMBER_ATTENDANCE_MAX_ENTRIES,
    description:
      "From 1 to 100 entries. The same assignment twice, in any letter case, is 400 DUPLICATE_ASSIGNMENT.",
  })
  @ValidateNested({ each: true })
  @Type(() => MemberAttendanceEntryDto)
  @ArrayMaxSize(MEMBER_ATTENDANCE_MAX_ENTRIES)
  @ArrayMinSize(1)
  @IsArray()
  entries!: MemberAttendanceEntryDto[];
}
