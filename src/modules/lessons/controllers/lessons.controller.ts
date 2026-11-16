import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
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
import { ApiOkResponsePaginated } from "@shared/pagination/api-paginated-response.decorator";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { LessonsCalendarQueryDto } from "../dto/calendar-query.dto";
import { CancelLessonDto } from "../dto/cancel-lesson.dto";
import { CreateLessonDto } from "../dto/create-lesson.dto";
import { LessonListItemResponseDto } from "../dto/lesson-list-item.response.dto";
import { LessonResponseDto } from "../dto/lesson.response.dto";
import { ListLessonsQueryDto } from "../dto/list-lessons-query.dto";
import { RescheduleLessonDto } from "../dto/reschedule-lesson.dto";
import { UpdateLessonDto } from "../dto/update-lesson.dto";
import { lessonNotFound } from "../services/lesson-errors";
import { LessonListingService } from "../services/lesson-listing.service";
import { LessonsService } from "../services/lessons.service";

/** A malformed id is a lesson that does not exist, so it answers the same 404 as an unknown one. */
const LESSON_ID = new ParseUUIDPipe({ exceptionFactory: () => lessonNotFound() });

const LESSON_ID_PARAM = { name: "id", format: "uuid", description: "Id of the lesson." };

const LESSON_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "LESSON_NOT_FOUND" };

/**
 * Lessons (aulas): list, calendar, create, read, edit, cancel and reschedule. Reading (the list,
 * the calendar and one lesson) needs lessons.view (every profile); the four writes need
 * lessons.manage (director, coordinator and superadmin), and a member answers 403 on them. There
 * is no DELETE: a lesson is cancelled, and stays (F4.5).
 *
 * The list and the calendar (GUS-153) answer the same LessonListItemResponseDto, the light item
 * that a row and a calendar cell draw; every other route answers the LessonResponseDto: the lesson
 * with its class, course, edition and lesson plan of origin. The scope is only all or none, so the
 * guard decides with the permission and the services need no policy.
 *
 * The order of the methods is the order of the routes: `GET /lessons` and `GET /lessons/calendar`
 * come BEFORE `GET /lessons/:id`. Express matches in registration order, so with `:id` first the
 * word "calendar" would be taken for the id of a lesson and answer 404 LESSON_NOT_FOUND. Do not
 * move them below `getLesson`.
 */
@ApiTags("lessons")
@Controller("lessons")
@ApiStandardErrors()
export class LessonsController {
  constructor(
    private readonly lessonsService: LessonsService,
    private readonly lessonListingService: LessonListingService,
  ) {}

  @Post()
  @RequirePermission(Permission.LESSONS_MANAGE)
  @ApiCreatedResponse({ type: LessonResponseDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description:
      "VALIDATION_FAILED | INVALID_TIME_RANGE | CLASS_NOT_FOUND | LESSON_OUTSIDE_CLASS_PERIOD | LESSON_PLAN_NOT_FOUND | LESSON_PLAN_ARCHIVED | LESSON_PLAN_NOT_IN_COURSE_SEQUENCE",
  })
  @ApiConflictResponse({ type: ApiErrorDto, description: "CLASS_ARCHIVED" })
  createLesson(
    @Body() dto: CreateLessonDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonResponseDto> {
    return this.lessonsService.create(dto, actor.id);
  }

  /**
   * The lessons of every class that is not archived, paginated, by day and start time. Filters by
   * class, course, lesson plan, status, period and a search by words; `classId` also reaches the
   * lessons of an archived class.
   */
  @Get()
  @RequirePermission(Permission.LESSONS_VIEW)
  @ApiOkResponsePaginated(LessonListItemResponseDto)
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | INVALID_DATE_RANGE",
  })
  listLessons(
    @Query() query: ListLessonsQueryDto,
  ): Promise<PaginatedResult<LessonListItemResponseDto>> {
    return this.lessonListingService.list(query);
  }

  /**
   * Every lesson of a period of up to 42 days, from every class, in one call and with no page: the
   * month grid of the calendar. The same filters and the same item as the list. It has to stay
   * declared before `getLesson` (see the class).
   */
  @Get("calendar")
  @RequirePermission(Permission.LESSONS_VIEW)
  @ApiOkResponse({
    type: [LessonListItemResponseDto],
    description:
      "Every lesson of the period, ordered by date, start time and id, the cancelled ones included. A plain array: there is no page.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | INVALID_DATE_RANGE | DATE_RANGE_TOO_LONG",
  })
  listLessonsCalendar(
    @Query() query: LessonsCalendarQueryDto,
  ): Promise<LessonListItemResponseDto[]> {
    return this.lessonListingService.listCalendar(query);
  }

  @Get(":id")
  @RequirePermission(Permission.LESSONS_VIEW)
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({ type: LessonResponseDto })
  @ApiNotFoundResponse(LESSON_NOT_FOUND_RESPONSE)
  getLesson(@Param("id", LESSON_ID) id: string): Promise<LessonResponseDto> {
    return this.lessonsService.findById(id);
  }

  @Patch(":id")
  @RequirePermission(Permission.LESSONS_MANAGE)
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({ type: LessonResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiNotFoundResponse(LESSON_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({ type: ApiErrorDto, description: "LESSON_CANCELLED | CLASS_ARCHIVED" })
  updateLesson(
    @Param("id", LESSON_ID) id: string,
    @Body() dto: UpdateLessonDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonResponseDto> {
    return this.lessonsService.update(id, dto, actor.id);
  }

  @Patch(":id/cancel")
  @RequirePermission(Permission.LESSONS_MANAGE)
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({
    type: LessonResponseDto,
    description:
      "The lesson, now cancelled. Cancelling a lesson that is already cancelled changes nothing and answers the same, with the first reason.",
  })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiNotFoundResponse(LESSON_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({ type: ApiErrorDto, description: "CLASS_ARCHIVED" })
  cancelLesson(
    @Param("id", LESSON_ID) id: string,
    @Body() dto: CancelLessonDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonResponseDto> {
    return this.lessonsService.cancel(id, dto, actor.id);
  }

  @Patch(":id/reschedule")
  @RequirePermission(Permission.LESSONS_MANAGE)
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({
    type: LessonResponseDto,
    description:
      "The same lesson (same id) on its new day and time, with originalDate set to the first day it was scheduled for.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | INVALID_TIME_RANGE | LESSON_OUTSIDE_CLASS_PERIOD",
  })
  @ApiNotFoundResponse(LESSON_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({ type: ApiErrorDto, description: "LESSON_CANCELLED | CLASS_ARCHIVED" })
  rescheduleLesson(
    @Param("id", LESSON_ID) id: string,
    @Body() dto: RescheduleLessonDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<LessonResponseDto> {
    return this.lessonsService.reschedule(id, dto, actor.id);
  }
}
