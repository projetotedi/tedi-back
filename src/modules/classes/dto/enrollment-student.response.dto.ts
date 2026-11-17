import { ApiProperty } from "@nestjs/swagger";
import { AccessibilityNeed } from "@modules/people/services/students.service";

/**
 * The student of an enrollment in the list of the class. `phone` and `accessibilityNeed` are
 * personal data (RNF-13): they come only to whoever can see students (students.view), and null to
 * everybody else, whatever the student has.
 */
export class EnrollmentStudentResponseDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-000000000001",
    description: "Person id of the student.",
  })
  id!: string;

  @ApiProperty({ type: String, example: "Maria Silva Santos" })
  name!: string;

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
    description:
      "Digits only. Null when the student has none or when the caller cannot see students (students.view).",
  })
  phone!: string | null;

  @ApiProperty({
    enum: AccessibilityNeed,
    enumName: "AccessibilityNeed",
    nullable: true,
    example: AccessibilityNeed.NONE,
    description: "null when the caller cannot see students (students.view).",
  })
  accessibilityNeed!: AccessibilityNeed | null;
}
