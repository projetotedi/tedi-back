import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";
import { HOUR_ENTRY_REVIEW_MAX_BATCH } from "./hour-entry-limits";

/** The body of `PATCH /hour-entries/validate`: the pending entries to approve, all or none. */
export class ValidateHourEntriesDto {
  /**
   * No @ArrayUnique on purpose: it would answer VALIDATION_FAILED, and a repeated entry has its own
   * code, DUPLICATE_HOUR_ENTRY, which HoursReviewService answers with the positions.
   */
  @ApiProperty({
    type: "array",
    items: { type: "string", format: "uuid" },
    minItems: 1,
    maxItems: HOUR_ENTRY_REVIEW_MAX_BATCH,
    uniqueItems: true,
    example: ["01999a3e-7c1b-7000-8000-000000000a01", "01999a3e-7c1b-7000-8000-000000000a02"],
    description:
      "Ids of pending hour entries, from 1 to 100. All of them are approved with their declared minutes, or none is. A repeated id answers 400 DUPLICATE_HOUR_ENTRY.",
  })
  @IsUUID("all", { each: true })
  @ArrayMaxSize(HOUR_ENTRY_REVIEW_MAX_BATCH)
  @ArrayMinSize(1)
  @IsArray()
  ids!: string[];
}
