import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { LessonPlanDetailDto } from "../dto/lesson-plan-detail.response.dto";
import { LessonPlanResponseDto } from "../dto/lesson-plan.response.dto";
import { LessonPlanUsageResponseDto } from "../dto/lesson-plan-usage.response.dto";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import { LessonPlanUsageStatus } from "../enums/lesson-plan-usage-status.enum";

/**
 * One line of the query of LessonPlanUsageService: a course that has the lesson plan in its
 * sequence, where the plan is in it, how many plans the sequence has, and the workload of the
 * course today and with the new duration of the plan (RN-24).
 */
export interface LessonPlanUsageRow {
  courseId: string;
  courseName: string;
  category: CourseCategory;
  courseArchivedAt: Date | null;
  position: number;
  lessonPlanCount: number;
  currentWorkloadMinutes: number;
  newWorkloadMinutes: number;
}

/**
 * By course name in pt-BR (an accented letter sorts with its base letter), then by id so the order
 * is stable. The same criterion as the prerequisites in course-response.mapper.ts.
 */
function byCourseName(a: LessonPlanUsageRow, b: LessonPlanUsageRow): number {
  return a.courseName.localeCompare(b.courseName, "pt-BR") || a.courseId.localeCompare(b.courseId);
}

/** The status of the course is not a column: it follows `archived_at` (RN-27). */
function courseStatusOf(row: LessonPlanUsageRow): CourseStatus {
  return row.courseArchivedAt === null ? CourseStatus.ACTIVE : CourseStatus.ARCHIVED;
}

/**
 * The detail of a lesson plan (RF-017): the plan as LessonPlanResponseDto answers it, plus who
 * created it and the courses that use it. Explicit projection: no field reaches the response by
 * accident. `createdBy` is null when that person was deleted. The status is derived from the rows
 * (in use when there is at least one), never stored, and has nothing to do with `archivedAt`.
 */
export function toLessonPlanDetail(
  plan: LessonPlanResponseDto,
  createdBy: PersonRefDto | null,
  rows: readonly LessonPlanUsageRow[],
): LessonPlanDetailDto {
  return {
    id: plan.id,
    title: plan.title,
    objective: plan.objective,
    expectedDurationMinutes: plan.expectedDurationMinutes,
    contents: [...plan.contents],
    materialUrl: plan.materialUrl,
    archivedAt: plan.archivedAt,
    archivedById: plan.archivedById,
    archiveReason: plan.archiveReason,
    createdById: plan.createdById,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    status: rows.length > 0 ? LessonPlanUsageStatus.IN_USE : LessonPlanUsageStatus.UNUSED,
    createdBy: createdBy === null ? null : { id: createdBy.id, name: createdBy.name },
    usedIn: [...rows].sort(byCourseName).map((row) => ({
      courseId: row.courseId,
      courseName: row.courseName,
      category: row.category,
      position: row.position,
      lessonPlanCount: row.lessonPlanCount,
      courseStatus: courseStatusOf(row),
    })),
  };
}

/**
 * The simulation of a change of duration (RF-017): the workload of each course that uses the
 * plan, today and with `newDurationMinutes`, in the order of the course names. The workloads come
 * calculated in the rows: nothing is added up here.
 */
export function toLessonPlanUsage(
  lessonPlanId: string,
  currentDurationMinutes: number,
  newDurationMinutes: number,
  rows: readonly LessonPlanUsageRow[],
): LessonPlanUsageResponseDto {
  return {
    lessonPlanId,
    currentDurationMinutes,
    newDurationMinutes,
    courses: [...rows].sort(byCourseName).map((row) => ({
      courseId: row.courseId,
      courseName: row.courseName,
      position: row.position,
      lessonPlanCount: row.lessonPlanCount,
      currentWorkloadMinutes: row.currentWorkloadMinutes,
      newWorkloadMinutes: row.newWorkloadMinutes,
    })),
  };
}
