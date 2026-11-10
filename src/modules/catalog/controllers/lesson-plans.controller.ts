import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { ArchiveDto } from "@shared/dto/archive.dto";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { CreateLessonPlanDto } from "../dto/create-lesson-plan.dto";
import { LessonPlanDetailDto } from "../dto/lesson-plan-detail.response.dto";
import { LessonPlanUsageQueryDto } from "../dto/lesson-plan-usage-query.dto";
import { LessonPlanUsageResponseDto } from "../dto/lesson-plan-usage.response.dto";
import { LessonPlanResponseDto } from "../dto/lesson-plan.response.dto";
import { UpdateLessonPlanDto } from "../dto/update-lesson-plan.dto";
import { LessonPlanUsageService } from "../services/lesson-plan-usage.service";
import { LessonPlansService, lessonPlanNotFound } from "../services/lesson-plans.service";

const LESSON_PLAN_ID = new ParseUUIDPipe({ exceptionFactory: () => lessonPlanNotFound() });

const LESSON_PLAN_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "LESSON_PLAN_NOT_FOUND" };

const LESSON_PLAN_ID_PARAM = { name: "id", format: "uuid", description: "Id of the lesson plan." };

@ApiTags("catalog")
@Controller("lesson-plans")
@ApiStandardErrors()
export class LessonPlansController {
  constructor(
    private readonly lessonPlansService: LessonPlansService,
    private readonly lessonPlanUsageService: LessonPlanUsageService,
  ) {}

  @Post()
  @RequirePermission(Permission.LESSON_PLANS_MANAGE)
  @ApiCreatedResponse({ type: LessonPlanResponseDto })
  createLessonPlan(
    @Body() dto: CreateLessonPlanDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonPlanResponseDto> {
    return this.lessonPlansService.create(dto, actor.id);
  }

  @Get(":id")
  @RequirePermission(Permission.CATALOG_VIEW)
  @ApiParam(LESSON_PLAN_ID_PARAM)
  @ApiOkResponse({ type: LessonPlanDetailDto })
  @ApiNotFoundResponse(LESSON_PLAN_NOT_FOUND_RESPONSE)
  getLessonPlan(@Param("id", LESSON_PLAN_ID) id: string): Promise<LessonPlanDetailDto> {
    return this.lessonPlanUsageService.getDetail(id);
  }

  @Get(":id/usage")
  @RequirePermission(Permission.CATALOG_VIEW)
  @ApiParam(LESSON_PLAN_ID_PARAM)
  @ApiOkResponse({ type: LessonPlanUsageResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiNotFoundResponse(LESSON_PLAN_NOT_FOUND_RESPONSE)
  getLessonPlanUsage(
    @Param("id", LESSON_PLAN_ID) id: string,
    @Query() query: LessonPlanUsageQueryDto,
  ): Promise<LessonPlanUsageResponseDto> {
    return this.lessonPlanUsageService.getUsage(id, query.expectedDurationMinutes);
  }

  @Patch(":id")
  @RequirePermission(Permission.LESSON_PLANS_MANAGE)
  @ApiParam(LESSON_PLAN_ID_PARAM)
  @ApiOkResponse({ type: LessonPlanResponseDto })
  @ApiNotFoundResponse(LESSON_PLAN_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({ type: ApiErrorDto, description: "LESSON_PLAN_ARCHIVED" })
  updateLessonPlan(
    @Param("id", LESSON_PLAN_ID) id: string,
    @Body() dto: UpdateLessonPlanDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonPlanResponseDto> {
    return this.lessonPlansService.update(id, dto, actor.id);
  }

  @Patch(":id/archive")
  @RequirePermission(Permission.LESSON_PLANS_MANAGE)
  @ApiParam(LESSON_PLAN_ID_PARAM)
  @ApiBody({ type: ArchiveDto, required: false })
  @ApiOkResponse({ type: LessonPlanResponseDto })
  @ApiNotFoundResponse(LESSON_PLAN_NOT_FOUND_RESPONSE)
  archiveLessonPlan(
    @Param("id", LESSON_PLAN_ID) id: string,
    @Body() dto: ArchiveDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonPlanResponseDto> {
    return this.lessonPlansService.archive(id, dto, actor.id);
  }

  @Patch(":id/unarchive")
  @RequirePermission(Permission.LESSON_PLANS_MANAGE)
  @ApiParam(LESSON_PLAN_ID_PARAM)
  @ApiOkResponse({ type: LessonPlanResponseDto })
  @ApiNotFoundResponse(LESSON_PLAN_NOT_FOUND_RESPONSE)
  unarchiveLessonPlan(
    @Param("id", LESSON_PLAN_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonPlanResponseDto> {
    return this.lessonPlansService.unarchive(id, actor.id);
  }
}
