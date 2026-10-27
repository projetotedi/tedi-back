import { CourseLessonPlansResponseDto } from "../dto/course-lesson-plans.response.dto";
import { LessonPlanContent } from "../entities/lesson-plan-content.entity";

/**
 * One line of the sequence as the query of CourseLessonPlansService reads it: the link (position)
 * joined with its lesson plan and the number of courses that use the plan.
 */
export interface CourseLessonPlanRow {
  position: number;
  lessonPlanId: string;
  title: string;
  expectedDurationMinutes: number;
  materialUrl: string | null;
  archivedAt: Date | null;
  courseCount: number;
}

/** The texts of the contents of each lesson plan, in the order they are taught. */
function textsByLessonPlan(contents: readonly LessonPlanContent[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const content of [...contents].sort((a, b) => a.position - b.position)) {
    const texts = grouped.get(content.lessonPlanId);
    if (texts === undefined) {
      grouped.set(content.lessonPlanId, [content.text]);
    } else {
      texts.push(content.text);
    }
  }

  return grouped;
}

/**
 * The sequence of a course and the workload it adds up to. The workload is not stored: it is the
 * sum of `expectedDurationMinutes` of the lines read (RN-24), 0 for an empty sequence. An archived
 * plan that stayed in the sequence counts, since it is still in the plan of the course.
 */
export function toCourseLessonPlansResponse(
  courseId: string,
  rows: readonly CourseLessonPlanRow[],
  contents: readonly LessonPlanContent[],
): CourseLessonPlansResponseDto {
  const texts = textsByLessonPlan(contents);

  return {
    courseId,
    plannedWorkloadMinutes: rows.reduce((sum, row) => sum + row.expectedDurationMinutes, 0),
    items: [...rows]
      .sort((a, b) => a.position - b.position)
      .map((row) => ({
        position: row.position,
        lessonPlanId: row.lessonPlanId,
        title: row.title,
        contents: texts.get(row.lessonPlanId) ?? [],
        expectedDurationMinutes: row.expectedDurationMinutes,
        materialUrl: row.materialUrl,
        courseCount: row.courseCount,
        archivedAt: row.archivedAt,
      })),
  };
}
