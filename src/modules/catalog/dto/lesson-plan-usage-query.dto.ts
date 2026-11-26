import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { LESSON_PLAN_DURATION_PROPERTY } from "./create-lesson-plan.dto";
import { LESSON_PLAN_MAX_DURATION_MINUTES } from "./lesson-plan-limits";

/** Query parameters for GET /lesson-plans/:id/usage. */
export class LessonPlanUsageQueryDto {
  @ApiPropertyOptional({
    ...LESSON_PLAN_DURATION_PROPERTY,
    description: "New expected duration to simulate. Omitted: the current one.",
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined ? Number(value) : undefined))
  @Max(LESSON_PLAN_MAX_DURATION_MINUTES)
  @Min(1)
  @IsInt()
  expectedDurationMinutes?: number;
}
