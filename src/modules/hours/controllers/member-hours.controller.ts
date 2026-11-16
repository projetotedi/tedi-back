import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import { CreateHourEntryDto } from "../dto/create-hour-entry.dto";
import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { memberNotFound } from "../services/hour-entry-errors";
import { HoursService } from "../services/hours.service";

/** A malformed id is a member that does not exist, so it answers the same 404 as an unknown one. */
const MEMBER_ID = new ParseUUIDPipe({ exceptionFactory: () => memberNotFound() });

/**
 * Hours logged on behalf of a member (hours.logForOthers): a director for a member of her own
 * department, coordination and the superadmin for any member. A member answers 403 FORBIDDEN.
 * The scope is checked in the service with the PermissionPolicy.
 */
@ApiTags("hours")
@Controller("members")
@ApiStandardErrors()
export class MemberHoursController {
  constructor(private readonly hoursService: HoursService) {}

  @Post(":id/hour-entries")
  @RequirePermission(Permission.HOURS_LOG_FOR_OTHERS)
  @ApiParam({
    name: "id",
    format: "uuid",
    description: "Id of the member (the person) the hours are for.",
  })
  @ApiCreatedResponse({
    type: HourEntryResponseDto,
    description: "The entry of the member, pending and on_behalf, with createdById = the actor.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | SELF_ON_BEHALF_NOT_ALLOWED | HOUR_ENTRY_DATE_IN_FUTURE",
  })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: "FORBIDDEN | FORBIDDEN_SCOPE" })
  @ApiNotFoundResponse({
    type: ApiErrorDto,
    description:
      "MEMBER_NOT_FOUND: malformed or unknown id, or a person without an approved member registration.",
  })
  logHoursForMember(
    @Param("id", MEMBER_ID) id: string,
    @Body() dto: CreateHourEntryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<HourEntryResponseDto> {
    return this.hoursService.logHoursForMember(id, dto, actor);
  }
}
