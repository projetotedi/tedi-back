import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional } from "class-validator";
import { IsCalendarDate } from "@shared/dates/is-calendar-date.validator";

/**
 * A period of days, both ends included, for the statement and the summary. Either end may be
 * omitted; when both come, `from` cannot be after `to` (400 INVALID_PERIOD).
 */
export class HoursPeriodQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: "date",
    example: "2026-03-01",
    description: "First day, YYYY-MM-DD, inclusive. Omit for no lower bound.",
  })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: "date",
    example: "2026-03-31",
    description: "Last day, YYYY-MM-DD, inclusive. Omit for no upper bound.",
  })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}
