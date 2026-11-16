import { ApiProperty } from "@nestjs/swagger";
import { EnrollmentSkippedResponseDto } from "./enrollment-skipped.response.dto";
import { EnrollmentWarningResponseDto } from "./enrollment-warning.response.dto";
import { EnrollmentResponseDto } from "./enrollment.response.dto";

/** The answer of `POST /classes/:id/enrollments`. The three lists are always there, maybe empty. */
export class EnrollStudentsResponseDto {
  @ApiProperty({
    type: () => EnrollmentResponseDto,
    isArray: true,
    description: "The enrollments made now, in the order of the body.",
  })
  enrolled!: EnrollmentResponseDto[];

  @ApiProperty({
    type: () => EnrollmentSkippedResponseDto,
    isArray: true,
    description: "The students left out because they already have an enrollment in the class.",
  })
  skipped!: EnrollmentSkippedResponseDto[];

  @ApiProperty({
    type: () => EnrollmentWarningResponseDto,
    isArray: true,
    description:
      "One item per enrolled student and prerequisite she did not complete, in the order of the body and then of the name of the course.",
  })
  warnings!: EnrollmentWarningResponseDto[];
}
