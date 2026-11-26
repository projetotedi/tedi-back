import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { HoursExportFormat } from "../enums/hours-export-format.enum";
import { HoursPeriodQueryDto } from "./hours-period-query.dto";

/** Query parameters for GET /hours/export: the period and the format of the file. */
export class HoursExportQueryDto extends HoursPeriodQueryDto {
  @ApiPropertyOptional({
    enum: HoursExportFormat,
    enumName: "HoursExportFormat",
    default: HoursExportFormat.CSV,
    description: "Only csv for now; xlsx answers 400 VALIDATION_FAILED.",
  })
  @IsOptional()
  @IsEnum(HoursExportFormat)
  format?: HoursExportFormat;
}
