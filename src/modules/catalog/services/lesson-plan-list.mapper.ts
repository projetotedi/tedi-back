import { LessonPlanListItemDto } from "../dto/lesson-plan-list-item.response.dto";
import { LessonPlanListStatus } from "../enums/lesson-plan-list.enums";

/** A row of the page of `LessonPlanListService.list`, before the contents are attached. */
export interface LessonPlanListRow {
  id: string;
  title: string;
  expectedDurationMinutes: number;
  materialUrl: string | null;
  courseCount: number;
  archivedAt: Date | null;
  updatedAt: Date;
}

/** A content of a plan of the page, as the second query of the list reads it. */
export interface LessonPlanContentRow {
  lessonPlanId: string;
  text: string;
}

/** The contents of each plan of the page, keyed by plan id, in the order they were read. */
export function groupContents(rows: readonly LessonPlanContentRow[]): Map<string, string[]> {
  const byPlan = new Map<string, string[]>();
  for (const row of rows) {
    const list = byPlan.get(row.lessonPlanId) ?? [];
    list.push(row.text);
    byPlan.set(row.lessonPlanId, list);
  }
  return byPlan;
}

/** Archived wins over the usage: an archived plan in a course is still "archived" on the list. */
export function lessonPlanListStatus(
  archivedAt: Date | null,
  courseCount: number,
): LessonPlanListStatus {
  if (archivedAt !== null) return LessonPlanListStatus.ARCHIVED;
  return courseCount > 0 ? LessonPlanListStatus.IN_USE : LessonPlanListStatus.UNUSED;
}

export function toLessonPlanListItem(
  row: LessonPlanListRow,
  contents: string[],
): LessonPlanListItemDto {
  const courseCount = Number(row.courseCount);

  return {
    id: row.id,
    title: row.title,
    contents,
    expectedDurationMinutes: row.expectedDurationMinutes,
    materialUrl: row.materialUrl,
    courseCount,
    status: lessonPlanListStatus(row.archivedAt, courseCount),
    archivedAt: row.archivedAt,
    updatedAt: row.updatedAt,
  };
}
