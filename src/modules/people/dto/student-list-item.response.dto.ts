import { ApiProperty } from "@nestjs/swagger";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";

/**
 * One student of a list of students: the item of the list of students, defined in GUS-108 for
 * GUS-106 to reuse. It has the shape of `StudentRef` (`StudentsService.listStudentRefs`): who the
 * student is, the age, the phone to reach her and the category of what she needs in class.
 */
export class StudentListItemResponseDto {
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
    description: "Digits only.",
  })
  phone!: string | null;

  @ApiProperty({
    enum: AccessibilityNeed,
    enumName: "AccessibilityNeed",
    example: AccessibilityNeed.NONE,
    description: "Category of what the student needs in class, never a diagnosis (RNF-13).",
  })
  accessibilityNeed!: AccessibilityNeed;
}
