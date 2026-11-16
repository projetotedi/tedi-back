import { ApiProperty } from "@nestjs/swagger";
import { HoursMemberTotalDto } from "./hours-member-total.response.dto";
import { HoursSummaryResponseDto } from "./hours-summary.response.dto";

/** A page of the members of the overview. */
export class HoursMembersPageDto {
  @ApiProperty({ type: () => [HoursMemberTotalDto] })
  data!: HoursMemberTotalDto[];

  @ApiProperty({
    type: "integer",
    example: 42,
    description: "How many members have entries in the period.",
  })
  total!: number;

  @ApiProperty({ type: "integer", example: 1 })
  page!: number;

  @ApiProperty({ type: "integer", example: 20 })
  limit!: number;
}

/**
 * The overview of the bank of hours in a period (F7.4), for the members the actor reads with
 * hours.viewOthers and the search. The four numbers of the screen come from `summary`:
 * - logged: the sum of `byStatus[*].declaredMinutes` (and of `entries`);
 * - validated: `bankMinutes`;
 * - pending: `byStatus[pending].declaredMinutes`;
 * - adjusted or rejected: `byStatus[adjusted].entries + byStatus[rejected].entries`, and the minutes
 *   not accepted are `byStatus[adjusted].declaredMinutes - byStatus[adjusted].validatedMinutes +
 *   byStatus[rejected].declaredMinutes`.
 * Logged = validated + pending + not accepted.
 */
export class HoursOverviewResponseDto {
  @ApiProperty({
    type: () => HoursSummaryResponseDto,
    description: "The totals of the period, by status and by category, and the bank of hours.",
  })
  summary!: HoursSummaryResponseDto;

  @ApiProperty({
    type: () => HoursMembersPageDto,
    description:
      "The members with entries in the period: the most pending minutes first, then the most declared minutes, then the person id.",
  })
  members!: HoursMembersPageDto;
}
