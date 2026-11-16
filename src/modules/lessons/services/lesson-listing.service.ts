import { Injectable } from "@nestjs/common";
import { DataSource, SelectQueryBuilder } from "typeorm";
import { ClassesService, ClassRef } from "@modules/classes/services/classes.service";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { applyTextSearchAllWords } from "@shared/search/search.util";
import { LessonsCalendarQueryDto } from "../dto/calendar-query.dto";
import { LESSON_CALENDAR_MAX_DAYS } from "../dto/lesson-limits";
import { LessonListItemResponseDto } from "../dto/lesson-list-item.response.dto";
import { ListLessonsQueryDto } from "../dto/list-lessons-query.dto";
import { Lesson } from "../entities/lesson.entity";
import { ConfirmedStaff, NO_CONFIRMED_STAFF } from "./lesson-coverage";
import { LessonCoverageRegistry } from "./lesson-coverage.registry";
import { assertDateRange } from "./lesson-date-range";
import { toLessonListItem } from "./lesson-list-item.mapper";

/** What the list and the calendar both filter by: the calendar is the list without the page. */
type LessonFilters = Pick<
  ListLessonsQueryDto,
  "search" | "classId" | "courseId" | "lessonPlanId" | "status" | "from" | "to"
>;

/** The columns the search looks in: every word has to show up in one of them (L22). */
const SEARCH_COLUMNS = ["lesson.title", "lesson.subject"] as const;

/**
 * The reads of many lessons at once (F4.4, RF-043): the list, paginated, and the calendar of a
 * period, in one call and with no page, which gathers the lessons of every class. Both take the
 * same filters (`search`, `classId`, `courseId`, `lessonPlanId`, `status`, `from` and `to`), both
 * answer the same item and in the same order: `date`, `startTime`, then `id`, ascending, so a page
 * never repeats a lesson. They write nothing and lock nothing: plain reads, with no policy (the
 * scope of `lessons.view` is all or none, the guard decides).
 *
 * The class of each lesson and the `courseId` filter come from `ClassesService.listClassRefs`,
 * never from a join with the table of `classes`, which belongs to another module. The classes are
 * resolved first and the lessons are asked for `class_id IN (...)` of those classes, so the filter
 * is in the query and `total` is right. The archived classes are left out, and a request for one
 * `classId` is how one reaches the lessons of an archived class (RN-27, L19). A filter that matches
 * no class, or an id that is not one, answers empty: it is not a 404 (L24).
 *
 * Without a filter by class, `IN (...)` carries every class that is not archived: dozens a
 * semester, hundreds over the years, which is fine. If it ever grows, the list can be narrowed to
 * the classes whose period crosses `[from, to]`.
 *
 * `getMany()` reads the entity on purpose: the `timeOfDayTransformer` of the entity is what hands
 * `startTime` and `endTime` back as "HH:mm".
 *
 * `teacher` and `belowExpectedMonitors` come from the allocation (E5, GUS-158), which this module
 * does not know: it asks the `LessonCoverageRegistry`, the port the assignments module plugs its
 * counter in (docs/ARCHITECTURE.md section 15), ONCE for the whole page of the list and ONCE for the
 * whole period of the calendar, with the ids of the lessons it just read, never once per lesson. The
 * answer says the confirmed teacher (a pending one is not the teacher) and how many monitors are
 * confirmed. Without a counter registered nobody is allocated as far as this module knows, so every
 * lesson reads as `NO_CONFIRMED_STAFF`: no teacher, and the monitors it expects are all missing.
 */
