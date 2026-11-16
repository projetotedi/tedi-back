import { Controller, Param, ParseUUIDPipe, Patch } from "@nestjs/common";
import {
  ApiConflictResponse,
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
import { assignmentNotFound } from "../services/assignment-errors";
import { AssignmentsService } from "../services/assignments.service";

/** A malformed id is an assignment that does not exist, so it answers the same 404 as an unknown one. */
const ASSIGNMENT_ID = new ParseUUIDPipe({ exceptionFactory: () => assignmentNotFound() });

const ASSIGNMENT_ID_PARAM = { name: "id", format: "uuid", description: "Id of the assignment." };

const ASSIGNMENT_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "ASSIGNMENT_NOT_FOUND" };

/**
 * Decisions about an assignment that exists: confirm it and cancel it. Both need
 * assignments.create (director, coordinator and superadmin), and a member answers 403. There is no
 * DELETE: a cancelled assignment stays, with who cancelled it and when. Refusing a pending
 * assignment (declined) and approving an application are the review of the applications (GUS-160).
 *
 * Both answer the same LessonAssignmentResponseDto as the creation, so the client has one type.
 */
@ApiTags("assignments")
@Controller("assignments")
@ApiStandardErrors()
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Patch(":id/confirm")
  @RequirePermission(Permission.ASSIGNMENTS_CREATE)
  @ApiParam(ASSIGNMENT_ID_PARAM)
  @ApiOkResponse({
    type: LessonAssignmentResponseDto,
    description:
      "The assignment, now confirmed, with reviewedById and reviewedAt. Confirming one that is already confirmed changes nothing and answers the same.",
  })
  @ApiNotFoundResponse(ASSIGNMENT_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      "ASSIGNMENT_NOT_PENDING | LESSON_CANCELLED | MEMBER_INACTIVE | LESSON_TEACHER_TAKEN",
  })
  confirmAssignment(
    @Param("id", ASSIGNMENT_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonAssignmentResponseDto> {
    return this.assignmentsService.confirm(id, actor.id);
  }

  @Patch(":id/cancel")
  @RequirePermission(Permission.ASSIGNMENTS_CREATE)
  @ApiParam(ASSIGNMENT_ID_PARAM)
  @ApiOkResponse({
    type: LessonAssignmentResponseDto,
    description:
      "The assignment, now cancelled, with cancelledById and cancelledAt. It stays: the member can be assigned to the lesson again. Cancelling one that is already cancelled changes nothing and answers the same, with the first instant.",
  })
  @ApiNotFoundResponse(ASSIGNMENT_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({ type: ApiErrorDto, description: "ASSIGNMENT_NOT_ACTIVE" })
  cancelAssignment(
    @Param("id", ASSIGNMENT_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonAssignmentResponseDto> {
    return this.assignmentsService.cancel(id, actor.id);
  }
}
