import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Put } from "@nestjs/common";
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
import { HourCategoryNoteResponseDto } from "../dto/hour-category-note.response.dto";
import { SetHourCategoryNoteDto } from "../dto/set-hour-category-note.dto";
import { HourCategoryNotesService } from "../services/hour-category-notes.service";
import { memberNotFound } from "../services/hour-entry-errors";

/** A malformed id is a member that does not exist, so it answers the same 404 as an unknown one. */
const MEMBER_ID = new ParseUUIDPipe({ exceptionFactory: () => memberNotFound() });

/**
 * The observations of coordination on the hours of a member, one per category (GUS-173), read in
 * the summary of `GET /me/hours/summary` and `GET /members/:id/hours`.
 */
@ApiTags("hours")
@Controller("members")
@ApiStandardErrors()
export class MemberHourNotesController {
  constructor(private readonly notes: HourCategoryNotesService) {}

  @Put(":id/hours/notes")
  @HttpCode(200)
  @RequirePermission(Permission.HOURS_REVIEW)
  @ApiParam({ name: "id", format: "uuid", description: "Id of the member (the person)." })
  @ApiOkResponse({ type: HourCategoryNoteResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiForbiddenResponse({
    type: ApiErrorDto,
    description: "FORBIDDEN: hours.review, only coordination and the superadmin.",
  })
  @ApiNotFoundResponse({
    type: ApiErrorDto,
    description:
      "MEMBER_NOT_FOUND: malformed or unknown id, a deleted person, or a person with neither an access role nor a member registration (a student).",
  })
  setNote(
    @Param("id", MEMBER_ID) id: string,
    @Body() dto: SetHourCategoryNoteDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<HourCategoryNoteResponseDto> {
    return this.notes.setNote(id, dto, actor);
  }
}
