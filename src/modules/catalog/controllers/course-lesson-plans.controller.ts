import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
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
import { CourseLessonPlansResponseDto } from "../dto/course-lesson-plans.response.dto";
import { ReplaceCourseLessonPlansDto } from "../dto/replace-course-lesson-plans.dto";
import { CourseLessonPlansService } from "../services/course-lesson-plans.service";
import { COURSE_ID, COURSE_ID_PARAM } from "./course-id.param";

/** The sequence of lesson plans of a course (RF-014, RF-016) and the workload it adds up to. */
@ApiTags("catalog")
@Controller("courses")
@ApiStandardErrors()
export class CourseLessonPlansController {
  constructor(private readonly courseLessonPlansService: CourseLessonPlansService) {}

  @Get(":id/lesson-plans")
  @RequirePermission(Permission.CATALOG_VIEW)
  @ApiParam(COURSE_ID_PARAM)
  @ApiOkResponse({ type: CourseLessonPlansResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "COURSE_NOT_FOUND" })
  listCourseLessonPlans(@Param("id", COURSE_ID) id: string): Promise<CourseLessonPlansResponseDto> {
    return this.courseLessonPlansService.list(id);
  }

  @Put(":id/lesson-plans")
  @RequirePermission(Permission.COURSES_MANAGE)
  @ApiParam(COURSE_ID_PARAM)
  @ApiOkResponse({ type: CourseLessonPlansResponseDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description:
      "VALIDATION_FAILED | DUPLICATE_LESSON_PLAN | LESSON_PLAN_NOT_FOUND | LESSON_PLAN_ARCHIVED",
  })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "COURSE_NOT_FOUND" })
  @ApiConflictResponse({ type: ApiErrorDto, description: "COURSE_ARCHIVED" })
  replaceCourseLessonPlans(
    @Param("id", COURSE_ID) id: string,
    @Body() dto: ReplaceCourseLessonPlansDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<CourseLessonPlansResponseDto> {
    return this.courseLessonPlansService.replace(id, dto, actor.id);
  }
}
