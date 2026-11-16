import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { HoursPageQueryDto } from "./hours-page-query.dto";

/** Query parameters for GET /hours/overview: the period, the page of members and the search. */
export class HoursOverviewQueryDto extends HoursPageQueryDto {
  @ApiPropertyOptional({
    example: "Ana",
    maxLength: 100,
    description:
      "Name or RA of the member, ignoring case and accents. It narrows the members and the totals alike.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
