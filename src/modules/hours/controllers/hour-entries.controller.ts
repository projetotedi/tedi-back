import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
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
import { ApiOkResponsePaginated } from "@shared/pagination/api-paginated-response.decorator";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { AdjustHourEntryDto } from "../dto/adjust-hour-entry.dto";
import { HourEntryEventResponseDto } from "../dto/hour-entry-event.response.dto";
import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { ListHourEntriesQueryDto } from "../dto/list-hour-entries-query.dto";
import { MemberHourEntryResponseDto } from "../dto/member-hour-entry.response.dto";
import { RejectHourEntryDto } from "../dto/reject-hour-entry.dto";
import { ValidateHourEntriesDto } from "../dto/validate-hour-entries.dto";
import { hourEntryNotFound } from "../services/hour-entry-errors";
import { HoursReviewService } from "../services/hours-review.service";
import { HoursViewService } from "../services/hours-view.service";

/** A malformed id is an entry that does not exist, so it answers the same 404 as an unknown one. */
const HOUR_ENTRY_ID = new ParseUUIDPipe({ exceptionFactory: () => hourEntryNotFound() });

const REVIEW_FORBIDDEN =
  "FORBIDDEN: a director or a member (hours.review is only for coordination and the superadmin).";

/**
 * The hour entries of the team (E7, GUS-164):
 * - the queue of validation, with hours.viewOthers (a director reads her department);
 * - the review (validate a batch, adjust, reject), only with hours.review, which the AuthGuard
 *   decides (`all` or `none`);
 * - the history of an entry, for its person and for hours.viewOthers within its scope.
 *
 * There is still no route that edits the declared fields of an entry.
 */
@ApiTags("hours")
@Controller("hour-entries")
@ApiStandardErrors()
export class HourEntriesController {
  constructor(
    private readonly viewService: HoursViewService,
    private readonly reviewService: HoursReviewService,
  ) {}

  @Get()
  @RequirePermission(Permission.HOURS_VIEW_OTHERS)
  @ApiOkResponsePaginated(MemberHourEntryResponseDto)
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED | INVALID_PERIOD" })
  @ApiForbiddenResponse({
    type: ApiErrorDto,
    description:
      "FORBIDDEN: a member (hours.viewOthers). A director without department gets an empty page.",
  })
  listPendingHourEntries(
    @Query() query: ListHourEntriesQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<PaginatedResult<MemberHourEntryResponseDto>> {
    return this.viewService.listEntries(actor, query);
  }

  @Patch("validate")
  @RequirePermission(Permission.HOURS_REVIEW)
  @ApiOkResponse({
    type: HourEntryResponseDto,
    isArray: true,
    description:
      "The entries, approved with their declared minutes, in the order of the body. All of them or none.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description:
      "VALIDATION_FAILED | DUPLICATE_HOUR_ENTRY | HOUR_ENTRY_NOT_FOUND (unknown or removed). The last two with details[].field = ids.<i>.",
  })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: REVIEW_FORBIDDEN })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      "SELF_REVIEW_NOT_ALLOWED | ENTRY_NOT_PENDING, with details[].field = ids.<i>. Nothing is validated.",
  })
  validateHourEntries(
    @Body() dto: ValidateHourEntriesDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<HourEntryResponseDto[]> {
    return this.reviewService.validateEntries(dto, actor);
  }

  @Patch(":id/adjust")
  @RequirePermission(Permission.HOURS_REVIEW)
  @ApiParam({ name: "id", format: "uuid", description: "Id of a pending hour entry." })
  @ApiOkResponse({
    type: HourEntryResponseDto,
    description:
      "The entry, adjusted: the new validated minutes, the declared ones kept and the justification as reviewNote.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | ADJUSTED_MINUTES_UNCHANGED",
  })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: REVIEW_FORBIDDEN })
  @ApiNotFoundResponse({
    type: ApiErrorDto,
    description: "HOUR_ENTRY_NOT_FOUND: malformed, unknown or removed.",
  })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: "SELF_REVIEW_NOT_ALLOWED | ENTRY_NOT_PENDING",
  })
  adjustHourEntry(
    @Param("id", HOUR_ENTRY_ID) id: string,
    @Body() dto: AdjustHourEntryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<HourEntryResponseDto> {
    return this.reviewService.adjustEntry(id, dto, actor);
  }

  @Patch(":id/reject")
  @RequirePermission(Permission.HOURS_REVIEW)
  @ApiParam({ name: "id", format: "uuid", description: "Id of a pending hour entry." })
  @ApiOkResponse({
    type: HourEntryResponseDto,
    description:
      "The entry, rejected: 0 validated minutes, out of the bank of hours, the reason as reviewNote.",
  })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: REVIEW_FORBIDDEN })
  @ApiNotFoundResponse({
    type: ApiErrorDto,
    description: "HOUR_ENTRY_NOT_FOUND: malformed, unknown or removed.",
  })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: "SELF_REVIEW_NOT_ALLOWED | ENTRY_NOT_PENDING",
  })
  rejectHourEntry(
    @Param("id", HOUR_ENTRY_ID) id: string,
    @Body() dto: RejectHourEntryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<HourEntryResponseDto> {
    return this.reviewService.rejectEntry(id, dto, actor);
  }

  @Get(":id/history")
  @RequirePermission(Permission.ACCOUNT_MANAGE_OWN)
  @ApiParam({ name: "id", format: "uuid", description: "Id of an hour entry, removed included." })
  @ApiOkResponse({
    type: HourEntryEventResponseDto,
    isArray: true,
    description:
      "Every row of the history, oldest first (created, approved, adjusted, rejected, removed), with who and when.",
  })
  @ApiNotFoundResponse({
    type: ApiErrorDto,
    description: "HOUR_ENTRY_NOT_FOUND: malformed or unknown. A removed entry keeps its history.",
  })
  @ApiForbiddenResponse({
    type: ApiErrorDto,
    description:
      "FORBIDDEN_SCOPE: someone else's entry without hours.viewOthers, or outside its scope.",
  })
  getHourEntryHistory(
    @Param("id", HOUR_ENTRY_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<HourEntryEventResponseDto[]> {
    return this.viewService.getHistory(id, actor);
  }
}
