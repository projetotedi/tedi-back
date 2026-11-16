import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { ENROLLMENT_STATUS_DESCRIPTION, EnrollmentStatus } from "../enums/enrollment-status.enum";
import { EnrollmentPageQueryDto } from "./enrollment-page-query.dto";

/** Query parameters for GET /classes/:id/enrollments. Omit `status` for every status. */
export class ListClassEnrollmentsQueryDto extends EnrollmentPageQueryDto {
  @ApiPropertyOptional({
    enum: EnrollmentStatus,
    enumName: "EnrollmentStatus",
    description: ENROLLMENT_STATUS_DESCRIPTION,
  })
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;
}
