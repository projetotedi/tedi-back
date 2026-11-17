import { ApiProperty } from "@nestjs/swagger";
import { EnrollmentClassRefResponseDto } from "./enrollment-class-ref.response.dto";

/**
 * A student that can be enrolled in the class (GET /classes/:id/available-students): not archived
 * and without an enrollment in it. No contact data: this is the screen of the enrollment.
 */
export class AvailableStudentItemResponseDto {
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
    type: () => EnrollmentClassRefResponseDto,
    isArray: true,
    description:
      "The other classes where the student has an active enrollment, the most recent edition first.",
  })
  currentClasses!: EnrollmentClassRefResponseDto[];
}
