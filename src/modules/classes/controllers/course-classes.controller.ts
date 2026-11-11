import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { ApiOkResponsePaginated } from "@shared/pagination/api-paginated-response.decorator";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { ClassesSummaryByCourseQueryDto } from "../dto/classes-summary-by-course-query.dto";
import { ClassesSummaryByCourseResponseDto } from "../dto/classes-summary-by-course.response.dto";
import { CourseClassItemResponseDto } from "../dto/course-class-item.response.dto";
import { ListCourseClassesQueryDto } from "../dto/list-course-classes-query.dto";
import { courseNotFound } from "../services/class-course.errors";
import { CourseClassesService } from "../services/course-classes.service";

/**
 * The `:id` of the course in the URL. An id that is not a UUID answers 404 COURSE_NOT_FOUND, the
 * same as an id that does not exist, and not the 400 of the stock pipe: the same answer the
 * catalog gives under `/courses/:id`. Defined here because the pipe of the catalog is not part of
 * what CatalogModule exports.
 */
const COURSE_ID = new ParseUUIDPipe({ exceptionFactory: () => courseNotFound() });

/**
 * The reads of the classes by course (GUS-102): the classes of one course, for "Turmas deste
 * curso" of its sheet, and the count of classes of many courses at once, for the column "Turmas"
 * of the list of courses. They live here and not in `catalog` because the catalog does not know
 * the classes (docs/ARCHITECTURE.md, section 3).
 *
 * Both need classes.view, which every profile has. The module registers this controller before
 * `ClassesController` on purpose: when the detail `GET /classes/:id` exists (GUS-104), it must not
 * capture `GET /classes/summary-by-course`.
 */
@ApiTags("classes")
@Controller()
@ApiStandardErrors()
export class CourseClassesController {
  constructor(private readonly courseClassesService: CourseClassesService) {}

  /**
   * The classes of a course that are not archived, the most recent edition first, paginated. An
   * archived course is listed too. `enrolledCount` is the number of active enrollments of each
   * class.
   */
  @Get("courses/:id/classes")
  @RequirePermission(Permission.CLASSES_VIEW)
  @ApiParam({ name: "id", format: "uuid", description: "Id of the course." })
  @ApiOkResponsePaginated(CourseClassItemResponseDto)
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "COURSE_NOT_FOUND" })
  listCourseClasses(
    @Param("id", COURSE_ID) id: string,
    @Query() query: ListCourseClassesQueryDto,
  ): Promise<PaginatedResult<CourseClassItemResponseDto>> {
    return this.courseClassesService.listCourseClasses(id, query);
  }

  /**
   * How many classes each of the courses asked has, one item per course, in the order asked, with
   * zeros for a course without classes. `total` counts the classes that are not archived and
   * `active` the ones among them that are planned or in progress.
   */
  @Get("classes/summary-by-course")
  @RequirePermission(Permission.CLASSES_VIEW)
  @ApiOkResponse({ type: [ClassesSummaryByCourseResponseDto] })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  getClassesSummaryByCourse(
    @Query() query: ClassesSummaryByCourseQueryDto,
  ): Promise<ClassesSummaryByCourseResponseDto[]> {
    return this.courseClassesService.summarizeByCourse(query.courseIds);
  }
}
