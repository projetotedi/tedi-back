import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from "@nestjs/common";
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
import { ConfirmMemberAttendanceDto } from "../dto/confirm-member-attendance.dto";
import { MemberAttendanceResponseDto } from "../dto/member-attendance.response.dto";
import { lessonNotFound } from "../services/attendance-errors";
import { MemberAttendanceService } from "../services/member-attendance.service";

/** A malformed id is a lesson that does not exist, so it answers the same 404 as an unknown one. */
const LESSON_ID = new ParseUUIDPipe({ exceptionFactory: () => lessonNotFound() });

const LESSON_ID_PARAM = { name: "id", format: "uuid", description: "Id of the lesson." };

const LESSON_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "LESSON_NOT_FOUND" };

/**
 * The attendance of the members of a lesson (F6.2): its confirmed teacher and monitors, and whether
 * each one was there. Reading needs lessons.view (every profile), the same permission as reading
 * the lesson and its assignments, with no free text and no personal data beyond the names.
 *
 * Signing needs attendance.confirmMember, which every profile has; its scope is resolved by the
 * service, entry by entry: a member only in the lesson she is the confirmed teacher of, a director
 * and coordination in every lesson, and nobody for her own attendance (403
 * SELF_ATTENDANCE_NOT_ALLOWED, in every profile). Changing a signed attendance also needs
 * attendance.correct (directors and coordination). The history of a member is
 * `GET /members/:id/attendance`, another controller of this module, because the resource of the URL
 * is another one.
 */
@ApiTags("attendance")
@Controller("lessons/:id/attendance/members")
@ApiStandardErrors()
export class LessonMemberAttendanceController {
  constructor(private readonly memberAttendanceService: MemberAttendanceService) {}

  @Get()
  @RequirePermission(Permission.LESSONS_VIEW)
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({
    type: MemberAttendanceResponseDto,
    isArray: true,
    description:
      "The confirmed assignments of the lesson, the teacher first, each with the attendance of its member, who signed it and the hour entry it generated. An attendance not signed yet has status, confirmedBy, confirmedAt and hourEntryId null. Not paginated.",
  })
  @ApiNotFoundResponse(LESSON_NOT_FOUND_RESPONSE)
  listMemberAttendance(
    @Param("id", LESSON_ID) lessonId: string,
  ): Promise<MemberAttendanceResponseDto[]> {
    return this.memberAttendanceService.listByLesson(lessonId);
  }

  @Put()
  @RequirePermission(Permission.ATTENDANCE_CONFIRM_MEMBER)
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({
    type: MemberAttendanceResponseDto,
    isArray: true,
    description:
      "The attendance of the lesson after the commit, the same list as the GET. All or none: any error writes nothing.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | DUPLICATE_ASSIGNMENT | ASSIGNMENT_NOT_CONFIRMED",
  })
  @ApiForbiddenResponse({
    type: ApiErrorDto,
    description: "FORBIDDEN | FORBIDDEN_SCOPE | SELF_ATTENDANCE_NOT_ALLOWED",
  })
  @ApiNotFoundResponse(LESSON_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({ type: ApiErrorDto, description: "LESSON_CANCELLED | LESSON_IN_FUTURE" })
  confirmMemberAttendance(
    @Param("id", LESSON_ID) lessonId: string,
    @Body() dto: ConfirmMemberAttendanceDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<MemberAttendanceResponseDto[]> {
    return this.memberAttendanceService.confirm(lessonId, dto, actor);
  }
}
