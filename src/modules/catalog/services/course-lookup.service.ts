import { Injectable } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { applyTextSearch } from "@shared/search/search.util";
import { Course } from "../entities/course.entity";
import { CourseCategory } from "../enums/course-category.enum";
import { courseStatusOf } from "./course-response.mapper";
import { CourseSummary } from "./courses.service";

/** Filter of `CourseLookupService.findCourseIds`: the name of the course and its category. */
export interface CourseIdsFilter {
  search?: string;
  category?: CourseCategory;
}

/**
 * Reads of the catalog for another module that lists something of its own by course: the list of
 * classes (GUS-103) filters by the category and by the name of the course and shows the course of
 * each class, without a JOIN on a table of the catalog (a module is a closed box). Exported by
 * CatalogModule. Read only: no transaction, no lock and no event. Archived courses are included.
 */
@Injectable()
export class CourseLookupService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The ids of the courses whose name matches `search` (ignoring case and accents, GUS-115, over
   * idx_courses_name_search) and whose category is `category`. A blank search and no category is
   * "no filter", so a caller must not ask then: it answers every course.
   */
  async findCourseIds(filter: CourseIdsFilter): Promise<string[]> {
    const builder = this.dataSource
      .getRepository(Course)
      .createQueryBuilder("course")
      .select("course.id", "id");

    applyTextSearch(builder, ["course.name"], filter.search);
    if (filter.category !== undefined) {
      builder.andWhere("course.category = :category", { category: filter.category });
    }

    const rows = await builder.getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  /**
   * The summary (id, name, category and status) of each course asked, in one query, keyed by id.
   * An id that is not a course is left out of the map; the caller decides what to show then. A
   * course removed from the table (soft delete) is still answered: a class keeps its course.
   */
  async getCourseSummaries(ids: readonly string[]): Promise<Map<string, CourseSummary>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    const courses = await this.dataSource
      .getRepository(Course)
      .find({ where: { id: In(unique) }, withDeleted: true });

    return new Map(
      courses.map((course) => [
        course.id,
        {
          id: course.id,
          name: course.name,
          category: course.category,
          status: courseStatusOf(course),
        },
      ]),
    );
  }
}
