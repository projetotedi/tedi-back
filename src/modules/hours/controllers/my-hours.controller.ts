import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { ApiOkResponsePaginated } from "@shared/pagination/api-paginated-response.decorator";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { CreateHourEntryDto } from "../dto/create-hour-entry.dto";
import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { HoursPeriodQueryDto } from "../dto/hours-period-query.dto";
import { HoursSummaryResponseDto } from "../dto/hours-summary.response.dto";
import { ListMyHourEntriesQueryDto } from "../dto/list-my-hour-entries-query.dto";
import { hourEntryNotFound } from "../services/hour-entry-errors";
import { HoursService } from "../services/hours.service";

/** A malformed id is an entry that does not exist, so it answers the same 404 as an unknown one. */
const HOUR_ENTRY_ID = new ParseUUIDPipe({ exceptionFactory: () => hourEntryNotFound() });

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

  @Get("hour-entries")
  @RequirePermission(Permission.ACCOUNT_MANAGE_OWN)
  @ApiOkResponsePaginated(HourEntryResponseDto)
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED | INVALID_PERIOD" })
  listMyHourEntries(
    @Query() query: ListMyHourEntriesQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<PaginatedResult<HourEntryResponseDto>> {
    return this.hoursService.listMyEntries(actor, query);
  }

  @Get("hours/summary")
  @RequirePermission(Permission.ACCOUNT_MANAGE_OWN)
  @ApiOkResponse({ type: HoursSummaryResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED | INVALID_PERIOD" })
  getMyHoursSummary(
    @Query() query: HoursPeriodQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<HoursSummaryResponseDto> {
    return this.hoursService.getMySummary(actor, query);
  }

  @Delete("hour-entries/:id")
  @HttpCode(204)
  @RequirePermission(Permission.ACCOUNT_MANAGE_OWN)
  @ApiParam({ name: "id", format: "uuid", description: "Id of an hour entry of the person." })
  @ApiNoContentResponse({
    description:
      "Removed: the entry leaves the statement and the summary, the row stays (soft delete) and its history gets a removed event.",
  })
  @ApiNotFoundResponse({
    type: ApiErrorDto,
    description: "HOUR_ENTRY_NOT_FOUND: malformed, unknown, of another person or already removed.",
  })
  @ApiConflictResponse({ type: ApiErrorDto, description: "ENTRY_NOT_PENDING" })
  removeMyHourEntry(
    @Param("id", HOUR_ENTRY_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<void> {
    return this.hoursService.removeMyEntry(id, actor);
  }
}
