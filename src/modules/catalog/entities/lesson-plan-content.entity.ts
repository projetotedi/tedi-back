import { Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { LessonPlan } from "./lesson-plan.entity";

@Entity({ name: "lesson_plan_contents" })
@Index("uq_lesson_plan_contents_lesson_plan_id_position", ["lessonPlanId", "position"], {
  unique: true,
})
@ForeignKey(() => LessonPlan, ["lesson_plan_id"], ["id"], {
  name: "fk_lesson_plan_contents_lesson_plan_id",
})
export class LessonPlanContent extends BaseEntity {
  @Column({ name: "lesson_plan_id", type: "uuid" })
  lessonPlanId: string;

  @Column({ name: "position", type: "integer" })
  position: number;

  @Column({ name: "text", type: "text" })
  text: string;
}
