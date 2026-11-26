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
import { MemberAttendanceHistoryResponseDto } from "../dto/member-attendance-history.response.dto";
import { memberNotFound } from "../services/attendance-errors";
import { MemberAttendanceHistoryService } from "../services/member-attendance-history.service";

/** A malformed id is a member that does not exist, so it answers the same 404 as an unknown one. */
const MEMBER_ID = new ParseUUIDPipe({ exceptionFactory: () => memberNotFound() });

const MEMBER_ID_PARAM = { name: "id", format: "uuid", description: "Person id of the member." };

/**
 * The attendance history of a member, for her record (F6.4): her presences and absences in the
 * lessons she was assigned to. It lives in this module, not in `people`, because `people` knows
 * nothing of lessons; the route is under `/members/:id` because the resource of the URL is the
 * member. It needs members.view, as the member record does: coordination and superadmin read any
 * member, a director only a member of the own department (403 FORBIDDEN_SCOPE otherwise), and a
 * member has no access (403 FORBIDDEN).
 */
@ApiTags("attendance")
@Controller("members/:id/attendance")
@ApiStandardErrors()
export class MemberAttendanceController {
  constructor(private readonly historyService: MemberAttendanceHistoryService) {}

  @Get()
  @RequirePermission(Permission.MEMBERS_VIEW)
  @ApiParam(MEMBER_ID_PARAM)
  @ApiOkResponse({
    type: MemberAttendanceHistoryResponseDto,
    description:
      "The presences and absences of the member, the latest lesson first, with the totals; cancelled lessons are left out of both. Not paginated.",
  })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: "FORBIDDEN | FORBIDDEN_SCOPE" })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "MEMBER_NOT_FOUND" })
  getMemberAttendanceHistory(
    @Param("id", MEMBER_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<MemberAttendanceHistoryResponseDto> {
    return this.historyService.getByMember(id, actor);
  }
}
