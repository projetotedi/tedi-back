import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { ApiOkResponsePaginated } from "@shared/pagination/api-paginated-response.decorator";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { EnrollmentResponseDto } from "../dto/enrollment.response.dto";
import { ListStudentsByEnrollmentQueryDto } from "../dto/list-students-by-enrollment-query.dto";
import { StudentByEnrollmentItemResponseDto } from "../dto/student-by-enrollment-item.response.dto";
import { UpdateEnrollmentStatusDto } from "../dto/update-enrollment-status.dto";
import { enrollmentNotFound } from "../services/enrollment-errors";
import { EnrollmentListingService } from "../services/enrollment-listing.service";
import { EnrollmentsService } from "../services/enrollments.service";

/** A malformed id is an enrollment that does not exist: the same 404 as an unknown id. */
const ENROLLMENT_ID = new ParseUUIDPipe({ exceptionFactory: () => enrollmentNotFound() });

const ENROLLMENT_ID_PARAM = { name: "id", format: "uuid", description: "Id of the enrollment." };

const ENROLLMENT_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "ENROLLMENT_NOT_FOUND" };

/**
 * One enrollment (GUS-108): change its status (RF-027) and remove it, both with enrollments.manage
 * (director, coordinator and superadmin; a member answers 403). And the students by enrollment
 * (`GET /enrollments/students`, students.view), for the screen of students. There is no
 * `GET /enrollments/:id`: an enrollment is read in the list of its class or in the history of its
 * student.
 */
@ApiTags("classes")
@Controller("enrollments")
@ApiStandardErrors()
export class EnrollmentsController {
  constructor(
    private readonly enrollmentsService: EnrollmentsService,
    private readonly listingService: EnrollmentListingService,
  ) {}

  /**
   * Changes the status of the enrollment from `effectiveDate`, with an optional reason. The same
   * status is a no-op (200). Back to active takes a seat of the class.
   */
  @Patch(":id")
  @RequirePermission(Permission.ENROLLMENTS_MANAGE)
  @ApiParam(ENROLLMENT_ID_PARAM)
  @ApiOkResponse({ type: EnrollmentResponseDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description:
      "VALIDATION_FAILED | EFFECTIVE_DATE_IN_FUTURE | EFFECTIVE_DATE_BEFORE_ENROLLMENT (the last two with details on effectiveDate)",
  })
  @ApiNotFoundResponse(ENROLLMENT_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      "CLASS_ARCHIVED | CLASS_CLOSED | STUDENT_ARCHIVED | CLASS_FULL. The last three only going back to active; CLASS_FULL carries the seats left as a decimal string in details[0].message, with details[0].field = status.",
  })
  updateEnrollmentStatus(
    @Param("id", ENROLLMENT_ID) id: string,
    @Body() dto: UpdateEnrollmentStatusDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<EnrollmentResponseDto> {
    return this.enrollmentsService.updateStatus(id, dto, actor.id);
  }

  /**
   * Removes an active enrollment made by mistake. Dropped and completed enrollments are history and
   * change through the status instead.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ENROLLMENTS_MANAGE)
  @ApiParam(ENROLLMENT_ID_PARAM)
  @ApiNoContentResponse({ description: "Removed." })
  @ApiNotFoundResponse(ENROLLMENT_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: "CLASS_ARCHIVED | ENROLLMENT_NOT_REMOVABLE",
  })
  removeEnrollment(
    @Param("id", ENROLLMENT_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<void> {
    return this.enrollmentsService.remove(id, actor.id);
  }

  /**
   * The students with an active enrollment (`situation=enrolled`, the default), in `classId` or in
   * any class, or the students not archived without one (`not_enrolled`), by name, paginated and
   * searchable. The item is the one of the list of students (GUS-106) plus `currentClasses`.
   */
  @Get("students")
  @RequirePermission(Permission.STUDENTS_VIEW)
  @ApiOkResponsePaginated(StudentByEnrollmentItemResponseDto)
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  listStudentsByEnrollment(
    @Query() query: ListStudentsByEnrollmentQueryDto,
  ): Promise<PaginatedResult<StudentByEnrollmentItemResponseDto>> {
    return this.listingService.listStudentsByEnrollment(query);
  }
}
