import { ApiProperty } from "@nestjs/swagger";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";

/** The observation of coordination on the hours of a member in one category, as it was saved. */
export class HourCategoryNoteResponseDto {
  @ApiProperty({ type: String, format: "uuid", description: "The member (the person)." })
  personId!: string;

  @ApiProperty({
    enum: HourEntryCategory,
    enumName: "HourEntryCategory",
    example: HourEntryCategory.PLANNING,
  })
  category!: HourEntryCategory;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Aguardando validação da coordenação.",
    description: "The observation. Null when it was cleared.",
  })
  note!: string | null;

  @ApiProperty({ type: String, format: "uuid", description: "Who wrote or cleared it last." })
  updatedById!: string;

  @ApiProperty({ type: String, format: "date-time", description: "When it was last written." })
  updatedAt!: Date;
}
