import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import {
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
import { MemberAssignmentResponseDto } from "../dto/member-assignment.response.dto";
import { memberNotFound } from "../services/assignment-errors";
import { AssignmentsService } from "../services/assignments.service";

/** A malformed id is a member that does not exist, so it answers the same 404 as an unknown one. */
const MEMBER_ID = new ParseUUIDPipe({ exceptionFactory: () => memberNotFound() });

const MEMBER_ID_PARAM = { name: "id", format: "uuid", description: "Person id of the member." };

/**
 * The assignments of a member, the lessons she teaches or monitors. It lives in this module, not in
 * `people`, because `people` knows nothing of lessons; the route is under `/members/:id` because
 * the resource of the URL is the member. It needs members.view, as the member record does:
 * coordination and superadmin read any member, a director only a member of the own department
 * (403 FORBIDDEN_SCOPE otherwise), and a member has no access (403 FORBIDDEN). The "my lessons" of
 * the member herself is another card (GUS-160).
 */
@ApiTags("assignments")
@Controller("members/:id/assignments")
@ApiStandardErrors()
export class MemberAssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Get()
  @RequirePermission(Permission.MEMBERS_VIEW)
  @ApiParam(MEMBER_ID_PARAM)
  @ApiOkResponse({
    type: MemberAssignmentResponseDto,
    isArray: true,
    description:
      "Every assignment of the member, whatever its status, each with its lesson (id, title, day, times and status), the latest lesson first. Not paginated.",
  })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: "FORBIDDEN | FORBIDDEN_SCOPE" })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "MEMBER_NOT_FOUND" })
  listMemberAssignments(
    @Param("id", MEMBER_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<MemberAssignmentResponseDto[]> {
    return this.assignmentsService.listByMember(id, actor);
  }
}
