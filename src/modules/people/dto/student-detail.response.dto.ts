import { ApiProperty } from "@nestjs/swagger";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";

const NEEDS_DESCRIPTION = "What the person needs in class, never a diagnosis (RNF-13).";

/** Emergency contact of a student. Always present; each field is null when not informed. */
export class EmergencyContactDto {
  @ApiProperty({ type: String, nullable: true, example: "Ana Santos" })
  name!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "43988887777",
    description: "Digits only.",
  })
  phone!: string | null;
}

/** Id and name of a Person. Nothing else: no e-mail, RA, role or access data. */
export class PersonRefDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-0000-7000-8000-0000000000aa" })
  id!: string;

  @ApiProperty({ type: String, example: "Carla Menezes" })
  name!: string;
}

/**
 * Student record page (GUS-107): personal data, profile, accessibility and registration.
 * `id` is the id of the Person (RN-09). Enrollments, finished courses and attendance are not
 * here: they come from GET /students/:id/enrollments (GUS-108).
 */
export class StudentDetailDto {
  // Person

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

  @ApiProperty({
    type: String,
    nullable: true,
    example: "43999990000",
    description: "Digits only.",
  })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "maria.santos@example.com" })
  email!: string | null;

  // Profile

  @ApiProperty({ type: String, nullable: true, example: "Ensino fundamental completo" })
  education!: string | null;

  @ApiProperty({ type: Boolean, nullable: true, example: true })
  hasSmartphone!: boolean | null;

  @ApiProperty({ type: Boolean, nullable: true, example: false })
  hasComputer!: boolean | null;

  @ApiProperty({ type: String, nullable: true, example: "Indicação de uma amiga" })
  howFoundUs!: string | null;

  @ApiProperty({ type: () => EmergencyContactDto })
  emergencyContact!: EmergencyContactDto;

  // Accessibility (RNF-13)

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

  // Registration

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-10-01T13:00:00.000Z",
    description: "When the student was registered.",
  })
  createdAt!: Date;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description: "Who registered the student. Null when that person was deleted.",
  })
  createdBy!: PersonRefDto | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-10-01T13:00:00.000Z",
    description: "The most recent change between the person and the profile.",
  })
  updatedAt!: Date;

  // Archive (RN-27)

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description: "Null while active. An archived student stays readable.",
  })
  archivedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  archiveReason!: string | null;
}
