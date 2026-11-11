import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
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
import { ClassResponseDto } from "../dto/class.response.dto";
import { CreateClassDto } from "../dto/create-class.dto";
import { UpdateClassDto } from "../dto/update-class.dto";
import { ClassesService, classNotFound } from "../services/classes.service";

const CLASS_ID = new ParseUUIDPipe({ exceptionFactory: () => classNotFound() });

const CLASS_ID_PARAM = { name: "id", format: "uuid", description: "Id of the class." };

const CLASS_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "CLASS_NOT_FOUND" };

/**
 * Classes (turmas): create, edit, archive and unarchive. Every route needs classes.manage
 * (director, coordinator and superadmin); a member answers 403. There is no DELETE (RN-27), and the
 * listing and the detail are other cards (GUS-103 and GUS-104).
 */
@ApiTags("classes")
@Controller("classes")
@ApiStandardErrors()
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Post()
  @RequirePermission(Permission.CLASSES_MANAGE)
  @ApiCreatedResponse({ type: ClassResponseDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | INVALID_PERIOD | COURSE_NOT_FOUND",
  })
  @ApiConflictResponse({ type: ApiErrorDto, description: "CLASS_CODE_TAKEN" })
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
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED | INVALID_PERIOD" })
  @ApiNotFoundResponse(CLASS_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      "CLASS_ARCHIVED | CLASS_CODE_TAKEN | CAPACITY_BELOW_ENROLLED (the last one from GUS-108, when enrollments exist)",
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
    description: "CLASS_HAS_ACTIVE_ENROLLMENTS (from GUS-108, when enrollments exist)",
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
}
