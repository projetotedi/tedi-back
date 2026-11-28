import { Controller, Get, Param, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { LessonAssignmentResponseDto } from "../dto/lesson-assignment.response.dto";
import { ListApplicationsQueryDto } from "../dto/list-applications-query.dto";
import { PendingApplicationsResponseDto } from "../dto/pending-applications.response.dto";
import { ApplicationsService } from "../services/applications.service";
import { applicationNotFound } from "../services/assignment-errors";

/** A malformed id is an application that does not exist, so it answers the same 404 as an unknown one. */
const APPLICATION_ID = new ParseUUIDPipe({ exceptionFactory: () => applicationNotFound() });

const APPLICATION_ID_PARAM = {
  name: "id",
  format: "uuid",
  description: "Id of the application (an assignment with source application).",
};

const APPLICATION_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "APPLICATION_NOT_FOUND" };

const FORBIDDEN_RESPONSE = { type: ApiErrorDto, description: "FORBIDDEN" };

/**
 * The review of the applications (GUS-160): the queue of the pending ones, grouped by lesson, and
 * approving or declining one. The three routes need assignments.review: a director of any
 * department, the coordination and the superadmin (scope all), and a member answers 403 FORBIDDEN.
 * The scope is only all or none, so the guard decides who gets in; the queue still asks the policy,
 * for the note.
 *
 * Approving and declining answer the same LessonAssignmentResponseDto as the routes of the
 * assignments, so the client has one type for an assignment and an application.
 */
@ApiTags("assignments")
@Controller("applications")
@ApiStandardErrors()
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Get()
  @RequirePermission(Permission.ASSIGNMENTS_REVIEW)
  @ApiOkResponse({
    type: PendingApplicationsResponseDto,
    description:
      "The pending applications grouped by lesson, the soonest lesson first, with the coverage of each lesson and the note of each application; total is how many applications are listed (the N of the button). An application of a lesson before today or cancelled expired and is left out (GUS-179). Not paginated.",
  })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiForbiddenResponse(FORBIDDEN_RESPONSE)
  listPendingApplications(
    // Declared for the ValidationPipe and the contract only: ?status takes only pending, the queue.
    @Query() _query: ListApplicationsQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<PendingApplicationsResponseDto> {
    return this.applicationsService.listPending(actor);
  }

  @Patch(":id/approve")
  @RequirePermission(Permission.ASSIGNMENTS_REVIEW)
  @ApiParam(APPLICATION_ID_PARAM)
  @ApiOkResponse({
    type: LessonAssignmentResponseDto,
    description:
      "The application, now a confirmed assignment, with reviewedById and reviewedAt. Approving one that is already confirmed changes nothing and answers the same.",
  })
  @ApiForbiddenResponse(FORBIDDEN_RESPONSE)
  @ApiNotFoundResponse(APPLICATION_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: "APPLICATION_NOT_PENDING | LESSON_CANCELLED | MEMBER_INACTIVE | ROLE_FULL",
  })
  approveApplication(
    @Param("id", APPLICATION_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonAssignmentResponseDto> {
    return this.applicationsService.approve(id, actor.id);
  }

  @Patch(":id/reject")
  @RequirePermission(Permission.ASSIGNMENTS_REVIEW)
  @ApiParam(APPLICATION_ID_PARAM)
  @ApiOkResponse({
    type: LessonAssignmentResponseDto,
    description:
      "The application, now declined, with reviewedById and reviewedAt. The place of the member in the lesson is free again. Declining one that is already declined changes nothing and answers the same.",
  })
  @ApiForbiddenResponse(FORBIDDEN_RESPONSE)
  @ApiNotFoundResponse(APPLICATION_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({ type: ApiErrorDto, description: "APPLICATION_NOT_PENDING" })
  rejectApplication(
    @Param("id", APPLICATION_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonAssignmentResponseDto> {
    return this.applicationsService.reject(id, actor.id);
  }
}
