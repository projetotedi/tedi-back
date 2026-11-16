import { Body, Controller, Param, ParseUUIDPipe, Patch } from "@nestjs/common";
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
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { AdjustHourEntryDto } from "../dto/adjust-hour-entry.dto";
import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { RejectHourEntryDto } from "../dto/reject-hour-entry.dto";
import { ValidateHourEntriesDto } from "../dto/validate-hour-entries.dto";
import { hourEntryNotFound } from "../services/hour-entry-errors";
import { HoursReviewService } from "../services/hours-review.service";

/** A malformed id is an entry that does not exist, so it answers the same 404 as an unknown one. */
const HOUR_ENTRY_ID = new ParseUUIDPipe({ exceptionFactory: () => hourEntryNotFound() });

const REVIEW_FORBIDDEN =
  "FORBIDDEN: a director or a member (hours.review is only for coordination and the superadmin).";

/**
 * The hour entries of the team, for coordination (E7, GUS-164): the review (validate a batch,
 * adjust, reject), only with hours.review, which the AuthGuard decides (`all` or `none`). There is
 * still no route that edits the declared fields of an entry.
 */
@ApiTags("hours")
@Controller("hour-entries")
@ApiStandardErrors()
export class HourEntriesController {
  constructor(private readonly reviewService: HoursReviewService) {}

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
}
