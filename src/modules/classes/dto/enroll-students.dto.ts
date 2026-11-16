import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";
import { ENROLLMENT_MAX_STUDENTS } from "./enrollment-limits";

/** The body of `POST /classes/:id/enrollments`: the students to enroll, one or many (RF-026). */
export class EnrollStudentsDto {
  /**
   * No @ArrayUnique on purpose: it would answer VALIDATION_FAILED, and a repeated student has its own
   * code, DUPLICATE_STUDENT, which the service answers with the positions.
   */
  @ApiProperty({
    type: [String],
    format: "uuid",
    minItems: 1,
    maxItems: ENROLLMENT_MAX_STUDENTS,
    example: ["01999a3e-7c1b-7000-8000-000000000001", "01999a3e-7c1b-7000-8000-000000000002"],
    description:
      "Person ids of the students, from 1 to 100. The same student twice, in any letter case, is 400 DUPLICATE_STUDENT.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ENROLLMENT_MAX_STUDENTS)
  @IsUUID("all", { each: true })
  studentIds!: string[];
}
