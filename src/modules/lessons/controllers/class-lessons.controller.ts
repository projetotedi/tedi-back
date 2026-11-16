import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
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
import { ClassLessonsPreviewResponseDto } from "../dto/class-lessons-preview.response.dto";
import { GenerateClassLessonsDto } from "../dto/generate-class-lessons.dto";
import { GeneratedClassLessonsResponseDto } from "../dto/generated-class-lessons.response.dto";
import { classNotFoundInPath } from "../services/lesson-errors";
import { LessonGenerationService } from "../services/lesson-generation.service";

/** A malformed id is a class that does not exist, so it answers the same 404 as an unknown one. */
const CLASS_ID = new ParseUUIDPipe({ exceptionFactory: () => classNotFoundInPath() });

const CLASS_ID_PARAM = { name: "id", format: "uuid", description: "Id of the class." };

const CLASS_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "CLASS_NOT_FOUND" };

const SERIES_CONFLICTS = "CLASS_ARCHIVED | LESSONS_ALREADY_GENERATED | COURSE_WITHOUT_SEQUENCE";

/**
 * The lessons of a class, generated from the sequence of lesson plans of its course (F4.2): a
 * preview of the series and its generation. Both need lessons.manage (director, coordinator and
 * superadmin), and a member answers 403. They take the same body, so the preview is exactly what
 * the generation would do: the coordination picks the day of the week, the time and the first date,
 * looks at the preview and generates. The class is the one of the URL.
 *
 * They live in their own controller because the class is the resource of the URL here
 * (`/classes/:id/lessons/...`), while `LessonsController` is the one of a lesson by its id.
 */
@ApiTags("lessons")
@Controller("classes/:id/lessons")
@ApiStandardErrors()
export class ClassLessonsController {
  constructor(private readonly generation: LessonGenerationService) {}

  @Post("preview")
  // A POST that creates nothing: it answers 200, not 201.
  @HttpCode(200)
  @RequirePermission(Permission.LESSONS_MANAGE)
  @ApiParam(CLASS_ID_PARAM)
  @ApiOkResponse({
    type: ClassLessonsPreviewResponseDto,
    description:
      "What generateClassLessons would create with the same body, without creating it: one lesson per active lesson plan of the sequence of the course, in order, with its day. A lesson outside the period of the class is marked (outsideClassPeriod), not refused. Writes nothing and emits no event.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | INVALID_TIME_RANGE",
  })
  @ApiNotFoundResponse(CLASS_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({ type: ApiErrorDto, description: SERIES_CONFLICTS })
  previewClassLessons(
    @Param("id", CLASS_ID) id: string,
    @Body() dto: GenerateClassLessonsDto,
  ): Promise<ClassLessonsPreviewResponseDto> {
    return this.generation.preview(id, dto);
  }

  @Post("generate")
  @RequirePermission(Permission.LESSONS_MANAGE)
  @ApiParam(CLASS_ID_PARAM)
  @ApiCreatedResponse({
    type: GeneratedClassLessonsResponseDto,
    description:
      "The lessons created, in the order of the sequence, all or none. Each one is planned and copies the title and the objective of its lesson plan (RN-18).",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | INVALID_TIME_RANGE",
  })
  @ApiNotFoundResponse(CLASS_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: `${SERIES_CONFLICTS} | LESSONS_OUTSIDE_CLASS_PERIOD`,
  })
  generateClassLessons(
    @Param("id", CLASS_ID) id: string,
    @Body() dto: GenerateClassLessonsDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<GeneratedClassLessonsResponseDto> {
    return this.generation.generate(id, dto, actor.id);
  }
}
