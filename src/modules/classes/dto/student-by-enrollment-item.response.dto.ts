import { ApiProperty } from "@nestjs/swagger";
import { StudentListItemResponseDto } from "@modules/people/dto/student-list-item.response.dto";
import { EnrollmentClassRefResponseDto } from "./enrollment-class-ref.response.dto";

/**
 * One student of GET /enrollments/students: the item of the list of students (people, defined in
 * GUS-108 for GUS-106) plus the classes where she has an active enrollment.
 */
export class StudentByEnrollmentItemResponseDto extends StudentListItemResponseDto {
  @ApiProperty({
    type: () => EnrollmentClassRefResponseDto,
    isArray: true,
    description:
      "The classes where the student has an active enrollment, the most recent edition first.",
  })
  currentClasses!: EnrollmentClassRefResponseDto[];
}
