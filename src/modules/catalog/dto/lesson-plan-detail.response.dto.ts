import { ApiProperty } from "@nestjs/swagger";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { LessonPlanUsageStatus } from "../enums/lesson-plan-usage-status.enum";
import { LessonPlanUsedInItemResponseDto } from "./lesson-plan-used-in-item.response.dto";
import { LessonPlanResponseDto } from "./lesson-plan.response.dto";

/**
 * Detail page of a lesson plan (RF-017): everything LessonPlanResponseDto has, plus who created
 * it and in which courses it is used. Only GET /lesson-plans/:id answers it; the writes keep
 * answering LessonPlanResponseDto.
 */
export class LessonPlanDetailDto extends LessonPlanResponseDto {
  @ApiProperty({
    enum: LessonPlanUsageStatus,
    enumName: "LessonPlanUsageStatus",
    example: LessonPlanUsageStatus.IN_USE,
    description:
      "Derived: in_use when usedIn is not empty, unused otherwise. Independent of archivedAt: an archived plan can be in_use.",
  })
  status!: LessonPlanUsageStatus;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description: "Who created the lesson plan. Null when that person was deleted.",
  })
  createdBy!: PersonRefDto | null;

  @ApiProperty({
    type: [LessonPlanUsedInItemResponseDto],
    description:
      "Courses that have this lesson plan in their sequence, ordered by course name, archived courses included. Empty when the plan is unused.",
  })
  usedIn!: LessonPlanUsedInItemResponseDto[];
}
