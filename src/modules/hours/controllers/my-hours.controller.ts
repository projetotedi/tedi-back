import { Body, Controller, Post } from "@nestjs/common";
import { ApiBadRequestResponse, ApiCreatedResponse, ApiTags } from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { CreateHourEntryDto } from "../dto/create-hour-entry.dto";
import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { HoursService } from "../services/hours.service";

/**
 * The hours of the logged-in person. Every profile has account.manageOwn, and the person is always
 * the one of the session: the service filters by her id in the query and never asks the
 * PermissionPolicy, whose scope `all` would let the superadmin reach anyone's entries.
 *
 * There is no route to edit an entry: one that was sent is removed (while pending) and logged again.
 */
@ApiTags("hours")
@Controller("me")
@ApiStandardErrors()
export class MyHoursController {
  constructor(private readonly hoursService: HoursService) {}

  @Post("hour-entries")
  @RequirePermission(Permission.ACCOUNT_MANAGE_OWN)
  @ApiCreatedResponse({
    type: HourEntryResponseDto,
    description: "The entry, pending and manual, logged by the person herself.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | HOUR_ENTRY_DATE_IN_FUTURE",
  })
  logMyHours(
    @Body() dto: CreateHourEntryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<HourEntryResponseDto> {
    return this.hoursService.logMyHours(dto, actor);
  }
}
