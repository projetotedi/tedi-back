import { Body, Controller, Param, Patch, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
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
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { CourseResponseDto } from "../dto/course.response.dto";
import { CreateCourseDto } from "../dto/create-course.dto";
import { UpdateCourseDto } from "../dto/update-course.dto";
import { CoursesService } from "../services/courses.service";
import { COURSE_ID, COURSE_ID_PARAM } from "./course-id.param";

@ApiTags("catalog")
@Controller("courses")
@ApiStandardErrors()
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  @RequirePermission(Permission.COURSES_MANAGE)
  @ApiCreatedResponse({ type: CourseResponseDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | PREREQUISITE_NOT_FOUND | PREREQUISITE_ARCHIVED",
  })
  @ApiConflictResponse({ type: ApiErrorDto, description: "COURSE_NAME_TAKEN" })
  createCourse(
    @Body() dto: CreateCourseDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<CourseResponseDto> {
    return this.coursesService.create(dto, actor.id);
  }

  @Patch(":id")
  @RequirePermission(Permission.COURSES_MANAGE)
  @ApiParam(COURSE_ID_PARAM)
  @ApiOkResponse({ type: CourseResponseDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description:
      "VALIDATION_FAILED | PREREQUISITE_NOT_FOUND | PREREQUISITE_ARCHIVED | PREREQUISITE_CYCLE",
  })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "COURSE_NOT_FOUND" })
  @ApiConflictResponse({ type: ApiErrorDto, description: "COURSE_ARCHIVED | COURSE_NAME_TAKEN" })
  updateCourse(
    @Param("id", COURSE_ID) id: string,
    @Body() dto: UpdateCourseDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<CourseResponseDto> {
    return this.coursesService.update(id, dto, actor.id);
  }
}
