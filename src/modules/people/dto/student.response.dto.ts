import { ApiProperty } from "@nestjs/swagger";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";

const NEEDS_DESCRIPTION = "What the person needs in class, never a diagnosis (RNF-13).";

/**
 * Student as returned by the API: Person data plus StudentProfile data.
 * `id` is the id of the Person (RN-09); the profile id stays internal.
 * `age` is computed on every response, never stored (RF-002).
 */
export class StudentResponseDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-000000000001",
    description: "Id of the Person.",
  })
  id!: string;

  @ApiProperty({ type: String, example: "Maria Silva Santos" })
  name!: string;

  @ApiProperty({ type: String, format: "date", example: "1958-04-12" })
  birthDate!: string;

  @ApiProperty({
    type: "integer",
    example: 68,
    description: "Whole years today in America/Sao_Paulo.",
  })
  age!: number;

  @ApiProperty({ type: String, nullable: true, example: "maria.santos@example.com" })
  email!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "43999990000",
    description: "Digits only.",
  })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "Ensino fundamental completo" })
  education!: string | null;

  @ApiProperty({ type: Boolean, nullable: true, example: true })
  hasSmartphone!: boolean | null;

  @ApiProperty({ type: Boolean, nullable: true, example: false })
  hasComputer!: boolean | null;

  @ApiProperty({ type: String, nullable: true, example: "Indicação de uma amiga" })
  howFoundUs!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "Ana Santos" })
  emergencyContactName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "43988887777",
    description: "Digits only.",
  })
  emergencyContactPhone!: string | null;

  @ApiProperty({
    enum: AccessibilityNeed,
    enumName: "AccessibilityNeed",
    example: AccessibilityNeed.VISUAL,
    description: `Category. ${NEEDS_DESCRIPTION}`,
  })
  accessibilityNeed!: AccessibilityNeed;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Fonte ampliada",
    description: `Support resource the person uses. ${NEEDS_DESCRIPTION}`,
  })
  supportResource!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Sentar perto do projetor",
    description: `Needs during class. ${NEEDS_DESCRIPTION}`,
  })
  classNeeds!: string | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description: "Null while the student is active (RN-27).",
  })
  archivedAt!: Date | null;

  @ApiProperty({ type: String, format: "uuid", nullable: true, example: null })
  archivedById!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  archiveReason!: string | null;

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-0000-7000-8000-0000000000aa",
    description: "Id of the person who registered the student.",
  })
  createdById!: string;

  @ApiProperty({ type: String, format: "date-time", example: "2026-10-01T13:00:00.000Z" })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-10-01T13:00:00.000Z",
    description: "The most recent change between the person and the profile.",
  })
  updatedAt!: Date;
}
