import { Injectable } from "@nestjs/common";
import { DataSource, SelectQueryBuilder } from "typeorm";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { applyTextSearch, textSearchCondition } from "@shared/search/search.util";
import { LessonPlanListItemDto } from "../dto/lesson-plan-list-item.response.dto";
import { ListLessonPlansQueryDto } from "../dto/list-lesson-plans-query.dto";
import { CourseLessonPlan } from "../entities/course-lesson-plan.entity";
import { Course } from "../entities/course.entity";
import { LessonPlan } from "../entities/lesson-plan.entity";
import { LessonPlanListSort, LessonPlanUsageFilter } from "../enums/lesson-plan-list.enums";
import {
  groupContents,
  LessonPlanContentRow,
  LessonPlanListRow,
  toLessonPlanListItem,
} from "./lesson-plan-list.mapper";

/** The most suggestions of content the filter gets at once. */
const CONTENT_SUGGESTIONS_LIMIT = 20;

/**
 * The list of lesson plans of the catalog (GUS-95): the screen Planos de aula and the picker of the
 * sequence of a course, which sends `excludeCourseId`.
 *
 * Two queries per page, whatever its size: the page itself, with the number of courses of each
 * plan added up in the same query, and then the contents of the plans of the page with one `IN`.
 */
@Injectable()
export class LessonPlanListService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Filters combine with each other and with `search` (title, ignoring case and accents, GUS-115).
   * `courseCount` counts as the sequence and the detail of a plan count it: archived courses count,
   * deleted ones and deleted links do not.
   */
  async list(query: ListLessonPlansQueryDto): Promise<PaginatedResult<LessonPlanListItemDto>> {
    const { page, limit } = normalizePagination(query);
    const builder = this.buildListQuery(query);

    const [rows, total] = await Promise.all([
      builder
        .clone()
        .offset((page - 1) * limit)
        .limit(limit)
        .getRawMany<LessonPlanListRow>(),
      builder.clone().getCount(),
    ]);

    const contents = groupContents(await this.readContents(rows.map((row) => row.id)));

    return {
      data: rows.map((row) => toLessonPlanListItem(row, contents.get(row.id) ?? [])),
      total,
      page,
      limit,
    };
  }

  /**
   * The suggestions of the filter Conteúdo: up to 20 distinct texts of the contents of the plans
   * that are not archived, in alphabetical order. Two texts that differ only by accents or case are
   * one suggestion, written as most plans write it (alphabetical first on a tie).
   */
  async listContents(search?: string): Promise<string[]> {
    const condition = textSearchCondition(["content.text"], search, "contentSearch");
    const rows = await this.dataSource
      .createQueryBuilder()
      .select("ranked.text", "text")
      .from((inner) => {
        inner
          .select("content.text", "text")
          .addSelect("public.search_normalize(content.text)", "normalized")
          .addSelect(
            "ROW_NUMBER() OVER (PARTITION BY public.search_normalize(content.text) ORDER BY COUNT(*) DESC, content.text ASC)",
            "rank",
          )
          .from("lesson_plan_contents", "content")
          .innerJoin(
            "lesson_plans",
            "plan",
            "plan.id = content.lesson_plan_id AND plan.deleted_at IS NULL AND plan.archived_at IS NULL",
          )
          .where("content.deleted_at IS NULL")
          .groupBy("content.text");
        if (condition) inner.andWhere(condition.sql, condition.parameters);
        return inner;
      }, "ranked")
      .where("ranked.rank = 1")
      .orderBy("ranked.text", "ASC")
      .limit(CONTENT_SUGGESTIONS_LIMIT)
      .getRawMany<{ text: string }>();

    return rows.map((row) => row.text);
  }

  private buildListQuery(query: ListLessonPlansQueryDto): SelectQueryBuilder<LessonPlan> {
    const builder = this.dataSource
      .getRepository(LessonPlan)
      .createQueryBuilder("plan")
      .leftJoin(
        (usage) =>
          usage
            .select("link.lesson_plan_id", "lesson_plan_id")
            .addSelect("COUNT(*)::int", "course_count")
            .from(CourseLessonPlan, "link")
            .innerJoin(Course, "c", "c.id = link.course_id AND c.deleted_at IS NULL")
            .where("link.deleted_at IS NULL")
            .groupBy("link.lesson_plan_id"),
        "usage",
        "usage.lesson_plan_id = plan.id",
      )
      .select("plan.id", "id")
      .addSelect("plan.title", "title")
      .addSelect("plan.expected_duration_minutes", "expectedDurationMinutes")
      .addSelect("plan.material_url", "materialUrl")
      .addSelect("COALESCE(usage.course_count, 0)", "courseCount")
      .addSelect("plan.archived_at", "archivedAt")
      .addSelect("plan.updated_at", "updatedAt");

    applyTextSearch(builder, ["plan.title"], query.search, "titleSearch");

    const content = textSearchCondition(["content.text"], query.content, "contentSearch");
    if (content) {
      builder.andWhere(
        `EXISTS (SELECT 1 FROM lesson_plan_contents content
                  WHERE content.lesson_plan_id = plan.id AND content.deleted_at IS NULL
                    AND ${content.sql})`,
        content.parameters,
      );
    }

    if (query.usage === LessonPlanUsageFilter.ARCHIVED) {
      builder.andWhere("plan.archived_at IS NOT NULL");
    } else {
      builder.andWhere("plan.archived_at IS NULL");
      if (query.usage === LessonPlanUsageFilter.IN_USE) {
        builder.andWhere("COALESCE(usage.course_count, 0) > 0");
      } else if (query.usage === LessonPlanUsageFilter.UNUSED) {
        builder.andWhere("COALESCE(usage.course_count, 0) = 0");
      }
    }

    if (query.minDuration !== undefined) {
      builder.andWhere("plan.expected_duration_minutes >= :minDuration", {
        minDuration: query.minDuration,
      });
    }
    if (query.maxDuration !== undefined) {
      builder.andWhere("plan.expected_duration_minutes <= :maxDuration", {
        maxDuration: query.maxDuration,
      });
    }
    if (query.excludeCourseId !== undefined) {
      builder.andWhere(
        `NOT EXISTS (SELECT 1 FROM course_lesson_plans excluded
                      WHERE excluded.lesson_plan_id = plan.id
                        AND excluded.course_id = :excludeCourseId
                        AND excluded.deleted_at IS NULL)`,
        { excludeCourseId: query.excludeCourseId },
      );
    }

    if (query.sort === LessonPlanListSort.UPDATED_AT) {
      builder.orderBy("plan.updated_at", "DESC");
    } else {
      builder.orderBy("plan.title", "ASC");
    }
    return builder.addOrderBy("plan.id", "ASC");
  }

  /** The contents of the given plans, in their order; none for an empty page. */
  private readContents(planIds: readonly string[]): Promise<LessonPlanContentRow[]> {
    if (planIds.length === 0) return Promise.resolve([]);

    return this.dataSource.query(
      `SELECT content.lesson_plan_id AS "lessonPlanId", content.text AS "text"
         FROM lesson_plan_contents content
        WHERE content.lesson_plan_id = ANY($1::uuid[]) AND content.deleted_at IS NULL
        ORDER BY content.lesson_plan_id, content.position`,
      [planIds],
    );
  }
}
