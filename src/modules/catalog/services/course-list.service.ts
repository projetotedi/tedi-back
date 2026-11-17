import { Injectable } from "@nestjs/common";
import { DataSource, SelectQueryBuilder } from "typeorm";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { applyTextSearch } from "@shared/search/search.util";
import { CourseListItemDto } from "../dto/course-list-item.response.dto";
import { ListCoursesQueryDto } from "../dto/list-courses-query.dto";
import { CourseLessonPlan } from "../entities/course-lesson-plan.entity";
import { Course } from "../entities/course.entity";
import { LessonPlan } from "../entities/lesson-plan.entity";
import { CourseListSort } from "../enums/course-list-sort.enum";
import { CourseStatus } from "../enums/course-status.enum";
import {
  CourseListRow,
  CoursePrerequisiteRow,
  groupPrerequisites,
  toCourseListItem,
} from "./course-list.mapper";

/**
 * The list of courses of the catalog (GUS-99): the screen Cursos and the selectors of course of a
 * new class and of prerequisites, which send `status=active` (RF-020).
 *
 * Two queries per page, whatever its size: the page itself, with the number of lesson plans and
 * the planned workload added up in the same query, and then the prerequisites of the courses of
 * the page with one `IN`. The count of classes of each course is not here: `catalog` does not know
 * `classes`, and the screen reads it from `GET /classes/summary-by-course`.
 */
@Injectable()
export class CourseListService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Filters combine with each other and with `search` (name, ignoring case and accents, GUS-115).
   * `status` omitted lists active and archived courses, so the screen can show the tag Arquivado.
   *
   * The sequence is counted as the page of the course counts it (D6 of GUS-98): archived lesson
   * plans count, deleted ones do not. A course without plans has 0 and 0.
   */
  async list(query: ListCoursesQueryDto): Promise<PaginatedResult<CourseListItemDto>> {
    const { page, limit } = normalizePagination(query);
    const builder = this.buildListQuery(query);

    const [rows, total] = await Promise.all([
      builder
        .clone()
        .offset((page - 1) * limit)
        .limit(limit)
        .getRawMany<CourseListRow>(),
      builder.clone().getCount(),
    ]);

    const prerequisites = groupPrerequisites(
      await this.readPrerequisites(rows.map((row) => row.id)),
    );

    return {
      data: rows.map((row) => toCourseListItem(row, prerequisites.get(row.id) ?? [])),
      total,
      page,
      limit,
    };
  }

  private buildListQuery(query: ListCoursesQueryDto): SelectQueryBuilder<Course> {
    const builder = this.dataSource
      .getRepository(Course)
      .createQueryBuilder("course")
      .leftJoin(
        (sequence) =>
          sequence
            .select("link.course_id", "course_id")
            .addSelect("COUNT(plan.id)::int", "lesson_plan_count")
            .addSelect("SUM(plan.expected_duration_minutes)::int", "workload_minutes")
            .from(CourseLessonPlan, "link")
            .innerJoin(
              LessonPlan,
              "plan",
              "plan.id = link.lesson_plan_id AND plan.deleted_at IS NULL",
            )
            .where("link.deleted_at IS NULL")
            .groupBy("link.course_id"),
        "sequence",
        "sequence.course_id = course.id",
      )
      .select("course.id", "id")
      .addSelect("course.name", "name")
      .addSelect("course.category", "category")
      .addSelect("course.archived_at", "archivedAt")
      .addSelect("course.created_at", "createdAt")
      .addSelect("COALESCE(sequence.lesson_plan_count, 0)", "lessonPlanCount")
      .addSelect("COALESCE(sequence.workload_minutes, 0)", "plannedWorkloadMinutes");

    applyTextSearch(builder, ["course.name"], query.search);

    if (query.category !== undefined) {
      builder.andWhere("course.category = :category", { category: query.category });
    }
    if (query.status === CourseStatus.ACTIVE) {
      builder.andWhere("course.archived_at IS NULL");
    } else if (query.status === CourseStatus.ARCHIVED) {
      builder.andWhere("course.archived_at IS NOT NULL");
    }
    if (query.hasPrerequisite !== undefined) {
      const exists = `EXISTS (SELECT 1 FROM course_prerequisites prerequisite
                               WHERE prerequisite.course_id = course.id
                                 AND prerequisite.deleted_at IS NULL)`;
      builder.andWhere(query.hasPrerequisite ? exists : `NOT ${exists}`);
    }

    if (query.sort === CourseListSort.CREATED_AT) {
      builder.orderBy("course.created_at", "DESC");
    } else {
      builder.orderBy("course.name", "ASC");
    }
    return builder.addOrderBy("course.id", "ASC");
  }

  /** The prerequisites of the given courses, archived ones included; none for an empty page. */
  private readPrerequisites(courseIds: readonly string[]): Promise<CoursePrerequisiteRow[]> {
    if (courseIds.length === 0) return Promise.resolve([]);

    return this.dataSource.query(
      `SELECT link.course_id AS "courseId", c.id AS "id", c.name AS "name"
         FROM course_prerequisites link
         JOIN courses c ON c.id = link.prerequisite_id AND c.deleted_at IS NULL
        WHERE link.course_id = ANY($1::uuid[]) AND link.deleted_at IS NULL`,
      [courseIds],
    );
  }
}
