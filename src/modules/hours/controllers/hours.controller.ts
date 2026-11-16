import { Controller, Get, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { HoursOverviewQueryDto } from "../dto/hours-overview-query.dto";
import { HoursOverviewResponseDto } from "../dto/hours-overview.response.dto";
import { HoursViewService } from "../services/hours-view.service";

/**
 * The bank of hours of the team (E7, GUS-164), with hours.viewOthers: a director reads her current
 * department, coordination and the superadmin everyone, filtered in the query. A member answers
 * 403 FORBIDDEN.
 */
@ApiTags("hours")
@Controller("hours")
@ApiStandardErrors()
export class HoursController {
  constructor(private readonly viewService: HoursViewService) {}

  @Get("overview")
  @RequirePermission(Permission.HOURS_VIEW_OTHERS)
  @ApiOkResponse({ type: HoursOverviewResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED | INVALID_PERIOD" })
  @ApiForbiddenResponse({
    type: ApiErrorDto,
    description:
      "FORBIDDEN: a member (hours.viewOthers). A director without department gets an empty overview.",
  })
  getHoursOverview(
    @Query() query: HoursOverviewQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<HoursOverviewResponseDto> {
    return this.viewService.getOverview(actor, query);
  }
}
