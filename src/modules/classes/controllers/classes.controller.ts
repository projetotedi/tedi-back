import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
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
import { ClassDetailDto } from "../dto/class-detail.response.dto";
import { ClassResponseDto } from "../dto/class.response.dto";
import { CreateClassDto } from "../dto/create-class.dto";
import { UpdateClassDto } from "../dto/update-class.dto";
import { ClassDetailService } from "../services/class-detail.service";
import { ClassesService, classNotFound } from "../services/classes.service";

const CLASS_ID = new ParseUUIDPipe({ exceptionFactory: () => classNotFound() });

const CLASS_ID_PARAM = { name: "id", format: "uuid", description: "Id of the class." };

const CLASS_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "CLASS_NOT_FOUND" };

/**
 * Classes (turmas): the sheet of a class, and create, edit, archive and unarchive. The four
 * mutations need classes.manage (director, coordinator and superadmin); a member answers 403. The
 * sheet, `GET /classes/:id`, needs classes.view, which every role has. There is no DELETE (RN-27),
 * and the listing is another card (GUS-103). Every answer carries the course of the class, with the
 * category it has now (RN-14). The edit takes a `courseId` too, which moves the class to another
 * course only while it is planned and has no enrollments (RN-13).
 *
 * `ClassesModule` registers this controller after `CourseClassesController`, so the `:id` of the
 * sheet never captures `GET /classes/summary-by-course`: any new literal route under `/classes/`
 * goes there, or before `:id`.
 */
@ApiTags("classes")
@Controller("classes")
@ApiStandardErrors()
export class ClassesController {
  constructor(
    private readonly classesService: ClassesService,
    private readonly classDetailService: ClassDetailService,
  ) {}

  @Post()
  @RequirePermission(Permission.CLASSES_MANAGE)
  @ApiCreatedResponse({ type: ClassResponseDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | INVALID_PERIOD | COURSE_NOT_FOUND",
  })
  @ApiConflictResponse({ type: ApiErrorDto, description: "COURSE_ARCHIVED | CLASS_CODE_TAKEN" })
  createClass(
    @Body() dto: CreateClassDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClassResponseDto> {
    return this.classesService.create(dto, actor.id);
  }

  @Patch(":id")
  @RequirePermission(Permission.CLASSES_MANAGE)
  @ApiParam(CLASS_ID_PARAM)
  @ApiOkResponse({ type: ClassResponseDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | INVALID_PERIOD | COURSE_NOT_FOUND",
  })
  @ApiNotFoundResponse(CLASS_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      "CLASS_ARCHIVED | COURSE_CHANGE_NOT_ALLOWED | COURSE_ARCHIVED | CLASS_CODE_TAKEN | CAPACITY_BELOW_ENROLLED",
  })
  updateClass(
    @Param("id", CLASS_ID) id: string,
    @Body() dto: UpdateClassDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClassResponseDto> {
    return this.classesService.update(id, dto, actor.id);
  }

  @Patch(":id/archive")
  @RequirePermission(Permission.CLASSES_MANAGE)
  @ApiParam(CLASS_ID_PARAM)
  @ApiBody({ type: ArchiveDto, required: false })
  @ApiOkResponse({ type: ClassResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiNotFoundResponse(CLASS_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: "CLASS_HAS_ACTIVE_ENROLLMENTS",
  })
  archiveClass(
    @Param("id", CLASS_ID) id: string,
    @Body() dto: ArchiveDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClassResponseDto> {
    return this.classesService.archive(id, dto, actor.id);
  }

  @Patch(":id/unarchive")
  @RequirePermission(Permission.CLASSES_MANAGE)
  @ApiParam(CLASS_ID_PARAM)
  @ApiOkResponse({ type: ClassResponseDto })
  @ApiNotFoundResponse(CLASS_NOT_FOUND_RESPONSE)
  unarchiveClass(
    @Param("id", CLASS_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ClassResponseDto> {
    return this.classesService.unarchive(id, actor.id);
  }

  // Declared after the mutations on purpose. The shared ClassStatus schema of the contract takes its
  // description from the first property that uses it, and `CreateClassDto.status` has to stay that
  // one (see there): a handler declared above `createClass` would hand the name to ClassDetailDto.
  @Get(":id")
  @RequirePermission(Permission.CLASSES_VIEW)
  @ApiParam(CLASS_ID_PARAM)
  @ApiOkResponse({ type: ClassDetailDto })
  @ApiNotFoundResponse(CLASS_NOT_FOUND_RESPONSE)
  getClass(@Param("id", CLASS_ID) id: string): Promise<ClassDetailDto> {
    return this.classDetailService.findDetail(id);
  }
}
