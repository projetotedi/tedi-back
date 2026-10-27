import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { PeopleService } from "@modules/people/services/people.service";
import { CourseDetailDto } from "../dto/course-detail.response.dto";
import { Course } from "../entities/course.entity";
import { RelatedCourseRow, toCourseDetail } from "./course-detail.mapper";
import { CourseLessonPlansService } from "./course-lesson-plans.service";
import { courseNotFound } from "./courses.service";

/**
 * The page of a course (GUS-100): data, prerequisites, the courses that require it, the sequence of
 * lesson plans with the workload and who created it (RF-014, RF-018, RF-021), in one call. Read
 * only: no transaction, no lock and no event. An archived course is read like any other (RN-27),
 * and so are the archived courses linked to it and the archived plans of its sequence: they come
 * with their status.
 *
 * What it reads, with no JOIN to a table of another module:
 * - the course (1 query);
 * - the related courses, prerequisites and requiredBy together (1 query);
 * - the sequence, through `CourseLessonPlansService.readSequence` (1 query, plus 1 for the
 *   contents of the plans when the sequence is not empty);
 * - the creator, through `PeopleService.findById` (1 query).
 * The last three run together once the course is found. Without a transaction, a change that
 * lands between two of them can show in the same answer; that is fine for a page to look at.
 */
@Injectable()
export class CourseDetailService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly courseLessonPlansService: CourseLessonPlansService,
    private readonly peopleService: PeopleService,
  ) {}

  /**
   * 404 COURSE_NOT_FOUND for an id that is not a course. Archived courses are found.
   *
   * `requestedId` is only the key of the lookup. The UUID pipe of the route accepts upper case and
   * Postgres finds the row all the same, but everything after it (the related courses, the
   * sequence and the answer) uses `course.id`, the id of the database (see
   * `CoursesService.update`).
   *
   * A creator that cannot be found (the person was removed) answers `createdBy: null`.
   */
  async findDetail(requestedId: string): Promise<CourseDetailDto> {
    const course = await this.dataSource
      .getRepository(Course)
      .findOne({ where: { id: requestedId } });
    if (course === null) throw courseNotFound();

    const [related, sequence, creator] = await Promise.all([
      this.loadRelatedCourses(this.dataSource.manager, course.id),
      this.courseLessonPlansService.readSequence(this.dataSource.manager, course.id),
      this.peopleService.findById(course.createdById),
    ]);

    return toCourseDetail(
      course,
      related,
      sequence,
      creator === null ? null : { id: creator.id, name: creator.name },
    );
  }

  /**
   * The courses that `courseId` requires and the courses that require it, in one SQL, archived
   * ones included in both. The second half is served by
   * `idx_course_prerequisites_prerequisite_id`. The rows come in no particular order: the mapper
   * orders them by name in pt-BR, which the collation of the database does not promise.
   */
  private loadRelatedCourses(
    manager: EntityManager,
    courseId: string,
  ): Promise<RelatedCourseRow[]> {
    return manager.query(
      `SELECT 'prerequisite' AS "relation", c.id AS "id", c.name AS "name",
              c.category AS "category", c.archived_at AS "archivedAt"
         FROM course_prerequisites link
         JOIN courses c ON c.id = link.prerequisite_id AND c.deleted_at IS NULL
        WHERE link.course_id = $1 AND link.deleted_at IS NULL
       UNION ALL
       SELECT 'requiredBy', c.id, c.name, c.category, c.archived_at
         FROM course_prerequisites link
         JOIN courses c ON c.id = link.course_id AND c.deleted_at IS NULL
        WHERE link.prerequisite_id = $1 AND link.deleted_at IS NULL`,
      [courseId],
    );
  }
}
