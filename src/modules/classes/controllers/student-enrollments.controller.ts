import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiNotFoundResponse, ApiOkResponse, ApiParam, ApiTags } from "@nestjs/swagger";
import { studentNotFound } from "@modules/people/services/students.service";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { StudentEnrollmentsResponseDto } from "../dto/student-enrollments.response.dto";
import { EnrollmentListingService } from "../services/enrollment-listing.service";

/** A malformed id is a student that does not exist: the same 404 as `GET /students/:id`. */
const STUDENT_ID = new ParseUUIDPipe({ exceptionFactory: () => studentNotFound() });

/**
 * The enrollments of one student (GUS-108): the history of the record of the student. It lives in
 * `classes`, and not in `people`, because the enrollments are a table of this module; the tag is
 * `classes` too. Needs students.view, which every profile has.
 */
@ApiTags("classes")
@Controller("students")
@ApiStandardErrors()
export class StudentEnrollmentsController {
  constructor(private readonly listingService: EnrollmentListingService) {}

  /**
   * Every enrollment of the student that is not removed, the newest first, with class, edition and
   * course, and the summary: active classes, completed courses (RN-16) and the first enrollment.
   * An archived student answers 200.
   */
  @Get(":id/enrollments")
  @RequirePermission(Permission.STUDENTS_VIEW)
  @ApiParam({ name: "id", format: "uuid", description: "Person id of the student." })
  @ApiOkResponse({ type: StudentEnrollmentsResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "STUDENT_NOT_FOUND" })
  listStudentEnrollments(
    @Param("id", STUDENT_ID) id: string,
  ): Promise<StudentEnrollmentsResponseDto> {
    return this.listingService.listStudentEnrollments(id);
  }
}
