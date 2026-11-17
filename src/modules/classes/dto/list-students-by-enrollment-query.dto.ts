import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsUUID } from "class-validator";
import { StudentEnrollmentSituation } from "../enums/student-enrollment-situation.enum";
import { EnrollmentPageQueryDto } from "./enrollment-page-query.dto";

/** Query parameters for GET /enrollments/students. */
export class ListStudentsByEnrollmentQueryDto extends EnrollmentPageQueryDto {
  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    description:
      "Only the enrollments of this class. An id that is not a class answers no one enrolled and everybody not enrolled.",
  })
  @IsOptional()
  @IsUUID("all")
  classId?: string;

  @ApiPropertyOptional({
    enum: StudentEnrollmentSituation,
    enumName: "StudentEnrollmentSituation",
    description:
      "enrolled: students with an active enrollment (in classId, or in any class); not_enrolled: students not archived without one. Omitted = enrolled.",
  })
  @IsOptional()
  @IsEnum(StudentEnrollmentSituation)
  situation?: StudentEnrollmentSituation;
}