@Injectable()
export class LessonListingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly classes: ClassesService,
    private readonly coverage: LessonCoverageRegistry,
  ) {}

  /**
   * The lessons that match the filters, paginated (default 20 a page, at most 100).
   *
   * 400 INVALID_DATE_RANGE when `from` and `to` come together and `to` is before `from`, answered
   * before anything is read. `from` and `to` are each optional on their own, and the length of the
   * period is not limited here. When no class matches, the answer is an empty page and the
   * lessons are not even queried.
   */
  async list(query: ListLessonsQueryDto): Promise<PaginatedResult<LessonListItemResponseDto>> {
    assertDateRange(query.from, query.to);

    const { page, limit } = normalizePagination(query);
    const classes = await this.resolveClasses(query);
    if (classes.size === 0) return { data: [], total: 0, page, limit };

    const builder = this.buildQuery(query, [...classes.keys()]);
    const [lessons, total] = await Promise.all([
      builder
        .clone()
        .offset((page - 1) * limit)
        .limit(limit)
        .getMany(),
      builder.clone().getCount(),
    ]);

    return { data: await this.toItems(lessons, classes), total, page, limit };
  }

  /**
   * Every lesson of the period `[from, to]`, in one call and with no page: the month grid of the
   * calendar, or a week. The same item as the list, the same filters and the same order; the
   * cancelled lessons come too, unless `status` says otherwise (L18).
   *
   * 400 INVALID_DATE_RANGE when `to` is before `from` and 400 DATE_RANGE_TOO_LONG when the period
   * holds more than 42 days, both ends counted (six weeks, a month grid), answered before anything
   * is read: the limit is what makes "all of them" safe to answer without a page. When no class
   * matches, the answer is an empty list and the lessons are not queried.
   */
  async listCalendar(query: LessonsCalendarQueryDto): Promise<LessonListItemResponseDto[]> {
    assertDateRange(query.from, query.to, LESSON_CALENDAR_MAX_DAYS);

    const classes = await this.resolveClasses(query);
    if (classes.size === 0) return [];

    const lessons = await this.buildQuery(query, [...classes.keys()]).getMany();

    return this.toItems(lessons, classes);
  }

  /**
   * The classes the lessons are looked for in, by id. Archived classes are in only when the filter
   * names a `classId`: that is the one way to a lesson of an archived class (L19). The map follows
   * the order of the classes, by creation.
   */
  private async resolveClasses(
    filters: Pick<LessonFilters, "classId" | "courseId">,
  ): Promise<Map<string, ClassRef>> {
    const refs = await this.classes.listClassRefs({
      classId: filters.classId,
      courseId: filters.courseId,
      includeArchived: filters.classId !== undefined,
    });

    return new Map(refs.map((ref) => [ref.id, ref]));
  }

  /**
   * The query of both routes: the lessons of those classes, the optional filters and the order.
   * The search compares each word with the title and the subject through the expression that the
   * GIN indexes of `lessons` cover (`public.search_normalize`).
   */
  private buildQuery(filters: LessonFilters, classIds: string[]): SelectQueryBuilder<Lesson> {
    const builder = this.dataSource
      .getRepository(Lesson)
      .createQueryBuilder("lesson")
      .where("lesson.classId IN (:...classIds)", { classIds });

    if (filters.status !== undefined) {
      builder.andWhere("lesson.status = :status", { status: filters.status });
    }
    if (filters.lessonPlanId !== undefined) {
      builder.andWhere("lesson.lessonPlanId = :lessonPlanId", {
        lessonPlanId: filters.lessonPlanId,
      });
    }
    if (filters.from !== undefined) {
      builder.andWhere("lesson.date >= :from", { from: filters.from });
    }
    if (filters.to !== undefined) {
      builder.andWhere("lesson.date <= :to", { to: filters.to });
    }
    applyTextSearchAllWords(builder, SEARCH_COLUMNS, filters.search, "lessonSearch");

    return builder
      .orderBy("lesson.date", "ASC")
      .addOrderBy("lesson.startTime", "ASC")
      .addOrderBy("lesson.id", "ASC");
  }

  /**
   * The items of a page, or of a period: the lessons with the class of each one and the confirmed
   * staff of each one, which comes from ONE call to the registry with the ids of all of them (the
   * N+1 this avoids is one call per lesson). A lesson that the registry does not list has nobody
   * confirmed. An empty page asks for nothing.
   */
  private async toItems(
    lessons: Lesson[],
    classes: ReadonlyMap<string, ClassRef>,
  ): Promise<LessonListItemResponseDto[]> {
    if (lessons.length === 0) return [];

    const staff = await this.coverage.findConfirmedStaff(lessons.map((lesson) => lesson.id));

    return lessons.map((lesson) =>
      this.toItem(lesson, classes, staff.get(lesson.id) ?? NO_CONFIRMED_STAFF),
    );
  }

  /**
   * The item of a lesson. The query only takes lessons of the classes that were resolved, so a
   * class that is missing is a broken invariant and not a business error.
   */
  private toItem(
    lesson: Lesson,
    classes: ReadonlyMap<string, ClassRef>,
    staff: ConfirmedStaff,
  ): LessonListItemResponseDto {
    const schoolClass = classes.get(lesson.classId);
    if (schoolClass === undefined) {
      throw new Error(`The class ${lesson.classId} of the lesson ${lesson.id} was not resolved.`);
    }

    return toLessonListItem(lesson, schoolClass, staff);
  }
}
