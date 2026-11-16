import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { HoursPeriodQueryDto } from "./hours-period-query.dto";

/**
 * A period and a page, for the readings of the team (GUS-164). The same page as the statement of
 * the person (ListMyHourEntriesQueryDto), kept apart while GUS-162 is under review.
 */
export class HoursPageQueryDto extends HoursPeriodQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined ? Number(value) : undefined))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined ? Number(value) : undefined))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
