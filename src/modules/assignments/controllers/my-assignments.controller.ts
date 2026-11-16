import { Controller, Get, Query } from "@nestjs/common";
import { ApiBadRequestResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { MyAssignmentsResponseDto } from "../dto/my-assignments.response.dto";
import { MyLessonsPeriodQueryDto } from "../dto/my-lessons-period-query.dto";
import { OpenLessonResponseDto } from "../dto/open-lesson.response.dto";
import { MyAssignmentsService } from "../services/my-assignments.service";

const PERIOD_ERRORS_RESPONSE = {
  type: ApiErrorDto,
  description: "VALIDATION_FAILED | INVALID_DATE_RANGE | DATE_RANGE_TOO_LONG",
};

/**
 * The agenda of the logged-in person (F5.5, GUS-160): "Minhas aulas" and the lessons with an open
 * place for her. Every profile has assignments.manageOwn, and the person is always the one of the
 * session: the service filters by her id in the query and never asks the PermissionPolicy (H4).
 * Both routes take the same period, so the screen asks them with the same query.
 */
@ApiTags("assignments")
@Controller("me")
@ApiStandardErrors()
export class MyAssignmentsController {
  constructor(private readonly myAssignmentsService: MyAssignmentsService) {}

  @Get("assignments")
  @RequirePermission(Permission.ASSIGNMENTS_MANAGE_OWN)
  @ApiOkResponse({
    type: MyAssignmentsResponseDto,
    description:
      "The lessons of the period (four weeks from today by default) where the member is assigned or applied, with the role and the latest status of each, and the totals of the top of the screen. No note.",
  })
  @ApiBadRequestResponse(PERIOD_ERRORS_RESPONSE)
  listMyAssignments(
    @Query() query: MyLessonsPeriodQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<MyAssignmentsResponseDto> {
    return this.myAssignmentsService.listMine(actor, query);
  }

  @Get("open-lessons")
  @RequirePermission(Permission.ASSIGNMENTS_MANAGE_OWN)
  @ApiOkResponse({
    type: OpenLessonResponseDto,
    isArray: true,
    description:
      "The lessons of the period, from today on and not done, that have an open place for some role and where the member holds no place, with the coverage and the open roles of each, soonest first. Not paginated.",
  })
  @ApiBadRequestResponse(PERIOD_ERRORS_RESPONSE)
  listOpenLessons(
    @Query() query: MyLessonsPeriodQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<OpenLessonResponseDto[]> {
    return this.myAssignmentsService.listOpen(actor, query);
  }
}
