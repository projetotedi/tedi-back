import { Check, Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { Course } from "./course.entity";
import { LessonPlan } from "./lesson-plan.entity";

/**
 * One lesson plan in the sequence of a course (RF-014, RF-016): `lessonPlanId` is taught at
 * `position` in `courseId`. A table with its own id, like CoursePrerequisite, and not a
 * `@ManyToMany`: every entity extends BaseEntity.
 *
 * The order lives on the link, not on the lesson plan (RN-17): the same plan can be in two courses
 * at different positions. A plan appears at most once in a course
 * (`uq_course_lesson_plans_course_id_lesson_plan_id`) and a position is taken by at most one plan
 * (`uq_course_lesson_plans_course_id_position`).
 *
 * The position starts at 1 (`ck_course_lesson_plans_position`), unlike LessonPlanContent, which
 * starts at 0: here it is the number the coordination sees ("aula 1"), not an index into a list.
 * Gaps are possible for the database but CourseLessonPlansService never leaves one: it writes 1..n.
 *
 * The whole sequence of a course is replaced on edit, with a hard delete of its rows followed by
 * the new inserts, so the two unique indexes never meet a leftover row.
 *
 * The workload of the course is NOT a column: it is the sum of `expected_duration_minutes` of the
 * plans in the sequence, calculated when read (RN-24), so a change of duration reaches every course
 * that uses the plan.
 *
 * The foreign keys are declared on the class, by entity, and without relations: this keeps every
 * constraint name under our control (the SQL of the migration is written by hand), the same
 * pattern as CoursePrerequisite.
 */
@Entity({ name: "course_lesson_plans" })
@Index("uq_course_lesson_plans_course_id_lesson_plan_id", ["courseId", "lessonPlanId"], {
  unique: true,
})
@Index("uq_course_lesson_plans_course_id_position", ["courseId", "position"], { unique: true })
// Serves "in how many courses is this plan" (courseCount) and the list of use of a plan (GUS-96).
@Index("idx_course_lesson_plans_lesson_plan_id", ["lessonPlanId"])
@Check("ck_course_lesson_plans_position", '"position" >= 1')
@ForeignKey(() => Course, ["course_id"], ["id"], { name: "fk_course_lesson_plans_course_id" })
@ForeignKey(() => LessonPlan, ["lesson_plan_id"], ["id"], {
  name: "fk_course_lesson_plans_lesson_plan_id",
})
export class CourseLessonPlan extends BaseEntity {
  @Column({ name: "course_id", type: "uuid" })
  courseId: string;

  @Column({ name: "lesson_plan_id", type: "uuid" })
  lessonPlanId: string;

  /** Place of the plan in the sequence of the course, from 1. */
  @Column({ name: "position", type: "integer" })
  position: number;
}
