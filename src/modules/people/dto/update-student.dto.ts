import { ApiPropertyOptional, OmitType, PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsNotEmpty, IsString, MaxLength, ValidateIf } from "class-validator";
import { trim } from "@shared/dto/transforms";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";
import { IsBirthDate } from "../validators/is-birth-date.validator";
import { CreateStudentDto } from "./create-student.dto";

/**
 * Body of PATCH /students/:id. Every field is optional:
 * omitted leaves the value alone, null clears it (optional fields only).
 */
export class UpdateStudentDto extends PartialType(
  OmitType(CreateStudentDto, ["name", "birthDate", "accessibilityNeed"] as const),
) {
  // Required on create. Here they may be omitted but never null: null would hit a NOT NULL
  // column or erase RF-001 data, and @IsOptional would let it through, hence @ValidateIf.
  @ApiPropertyOptional({ type: String, maxLength: 200, example: "Maria Silva Santos" })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    format: "date",
    example: "1958-04-12",
    description: "YYYY-MM-DD, between 1900-01-01 and today (America/Sao_Paulo). Never null.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBirthDate()
  birthDate?: string;

  @ApiPropertyOptional({
    enum: AccessibilityNeed,
    enumName: "AccessibilityNeed",
    description:
      "Category of what the person needs in class, never a diagnosis (RNF-13). Never null.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(AccessibilityNeed)
  accessibilityNeed?: AccessibilityNeed;
}
