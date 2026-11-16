import { ApiProperty } from "@nestjs/swagger";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";

/** The entries of one status in the period, and their minutes. */
export class HoursStatusTotalDto {
  @ApiProperty({
    enum: HourEntryStatus,
    enumName: "HourEntryStatus",
    example: HourEntryStatus.PENDING,
  })
  status!: HourEntryStatus;

  @ApiProperty({ type: "integer", example: 2, description: "How many entries." })
  entries!: number;

  @ApiProperty({ type: "integer", example: 270, description: "Sum of their declared minutes." })
  declaredMinutes!: number;

  @ApiProperty({
    type: "integer",
    example: 0,
    description: "Sum of their validated minutes; 0 where none is validated yet.",
  })
  validatedMinutes!: number;
}
