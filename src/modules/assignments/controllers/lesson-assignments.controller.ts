import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { CreateAssignmentDto } from "../dto/create-assignment.dto";
import { LessonAssignmentResponseDto } from "../dto/lesson-assignment.response.dto";
import { lessonNotFound } from "../services/assignment-errors";
import { AssignmentsService } from "../services/assignments.service";

/** A malformed id is a lesson that does not exist, so it answers the same 404 as an unknown one. */
const LESSON_ID = new ParseUUIDPipe({ exceptionFactory: () => lessonNotFound() });

const LESSON_ID_PARAM = { name: "id", format: "uuid", description: "Id of the lesson." };

const LESSON_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "LESSON_NOT_FOUND" };

/**
 * The assignments of a lesson: assign a member to it and list who is assigned. Assigning needs
 * assignments.create (director, coordinator and superadmin), and a member answers 403 on it;
 * listing needs lessons.view (every profile), the same permission as reading the lesson. The scope
 * is only all or none, so the guard decides and the service needs no policy.
 *
 * Confirming and cancelling an assignment are `PATCH /assignments/:id/...`, and the assignments of
 * a member are `GET /members/:id/assignments`: other controllers of this module, because the
 * resource of the URL is another one.
 */
@ApiTags("assignments")
@Controller("lessons/:id/assignments")
@ApiStandardErrors()
export class LessonAssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Post()
  @RequirePermission(Permission.ASSIGNMENTS_CREATE)
  @ApiParam(LESSON_ID_PARAM)
  @ApiCreatedResponse({
    type: LessonAssignmentResponseDto,
    description:
      "The assignment, direct and pending or confirmed as the body asked. With confirmed, reviewedById is the actor and reviewedAt is now.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | MEMBER_NOT_FOUND",
  })
  @ApiNotFoundResponse(LESSON_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      "LESSON_CANCELLED | MEMBER_INACTIVE | DUPLICATE_ROLE_IN_LESSON | LESSON_TEACHER_TAKEN",
  })
  createAssignment(
    @Param("id", LESSON_ID) lessonId: string,
    @Body() dto: CreateAssignmentDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonAssignmentResponseDto> {
    return this.assignmentsService.create(lessonId, dto, actor.id);
  }

  @Get()
  @RequirePermission(Permission.LESSONS_VIEW)
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({
    type: LessonAssignmentResponseDto,
    isArray: true,
    description:
      "Every assignment of the lesson, whatever its status, ordered by role (teacher first), status, when it was made and id. Not paginated.",
  })
  @ApiNotFoundResponse(LESSON_NOT_FOUND_RESPONSE)
  listLessonAssignments(
    @Param("id", LESSON_ID) lessonId: string,
  ): Promise<LessonAssignmentResponseDto[]> {
    return this.assignmentsService.listByLesson(lessonId);
  }
}
