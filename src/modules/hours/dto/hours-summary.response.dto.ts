import { ApiProperty } from "@nestjs/swagger";
import { HoursCategoryTotalDto } from "./hours-category-total.response.dto";
import { HoursStatusTotalDto } from "./hours-status-total.response.dto";

/**
 * The totals of the logged-in person in a period. Removed entries are left out. Every status and
 * every category is always there, in the order of their enums, with zeros when nothing matches.
 */
export class HoursSummaryResponseDto {
  @ApiProperty({
    type: String,
    format: "date",
    nullable: true,
    example: "2026-03-01",
    description: "The first day asked, or null when the period has no lower bound.",
  })
  from!: string | null;

  @ApiProperty({
    type: String,
    format: "date",
    nullable: true,
    example: "2026-03-31",
    description: "The last day asked, or null when the period has no upper bound.",
  })
  to!: string | null;

  @ApiProperty({
    type: "integer",
    example: 120,
    description:
      "The bank of hours, in minutes: the validated minutes of the approved and adjusted entries.",
  })
  bankMinutes!: number;

  @ApiProperty({
    type: () => [HoursStatusTotalDto],
    description: "One item per status (pending, approved, adjusted, rejected), always the four.",
  })
  byStatus!: HoursStatusTotalDto[];

  @ApiProperty({
    type: () => [HoursCategoryTotalDto],
    description: "One item per category, always the seven, lesson included.",
  })
  byCategory!: HoursCategoryTotalDto[];
}
