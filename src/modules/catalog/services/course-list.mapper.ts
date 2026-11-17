import { CourseListItemDto } from "../dto/course-list-item.response.dto";
import { CourseReferenceResponseDto } from "../dto/course-reference.response.dto";
import { CourseCategory } from "../enums/course-category.enum";
import { courseStatusFromArchivedAt } from "./course-response.mapper";

/** A row of the page of `CourseListService.list`, before the prerequisites are attached. */
export interface CourseListRow {
  id: string;
  name: string;
  category: CourseCategory;
  archivedAt: Date | null;
  createdAt: Date;
  lessonPlanCount: number;
  plannedWorkloadMinutes: number;
}

/** A link "courseId requires the course { id, name }", as the second query of the list reads it. */
export interface CoursePrerequisiteRow {
  courseId: string;
  id: string;
  name: string;
}

/** The prerequisites of each course of the page, keyed by course id and ordered by name. */
export function groupPrerequisites(
  rows: readonly CoursePrerequisiteRow[],
): Map<string, CourseReferenceResponseDto[]> {
  const byCourse = new Map<string, CourseReferenceResponseDto[]>();
  for (const row of rows) {
    const list = byCourse.get(row.courseId) ?? [];
    list.push({ id: row.id, name: row.name });
    byCourse.set(row.courseId, list);
  }
  for (const list of byCourse.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }
  return byCourse;
}

export function toCourseListItem(
  row: CourseListRow,
  prerequisites: readonly CourseReferenceResponseDto[],
): CourseListItemDto {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    status: courseStatusFromArchivedAt(row.archivedAt),
    lessonPlanCount: row.lessonPlanCount,
    plannedWorkloadMinutes: row.plannedWorkloadMinutes,
    prerequisites: [...prerequisites],
    createdAt: row.createdAt,
  };
}
