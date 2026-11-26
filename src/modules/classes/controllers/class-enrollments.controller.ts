import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
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
import { AvailableStudentItemResponseDto } from "../dto/available-student-item.response.dto";
import { ClassEnrollmentItemResponseDto } from "../dto/class-enrollment-item.response.dto";
import { EnrollStudentsDto } from "../dto/enroll-students.dto";
import { EnrollStudentsResponseDto } from "../dto/enroll-students.response.dto";
import { ListAvailableStudentsQueryDto } from "../dto/list-available-students-query.dto";
import { ListClassEnrollmentsQueryDto } from "../dto/list-class-enrollments-query.dto";
import { classNotFound } from "../services/classes.service";
import { EnrollmentListingService } from "../services/enrollment-listing.service";
import { EnrollmentsService } from "../services/enrollments.service";

const CLASS_ID = new ParseUUIDPipe({ exceptionFactory: () => classNotFound() });

const CLASS_ID_PARAM = { name: "id", format: "uuid", description: "Id of the class." };

const CLASS_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "CLASS_NOT_FOUND" };

/**
 * The enrollments of one class (GUS-108): enroll students in it, one or many at once (RF-026), list
 * them, and list the students that can be enrolled in it. Enrolling and the list of the available
 * students (the screen of the enrollment) need enrollments.manage (director, coordinator and
 * superadmin; a member answers 403); the list of the class needs classes.view (every profile).
 *
 * `ClassesModule` registers this controller after the ones it already had, so `CourseClassesController`
 * keeps the first place (its literal routes under `/classes/`), and the shared schemas of the
 * contract keep the description of the property that named them first.
 */
@ApiTags("classes")
@Controller("classes")
@ApiStandardErrors()
export class ClassEnrollmentsController {
  constructor(
    private readonly enrollmentsService: EnrollmentsService,
    private readonly listingService: EnrollmentListingService,
  ) {}

  /**
   * Enrolls the students of the body in the class, all or none of the errors. A student who
   * already has an enrollment in the class, in any status, comes in `skipped`; a prerequisite she
   * did not complete comes in `warnings` and does not stop the enrollment (RF-032).
   */
  @Post(":id/enrollments")
  @RequirePermission(Permission.ENROLLMENTS_MANAGE)
  @ApiParam(CLASS_ID_PARAM)
  @ApiCreatedResponse({ type: EnrollStudentsResponseDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description:
      "VALIDATION_FAILED | DUPLICATE_STUDENT | STUDENT_NOT_FOUND (the last two with details on studentIds.<i>)",
  })
  @ApiNotFoundResponse(CLASS_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      "CLASS_ARCHIVED | CLASS_CLOSED | STUDENT_ARCHIVED (details on studentIds.<i>) | CLASS_FULL | ALREADY_ENROLLED. CLASS_FULL carries the seats left as a decimal string in details[0].message, with details[0].field = studentIds.",
  })
  enrollStudents(
    @Param("id", CLASS_ID) id: string,
    @Body() dto: EnrollStudentsDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<EnrollStudentsResponseDto> {
    return this.enrollmentsService.enroll(id, dto, actor.id);
  }

  /**
   * The enrollments of the class, every status unless `status` is asked, by the name of the
   * student, paginated and searchable. `phone` and `accessibilityNeed` are null for whoever cannot
   * see students (students.view). `attendanceRate` is the attendance rate of the enrollment
   * (GUS-166): presences over the roll calls recorded, null without any.
   */
  @Get(":id/enrollments")
  @RequirePermission(Permission.CLASSES_VIEW)
  @ApiParam(CLASS_ID_PARAM)
  @ApiOkResponsePaginated(ClassEnrollmentItemResponseDto)
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiNotFoundResponse(CLASS_NOT_FOUND_RESPONSE)
  listClassEnrollments(
    @Param("id", CLASS_ID) id: string,
    @Query() query: ListClassEnrollmentsQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<PaginatedResult<ClassEnrollmentItemResponseDto>> {
    return this.listingService.listClassEnrollments(id, query, actor);
  }

  /**
   * The students that can be enrolled in the class: not archived and without an enrollment in it,
   * in any status. Each comes with the age and the other classes where she is active.
   */
  @Get(":id/available-students")
  @RequirePermission(Permission.ENROLLMENTS_MANAGE)
  @ApiParam(CLASS_ID_PARAM)
  @ApiOkResponsePaginated(AvailableStudentItemResponseDto)
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiNotFoundResponse(CLASS_NOT_FOUND_RESPONSE)
  listAvailableStudents(
    @Param("id", CLASS_ID) id: string,
    @Query() query: ListAvailableStudentsQueryDto,
  ): Promise<PaginatedResult<AvailableStudentItemResponseDto>> {
    return this.listingService.listAvailableStudents(id, query);
  }
}
