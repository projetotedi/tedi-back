import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { trim, trimLowerToNull, trimToNull } from "@shared/dto/transforms";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";
import { IsBirthDate } from "../validators/is-birth-date.validator";
import { normalizePhone, PHONE_DIGITS } from "../validators/phone";

const NEEDS_DESCRIPTION = "What the person needs in class, never a diagnosis (RNF-13).";

/**
 * Body of POST /students (RF-001, RF-003). Name and birth date are required.
 * Optional text fields accept null (and "" becomes null) to mean "not informed".
 */
export class CreateStudentDto {
  @ApiProperty({ type: String, maxLength: 200, example: "Maria Silva Santos" })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "1958-04-12",
    description: "YYYY-MM-DD, between 1900-01-01 and today (America/Sao_Paulo).",
  })
  @IsBirthDate()
  birthDate!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    example: "maria.santos@example.com",
    description: "Trimmed and lower-cased. Unique among people.",
  })
  @IsOptional()
  @Transform(trimLowerToNull)
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "(43) 99999-0000",
    description: "Formatting is stripped; stored as 10 to 13 digits (DDD, optional country code).",
  })
  @IsOptional()
  @Transform(normalizePhone)
  @Matches(PHONE_DIGITS, { message: "phone must have 10 to 13 digits" })
  phone?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 100,
    example: "Ensino fundamental completo",
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  education?: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true, example: true })
  @IsOptional()
  @IsBoolean()
  hasSmartphone?: boolean | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true, example: false })
  @IsOptional()
  @IsBoolean()
  hasComputer?: boolean | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    example: "Indicação de uma amiga",
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  howFoundUs?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200, example: "Ana Santos" })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: "43988887777",
    description: "Same format as phone.",
  })
  @IsOptional()
  @Transform(normalizePhone)
  @Matches(PHONE_DIGITS, { message: "emergencyContactPhone must have 10 to 13 digits" })
  emergencyContactPhone?: string | null;

  @ApiPropertyOptional({
    enum: AccessibilityNeed,
    enumName: "AccessibilityNeed",
    default: AccessibilityNeed.NONE,
    description: `Category. ${NEEDS_DESCRIPTION}`,
  })
  // null is rejected: "none" already means "no need". Only undefined (omitted) skips the check.
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(AccessibilityNeed)
  accessibilityNeed?: AccessibilityNeed;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    example: "Fonte ampliada",
    description: `Support resource the person uses. ${NEEDS_DESCRIPTION}`,
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  supportResource?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    example: "Sentar perto do projetor",
    description: `Needs during class. ${NEEDS_DESCRIPTION}`,
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  classNeeds?: string | null;
}
