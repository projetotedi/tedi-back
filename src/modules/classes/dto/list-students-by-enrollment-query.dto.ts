import { ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { StudentEnrollmentSituation } from "../enums/student-enrollment-situation.enum";
import { EnrollmentPageQueryDto } from "./enrollment-page-query.dto";

/**
 * Query parameters for GET /enrollments/students. `page` and `limit` come from the base; `search`
 * is declared again because it is the search of the list of students (GUS-106), not only the name.
 * Redeclaring it straight over the base does not compile (`useDefineForClassFields`, TS2612), hence
 * the `OmitType`.
 */
export class ListStudentsByEnrollmentQueryDto extends OmitType(EnrollmentPageQueryDto, [
  "search",
] as const) {
  @ApiPropertyOptional({
    example: "Maria",
    maxLength: 100,
    description:
      "Part of the name or of the e-mail, ignoring case and accents; when the term has only digits and the characters space ( ) - . +, also the digits of the phone, compared as they were stored (a term with the country code +55 does not find a phone stored without it). The search of GET /students.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

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
