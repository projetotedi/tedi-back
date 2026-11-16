import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CourseLessonPlansService } from "@modules/catalog/services/course-lesson-plans.service";
import { CoursesService } from "@modules/catalog/services/courses.service";
import { PeopleService } from "@modules/people/services/people.service";
import { CLASS_ENROLLMENTS_PREVIEW_LIMIT } from "../dto/class-limits";
import { ClassDetailDto } from "../dto/class-detail.response.dto";
import { SchoolClass } from "../entities/class.entity";
import { Edition } from "../entities/edition.entity";
import { toClassDetail } from "./class-detail.mapper";
import { classNotFound } from "./classes.service";
import { EnrollmentCountsService } from "./enrollment-counts.service";

/**
 * The sheet of a class (GUS-104): its data, the course it comes from, the progress of the class and
 * a preview of its students, in one call (RF-035). Read only: no transaction, no lock and no event,
 * like the page of a course. A value that changes between two of the reads can show in the same
 * answer, which is fine for a sheet to look at.
 *
 * What it reads, with no JOIN to a table of another module:
 * - the class and its edition;
 * - the course, through `CoursesService.getCourseSummary`: `course.category` is always the one the
 *   course has now, since the class stores none (RN-14, RF-029, P20);
 * - the plans of the course, through `CourseLessonPlansService.readSequence`. The number of lesson
 *   plans and the workload are the same ones `GET /courses/:id` answers, archived plans that stayed
 *   in the sequence included, because it is the same read (RN-24, P22);
 * - the active enrollments, through `EnrollmentCountsService`: the count and the first few. Both
 *   are empty until GUS-108;
 * - who created the class and the students of the preview, through
 *   `PeopleService.findRefsByIds`, one call for all of them.
 *
 * `lessonsDone`, `lessonsTotal` and `averageAttendance` are not read: they answer `null`. The
 * lessons depend on the classes (`lessons` imports `ClassesModule`), so `classes` cannot ask them
 * without a cycle; they are filled by a later card of the lessons and attendance (P23).
 */
@Injectable()
export class ClassDetailService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly courses: CoursesService,
    private readonly courseLessonPlans: CourseLessonPlansService,
    private readonly people: PeopleService,
    private readonly enrollmentCounts: EnrollmentCountsService,
  ) {}

  /**
   * 404 CLASS_NOT_FOUND for an id that is not a class. An archived class is found, and answers with
   * `archivedAt` set (RN-27).
   *
   * `requestedId` is only the key of the lookup. The UUID pipe of the route accepts upper case and
   * Postgres finds the row all the same, but everything after it (the reads and the answer) uses
   * `schoolClass.id`, the id of the database (see `ClassesService.update`).
   *
   * A creator that cannot be found (the person was removed) answers `createdBy: null`, and a
   * student of the preview that cannot be found is left out of it.
   */
  async findDetail(requestedId: string): Promise<ClassDetailDto> {
    const manager = this.dataSource.manager;

    const schoolClass = await manager.findOne(SchoolClass, { where: { id: requestedId } });
    if (schoolClass === null) throw classNotFound();

    const [edition, course, sequence, enrolledCount, previewRows] = await Promise.all([
      // The foreign key guarantees the edition, even a soft-deleted one.
      manager.findOneOrFail(Edition, { where: { id: schoolClass.editionId }, withDeleted: true }),
      this.courses.getCourseSummary(schoolClass.courseId, manager),
      this.courseLessonPlans.readSequence(manager, schoolClass.courseId),
      this.enrollmentCounts.countActive(manager, schoolClass.id),
      this.enrollmentCounts.listActivePreview(
        manager,
        schoolClass.id,
        CLASS_ENROLLMENTS_PREVIEW_LIMIT,
      ),
    ]);
    // The foreign key guarantees the course is there, so a null is a broken invariant and not a
    // business error (the same as `ClassesService.loadCourseSummary`).
    if (course === null) {
      throw new Error(`The course ${schoolClass.courseId} of a class could not be read.`);
    }

    const refs = await this.people.findRefsByIds([
      schoolClass.createdById,
      ...previewRows.map((row) => row.studentId),
    ]);
    const peopleById = new Map(refs.map((ref) => [ref.id, ref]));

    return toClassDetail({
      schoolClass,
      edition,
      course,
      lessonPlanCount: sequence.items.length,
      plannedWorkloadMinutes: sequence.plannedWorkloadMinutes,
      createdBy: peopleById.get(schoolClass.createdById) ?? null,
      enrolledCount,
      previewRows,
      peopleById,
    });
  }
}
