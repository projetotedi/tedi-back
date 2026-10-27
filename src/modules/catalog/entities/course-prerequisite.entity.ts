import { Check, Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { Course } from "./course.entity";

/**
 * One prerequisite of a course (RF-021): `courseId` requires `prerequisiteId`. A table with its
 * own id, like LessonPlanContent, and not a `@ManyToMany`: every entity extends BaseEntity.
 *
 * A course never requires itself (`ck_course_prerequisites_not_self`). A longer cycle (A requires
 * B, B requires A) cannot be a constraint: CoursesService refuses it with 400 PREREQUISITE_CYCLE
 * while it holds an advisory lock that serializes every edit of the graph.
 *
 * The set of prerequisites of a course is replaced as a whole on edit, with a hard delete of its
 * rows followed by the new inserts, so the unique index never meets a leftover row.
 */
@Entity({ name: "course_prerequisites" })
@Index("uq_course_prerequisites_course_id_prerequisite_id", ["courseId", "prerequisiteId"], {
  unique: true,
})
// Serves "which courses require this one" (GUS-100).
@Index("idx_course_prerequisites_prerequisite_id", ["prerequisiteId"])
@Check("ck_course_prerequisites_not_self", '"course_id" <> "prerequisite_id"')
@ForeignKey(() => Course, ["course_id"], ["id"], { name: "fk_course_prerequisites_course_id" })
@ForeignKey(() => Course, ["prerequisite_id"], ["id"], {
  name: "fk_course_prerequisites_prerequisite_id",
})
export class CoursePrerequisite extends BaseEntity {
  @Column({ name: "course_id", type: "uuid" })
  courseId: string;

  @Column({ name: "prerequisite_id", type: "uuid" })
  prerequisiteId: string;
}
