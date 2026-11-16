import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { HoursPeriodQueryDto } from "./hours-period-query.dto";

/** Query parameters for GET /me/hour-entries: the page, the filters and the period. */
export class ListMyHourEntriesQueryDto extends HoursPeriodQueryDto {
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

  @ApiPropertyOptional({
    enum: HourEntryStatus,
    enumName: "HourEntryStatus",
    description: "Only the entries with this status. One value. Omit for every status.",
  })
  @IsOptional()
  @IsEnum(HourEntryStatus)
  status?: HourEntryStatus;

  @ApiPropertyOptional({
    enum: HourEntryCategory,
    enumName: "HourEntryCategory",
    description:
      "Only the entries of this category. One value, lesson included. Omit for every category.",
  })
  @IsOptional()
  @IsEnum(HourEntryCategory)
  category?: HourEntryCategory;
}
