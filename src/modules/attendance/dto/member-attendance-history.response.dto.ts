import { ApiProperty } from "@nestjs/swagger";
import { MemberAttendanceHistoryItemResponseDto } from "./member-attendance-history-item.response.dto";
import { MemberAttendanceTotalsResponseDto } from "./member-attendance-totals.response.dto";

/** The attendance history of a member (F6.4): her presences and absences, with the totals. */
export class MemberAttendanceHistoryResponseDto {
  @ApiProperty({ type: () => MemberAttendanceTotalsResponseDto })
  totals!: MemberAttendanceTotalsResponseDto;

  @ApiProperty({
    type: () => MemberAttendanceHistoryItemResponseDto,
    isArray: true,
    description:
      "Presences and absences, the latest lesson first (day, then start time, both descending). Cancelled lessons are left out: they did not happen (RN-07). Not paginated.",
  })
  items!: MemberAttendanceHistoryItemResponseDto[];
}
