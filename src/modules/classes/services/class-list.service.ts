import { Injectable } from "@nestjs/common";
import { Brackets, DataSource, SelectQueryBuilder } from "typeorm";
import { CourseLookupService } from "@modules/catalog/services/course-lookup.service";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { normalizeSearchTerm, textSearchCondition } from "@shared/search/search.util";
import { ClassListItemDto } from "../dto/class-list-item.response.dto";
import { ListClassesQueryDto } from "../dto/list-classes-query.dto";
import { SchoolClass } from "../entities/class.entity";
import { Edition } from "../entities/edition.entity";
import { ClassListSort } from "../enums/class-list-sort.enum";
import { ClassListRow, toClassListItem } from "./class-list.mapper";
import { EnrollmentCountsService } from "./enrollment-counts.service";

/** The courses that the filters of the catalog leave: `null` when none of them was sent. */
interface CourseFilter {
  byCategory: string[] | null;
  bySearch: string[] | null;
}

/**
 * The list of classes (GUS-103): the screen Turmas, where many classes of different courses run at
 * the same time (RF-030), so the edition, the course and the status are the filters that matter.
 *
 * The course belongs to the catalog, which this module reads only through what it exports (a
 * module is a closed box): the category and the name of the course in the search are turned into
 * ids of courses first (`CourseLookupService.findCourseIds`), and the course of each class of the
 * page is read in one query after it (`getCourseSummaries`). With the count, the enrollments
 * (`countActiveByClass`) and the page itself, the number of queries is the same for any size of
 * page.
 */
@Injectable()
export class ClassListService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly courses: CourseLookupService,
    private readonly enrollmentCounts: EnrollmentCountsService,
  ) {}

  /**
   * Filters combine with each other and with `search`. `archived` omitted lists only the classes
   * that are not archived (RN-27); `true` lists only the archived ones. The default order is the
   * start date, newest first.
   */
  async list(query: ListClassesQueryDto): Promise<PaginatedResult<ClassListItemDto>> {
    const { page, limit } = normalizePagination(query);
    const courseFilter = await this.readCourseFilter(query);

    // A filter of the catalog that no course matches leaves nothing to list.
    if (courseFilter.byCategory !== null && courseFilter.byCategory.length === 0) {
      return { data: [], total: 0, page, limit };
    }

    const builder = this.buildListQuery(query, courseFilter);
    const [rows, total] = await Promise.all([
      builder
        .clone()
        .offset((page - 1) * limit)
        .limit(limit)
        .getRawMany<ClassListRow>(),
      builder.clone().getCount(),
    ]);
    if (rows.length === 0) return { data: [], total, page, limit };

    const [courses, counts] = await Promise.all([
      this.courses.getCourseSummaries(rows.map((row) => row.courseId)),
      this.enrollmentCounts.countActiveByClass(
        this.dataSource.manager,
        rows.map((row) => row.id),
      ),
    ]);

    return {
      data: rows.map((row) => {
        const course = courses.get(row.courseId);
        if (course === undefined) {
          // fk_classes_course_id makes this impossible; a silent gap would hide a broken row.
          throw new Error(`Course ${row.courseId} of class ${row.id} was not found`);
        }
        return toClassListItem(row, course, counts.get(row.id) ?? 0);
      }),
      total,
      page,
      limit,
    };
  }

  /** The ids of the courses for `category` and for the search by the name of the course. */
  private async readCourseFilter(query: ListClassesQueryDto): Promise<CourseFilter> {
    const search = normalizeSearchTerm(query.search) === undefined ? undefined : query.search;
    const [byCategory, bySearch] = await Promise.all([
      query.category === undefined
        ? Promise.resolve(null)
        : this.courses.findCourseIds({ category: query.category }),
      search === undefined ? Promise.resolve(null) : this.courses.findCourseIds({ search }),
    ]);
    return { byCategory, bySearch };
  }

  /**
   * The classes with the name of their edition (same module, so a JOIN). The aliases are in camel
   * case and quoted by TypeORM; the dates are read as text so they stay `YYYY-MM-DD` (RN-21).
   */
  private buildListQuery(
    query: ListClassesQueryDto,
    courseFilter: CourseFilter,
  ): SelectQueryBuilder<SchoolClass> {
    const builder = this.dataSource
      .getRepository(SchoolClass)
      .createQueryBuilder("school_class")
      .innerJoin(Edition, "edition", "edition.id = school_class.edition_id")
      .select("school_class.id", "id")
      .addSelect("school_class.code", "code")
      .addSelect("school_class.name", "name")
      .addSelect("school_class.course_id", "courseId")
      .addSelect("edition.id", "editionId")
      .addSelect("edition.name", "editionName")
      .addSelect("school_class.start_date::text", "startDate")
      .addSelect("school_class.end_date::text", "endDate")
      .addSelect("school_class.capacity", "capacity")
      .addSelect("school_class.status", "status")
      .addSelect("school_class.archived_at", "archivedAt");

    builder.where(
      query.archived === true
        ? "school_class.archived_at IS NOT NULL"
        : "school_class.archived_at IS NULL",
    );
    if (query.editionId !== undefined) {
      builder.andWhere("school_class.edition_id = :editionId", { editionId: query.editionId });
    }
    if (query.courseId !== undefined) {
      builder.andWhere("school_class.course_id = :courseId", { courseId: query.courseId });
    }
    if (courseFilter.byCategory !== null) {
      builder.andWhere("school_class.course_id = ANY(:categoryCourseIds)", {
        categoryCourseIds: courseFilter.byCategory,
      });
    }
    if (query.status !== undefined && query.status.length > 0) {
      builder.andWhere("school_class.status IN (:...statuses)", { statuses: query.status });
    }
    this.applySearch(builder, query.search, courseFilter.bySearch);

    if (query.sort === ClassListSort.CODE) {
      builder.orderBy("LOWER(school_class.code)", "ASC");
    } else {
      builder.orderBy("school_class.start_date", "DESC");
    }
    return builder.addOrderBy("school_class.id", "ASC");
  }

  /**
   * The code or the name of the class (over idx_classes_code_search and idx_classes_name_search),
   * or the name of its course (the ids the catalog found), as one OR group.
   */
  private applySearch(
    builder: SelectQueryBuilder<SchoolClass>,
    term: string | undefined,
    searchCourseIds: string[] | null,
  ): void {
    const condition = textSearchCondition(["school_class.code", "school_class.name"], term);
    if (condition === undefined) return;

    builder.andWhere(
      new Brackets((group) => {
        group.where(condition.sql, condition.parameters);
        if (searchCourseIds !== null && searchCourseIds.length > 0) {
          group.orWhere("school_class.course_id = ANY(:searchCourseIds)", { searchCourseIds });
        }
      }),
    );
  }
}
