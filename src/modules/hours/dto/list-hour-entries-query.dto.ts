import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsUUID } from "class-validator";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { HoursPageQueryDto } from "./hours-page-query.dto";

/** Query parameters for GET /hour-entries: the queue of validation, a period and a page. */
export class ListHourEntriesQueryDto extends HoursPageQueryDto {
  @ApiPropertyOptional({
    enum: HourEntryStatus,
    enumName: "HourEntryStatus",
    default: HourEntryStatus.PENDING,
    description: "Only the entries with this status. One value; pending when omitted.",
  })
  @IsOptional()
  @IsEnum(HourEntryStatus)
  status?: HourEntryStatus;

  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    example: "01999a3e-0000-7000-8000-0000000000aa",
    description: "Only the entries of this person. Omit for every member of the scope.",
  })
  @IsOptional()
  @IsUUID()
  personId?: string;
}
