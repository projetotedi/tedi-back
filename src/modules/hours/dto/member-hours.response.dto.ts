import { ApiProperty } from "@nestjs/swagger";
import { MemberRefDto } from "@modules/people/dto/member-ref.response.dto";
import { HourEntryResponseDto } from "./hour-entry.response.dto";
import { HoursSummaryResponseDto } from "./hours-summary.response.dto";

/** A page of the entries of a member, the most recent day first. */
export class HourEntriesPageDto {
  @ApiProperty({ type: () => [HourEntryResponseDto] })
  data!: HourEntryResponseDto[];

  @ApiProperty({ type: "integer", example: 42 })
  total!: number;

  @ApiProperty({ type: "integer", example: 1 })
  page!: number;

  @ApiProperty({ type: "integer", example: 20 })
  limit!: number;
}

/**
 * The hours of one member in a period (F7.4): the same totals as the overview, the hours by
 * category with the pending ones, and her entries, each with its review note. The note of each
 * category on the screen is composed by the front from these fields.
 */
export class MemberHoursResponseDto {
  @ApiProperty({ type: () => MemberRefDto })
  member!: MemberRefDto;

  @ApiProperty({
    type: () => HoursSummaryResponseDto,
    description: "The totals of the member in the period, by status and by category.",
  })
  summary!: HoursSummaryResponseDto;

  @ApiProperty({ type: () => HourEntriesPageDto })
  entries!: HourEntriesPageDto;
}
