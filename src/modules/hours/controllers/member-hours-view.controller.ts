import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
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
import { HoursPageQueryDto } from "../dto/hours-page-query.dto";
import { MemberHoursResponseDto } from "../dto/member-hours.response.dto";
import { memberNotFound } from "../services/hour-entry-errors";
import { HoursViewService } from "../services/hours-view.service";

/** A malformed id is a member that does not exist, so it answers the same 404 as an unknown one. */
const MEMBER_ID = new ParseUUIDPipe({ exceptionFactory: () => memberNotFound() });

/**
 * The hours of one member (GUS-164), with hours.viewOthers: a director for a member of her own
 * department, coordination and the superadmin for anyone. A controller of its own, apart from the
 * logging on behalf of a member (MemberHoursController), which only writes.
 */
@ApiTags("hours")
@Controller("members")
@ApiStandardErrors()
export class MemberHoursViewController {
  constructor(private readonly viewService: HoursViewService) {}

  @Get(":id/hours")
  @RequirePermission(Permission.HOURS_VIEW_OTHERS)
  @ApiParam({ name: "id", format: "uuid", description: "Id of the member (the person)." })
  @ApiOkResponse({ type: MemberHoursResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED | INVALID_PERIOD" })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: "FORBIDDEN | FORBIDDEN_SCOPE" })
  @ApiNotFoundResponse({
    type: ApiErrorDto,
    description:
      "MEMBER_NOT_FOUND: malformed or unknown id, a deleted person, or a person with neither an access role nor a member registration (a student).",
  })
  getMemberHours(
    @Param("id", MEMBER_ID) id: string,
    @Query() query: HoursPageQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<MemberHoursResponseDto> {
    return this.viewService.getMemberHours(id, actor, query);
  }
}
