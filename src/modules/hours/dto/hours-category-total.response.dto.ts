import { ApiProperty } from "@nestjs/swagger";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";

/** The entries of one category in the period: what is in the bank and what waits for review. */
export class HoursCategoryTotalDto {
  @ApiProperty({
    enum: HourEntryCategory,
    enumName: "HourEntryCategory",
    example: HourEntryCategory.PLANNING,
  })
  category!: HourEntryCategory;

  @ApiProperty({ type: "integer", example: 3, description: "How many entries, of any status." })
  entries!: number;

  @ApiProperty({
    type: "integer",
    example: 390,
    description: "Sum of their declared minutes, of any status.",
  })
  declaredMinutes!: number;

  @ApiProperty({
    type: "integer",
    example: 120,
    description: "Validated minutes of the approved and adjusted entries: what is in the bank.",
  })
  bankMinutes!: number;

  @ApiProperty({
    type: "integer",
    example: 150,
    description: "Declared minutes of the pending entries: what waits for review.",
  })
  pendingMinutes!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Aguardando validação da coordenação.",
    description:
      "The observation of coordination on this category of the member (GUS-173), whatever the period. Null when there is none, and always null in GET /hours/overview, which sums the team.",
  })
  note!: string | null;
}
