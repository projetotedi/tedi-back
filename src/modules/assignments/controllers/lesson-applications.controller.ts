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
import { ApplyToLessonDto } from "../dto/apply-to-lesson.dto";
import { LessonAssignmentResponseDto } from "../dto/lesson-assignment.response.dto";
import { ApplicationsService } from "../services/applications.service";
import { lessonNotFound } from "../services/assignment-errors";

/** A malformed id is a lesson that does not exist, so it answers the same 404 as an unknown one. */
const LESSON_ID = new ParseUUIDPipe({ exceptionFactory: () => lessonNotFound() });

/**
 * The application of a member to a lesson (F5.1, GUS-160). It needs assignments.manageOwn, which
 * every profile has over herself: the applicant is always the person of the session, so the scope
 * is the actor by construction and the route asks no `PermissionPolicy` (as the routes `/me/*`).
 * The review of the applications is `ApplicationsController`, under `/applications`.
 */
@ApiTags("assignments")
@Controller("lessons/:id/applications")
@ApiStandardErrors()
export class LessonApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  @RequirePermission(Permission.ASSIGNMENTS_MANAGE_OWN)
  @ApiParam({ name: "id", format: "uuid", description: "Id of the lesson." })
  @ApiCreatedResponse({
    type: LessonAssignmentResponseDto,
    description:
      "The application: pending, source application, with the member of the session as person and as createdById, and the note she wrote.",
  })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "LESSON_NOT_FOUND" })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      "LESSON_CANCELLED | LESSON_IN_PAST | MEMBER_INACTIVE | ALREADY_APPLIED | ROLE_FULL",
  })
  applyToLesson(
    @Param("id", LESSON_ID) lessonId: string,
    @Body() dto: ApplyToLessonDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonAssignmentResponseDto> {
    return this.applicationsService.apply(lessonId, dto, actor);
  }
}
