import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
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
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { EnrollStudentsDto } from "../dto/enroll-students.dto";
import { EnrollStudentsResponseDto } from "../dto/enroll-students.response.dto";
import { classNotFound } from "../services/classes.service";
import { EnrollmentsService } from "../services/enrollments.service";

const CLASS_ID = new ParseUUIDPipe({ exceptionFactory: () => classNotFound() });

const CLASS_ID_PARAM = { name: "id", format: "uuid", description: "Id of the class." };

const CLASS_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "CLASS_NOT_FOUND" };

/**
 * The enrollments of one class (GUS-108): enroll students in it, one or many at once (RF-026). The
 * write needs enrollments.manage (director, coordinator and superadmin); a member answers 403.
 *
 * `ClassesModule` registers this controller after the ones it already had, so `CourseClassesController`
 * keeps the first place (its literal routes under `/classes/`), and the shared schemas of the
 * contract keep the description of the property that named them first.
 */
@ApiTags("classes")
@Controller("classes")
@ApiStandardErrors()
export class ClassEnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

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
}
