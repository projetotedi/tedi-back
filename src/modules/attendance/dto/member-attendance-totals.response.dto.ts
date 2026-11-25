import { ApiProperty } from "@nestjs/swagger";

/** How many presences and absences a member has, cancelled lessons left out. Both always come, 0 included. */
export class MemberAttendanceTotalsResponseDto {
  @ApiProperty({ type: "integer", example: 12 })
  present!: number;

  @ApiProperty({ type: "integer", example: 1 })
  absent!: number;
}
