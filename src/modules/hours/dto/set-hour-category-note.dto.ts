import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { trimToNull } from "@shared/dto/transforms";
import { HOUR_CATEGORY_NOTE_MAX_LENGTH } from "../entities/hour-category-note.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";

/** The body of `PUT /members/:id/hours/notes`: the observation of one category of the member. */
export class SetHourCategoryNoteDto {
  @ApiProperty({
    enum: HourEntryCategory,
    enumName: "HourEntryCategory",
    example: HourEntryCategory.PLANNING,
    description:
      "The category the observation is about. Every category takes one, lesson included.",
  })
  @IsEnum(HourEntryCategory)
  category!: HourEntryCategory;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: HOUR_CATEGORY_NOTE_MAX_LENGTH,
    example: "Aguardando validação da coordenação.",
    description:
      "Free text of coordination, trimmed, up to 500 characters. Null or blank clears the observation.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(HOUR_CATEGORY_NOTE_MAX_LENGTH)
  @IsString()
  note!: string | null;
}
