import { Injectable } from "@nestjs/common";
import { DataSource, SelectQueryBuilder } from "typeorm";
import { CoursesService } from "@modules/catalog/services/courses.service";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { ClassesSummaryByCourseResponseDto } from "../dto/classes-summary-by-course.response.dto";
import { CourseClassItemResponseDto } from "../dto/course-class-item.response.dto";
import { ListCourseClassesQueryDto } from "../dto/list-course-classes-query.dto";
import { SchoolClass } from "../entities/class.entity";
import { Edition } from "../entities/edition.entity";
import { ClassStatus } from "../enums/class-status.enum";
import { courseNotFound } from "./class-course.errors";
import { EnrollmentCountsService } from "./enrollment-counts.service";

/** The statuses that count as `active` in the summary: the offers still running (P13). */
const ACTIVE_STATUSES: readonly ClassStatus[] = [ClassStatus.PLANNED, ClassStatus.IN_PROGRESS];

/** One row of the list of the classes of a course, as the query selects it. */
interface CourseClassRow {
  id: string;
  code: string;
  name: string | null;
  editionId: string;
  editionName: string;
  startDate: string;
  endDate: string;
  capacity: number;
  status: ClassStatus;
}

/** One row of the count by course: only the courses that have a class that is not archived. */
interface SummaryRow {
  courseId: string;
  total: number;
  active: number;
}

/**
 * The reads of the classes by course, which `catalog` cannot do because it does not know `classes`:
 * the classes of one course (the sheet of the course, "Turmas deste curso") and how many classes
 * each course of a list has (the column "Turmas" of the list of courses, without a query per row).
 *
 * Both leave the archived classes out (RN-27) and never write. The course comes from the catalog
 * (`CoursesService.getCourseSummary`); the classes are read straight from the table.
 */
@Injectable()
export class CourseClassesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly courses: CoursesService,
    private readonly enrollmentCounts: EnrollmentCountsService,
  ) {}

  /**
   * The classes of a course, paginated, the most recent edition first (by name: 2026.2 before
   * 2026.1), then by code ignoring case, then by id so the pages never repeat a class.
   *
   * 404 COURSE_NOT_FOUND when the id is not a course. An archived course is listed all the same
   * (RN-27): archiving a course is about new classes, not about reading the ones it has. The
   * archived classes are not listed, and there is no way to ask for them here. `status` filters
   * by one status.
   *
   * `enrolledCount` of the whole page comes from one call to the enrollment counts, never one per
   * class.
   */
  async listCourseClasses(
    courseId: string,
    query: ListCourseClassesQueryDto,
  ): Promise<PaginatedResult<CourseClassItemResponseDto>> {
    const course = await this.courses.getCourseSummary(courseId);
    if (course === null) throw courseNotFound();

    const { page, limit } = normalizePagination(query);
    const builder = this.buildCourseClassesQuery(courseId, query.status);

    const [rows, total] = await Promise.all([
      builder
        .clone()
        .offset((page - 1) * limit)
        .limit(limit)
        .getRawMany<CourseClassRow>(),
      builder.clone().getCount(),
    ]);

    const counts =
      rows.length === 0
        ? new Map<string, number>()
        : await this.enrollmentCounts.countActiveByClass(
            this.dataSource.manager,
            rows.map((row) => row.id),
          );

    return {
      data: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        edition: { id: row.editionId, name: row.editionName },
        startDate: row.startDate,
        endDate: row.endDate,
        enrolledCount: counts.get(row.id) ?? 0,
        capacity: row.capacity,
        status: row.status,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * How many classes each course has, in one query, one item per course asked: `total` (not
   * archived) and `active` (not archived and planned or in progress). A course without classes
   * answers zeros, so the caller does not have to tell "none" from "missing".
   *
   * The answer follows the order of the request, and an id that came twice answers once. The
   * catalog is not asked: an id that is well formed but is not a course answers zeros too, which
   * is the same as a course with no class. The ids come in lower case (the DTO does that), as the
   * database gives them back.
   */
  async summarizeByCourse(
    courseIds: readonly string[],
  ): Promise<ClassesSummaryByCourseResponseDto[]> {
    const unique = [...new Set(courseIds)];
    if (unique.length === 0) return [];

    const rows: SummaryRow[] = await this.dataSource.query(
      `SELECT course_id AS "courseId",
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = ANY($2::classes_status_enum[]))::int AS active
         FROM classes
        WHERE course_id = ANY($1::uuid[])
          AND archived_at IS NULL
          AND deleted_at IS NULL
        GROUP BY course_id`,
      [unique, ACTIVE_STATUSES],
    );
    const byCourse = new Map(rows.map((row) => [row.courseId, row]));

    return unique.map((courseId) => {
      const row = byCourse.get(courseId);
      return { courseId, total: row?.total ?? 0, active: row?.active ?? 0 };
    });
  }

  /**
   * The classes of the course that are not archived, with the name of their edition. The aliases
   * are in snake case on purpose: the raw `::text` of the dates only works with an alias that
   * needs no quotes, and TypeORM leaves it alone in a select it does not own.
   *
   * The dates are read as text so they stay `YYYY-MM-DD` with no time zone in the way (RN-21).
   */
  private buildCourseClassesQuery(
    courseId: string,
    status: ClassStatus | undefined,
  ): SelectQueryBuilder<SchoolClass> {
    const builder = this.dataSource
      .getRepository(SchoolClass)
      .createQueryBuilder("school_class")
      .innerJoin(Edition, "edition", "edition.id = school_class.edition_id")
      .select("school_class.id", "id")
      .addSelect("school_class.code", "code")
      .addSelect("school_class.name", "name")
      .addSelect("edition.id", "editionId")
      .addSelect("edition.name", "editionName")
      .addSelect("school_class.start_date::text", "startDate")
      .addSelect("school_class.end_date::text", "endDate")
      .addSelect("school_class.capacity", "capacity")
      .addSelect("school_class.status", "status")
      .where("school_class.course_id = :courseId", { courseId })
      .andWhere("school_class.archived_at IS NULL");

    if (status !== undefined) builder.andWhere("school_class.status = :status", { status });

    return builder
      .orderBy("edition.name", "DESC")
      .addOrderBy("LOWER(school_class.code)", "ASC")
      .addOrderBy("school_class.id", "ASC");
  }
}
