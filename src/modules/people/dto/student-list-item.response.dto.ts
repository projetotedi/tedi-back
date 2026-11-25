import { ApiProperty } from "@nestjs/swagger";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";
import type { StudentListEntry } from "../services/students.service";

/**
 * One student of a list of students: the item of `GET /students` (GUS-106) and, with the classes
 * of the student, of `GET /enrollments/students` (GUS-108). It implements `StudentListEntry`
 * (`StudentsService.listStudentEntries`): who the student is, the age, the phone and the e-mail to
 * reach her, the category of what she needs in class and when she was registered. No emergency
 * contact, support resource or class needs: those stay in the record (`GET /students/:id`).
 */
export class StudentListItemResponseDto implements StudentListEntry {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-000000000001",
    description: "Person id of the student.",
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

  @ApiProperty({
    enum: AccessibilityNeed,
    enumName: "AccessibilityNeed",
    example: AccessibilityNeed.NONE,
    description: "Category of what the student needs in class, never a diagnosis (RNF-13).",
  })
  accessibilityNeed!: AccessibilityNeed;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-10-01T13:00:00.000Z",
    description: "When the person was registered as a student.",
  })
  createdAt!: Date;
}
