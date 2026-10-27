import { LessonPlanResponseDto } from "../dto/lesson-plan.response.dto";
import { LessonPlanContent } from "../entities/lesson-plan-content.entity";
import { LessonPlan } from "../entities/lesson-plan.entity";

export function toLessonPlanResponse(
  plan: LessonPlan,
  contents: readonly LessonPlanContent[],
): LessonPlanResponseDto {
  return {
    id: plan.id,
    title: plan.title,
    objective: plan.objective,
    expectedDurationMinutes: plan.expectedDurationMinutes,
    contents: [...contents].sort((a, b) => a.position - b.position).map((content) => content.text),
    materialUrl: plan.materialUrl,
    archivedAt: plan.archive?.archivedAt ?? null,
    archivedById: plan.archive?.archivedById ?? null,
    archiveReason: plan.archive?.archiveReason ?? null,
    createdById: plan.createdById,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}
