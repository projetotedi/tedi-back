import { Column, Entity, ForeignKey } from "typeorm";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import { BaseEntity } from "@shared/entities/base.entity";
import { CourseCategory } from "../enums/course-category.enum";

/**
 * Reusable teaching plan of the project: name, description, objective, category and
 * prerequisites (RF-013, RF-021). Every class (turma) is an offering of a course (RN-13).
 * Archived instead of deleted (RN-27), through `ArchivableColumns`.
 *
 * The name is unique among all courses, archived ones included, ignoring case: the migration
 * creates `uq_courses_name` as a unique index on `LOWER("name")`. TypeORM cannot declare an
 * expression index (`@Index` only takes columns), so the index is NOT declared here, on purpose:
 * this repo never runs `synchronize` or `migration:generate` (see ci.yml), so nothing would drop
 * or recreate it. The schema e2e (`courses.repository.e2e.spec.ts`) checks it straight in
 * `pg_indexes` (unique, on lower(name)) and proves a second name differing only in case is
 * rejected (23505). CoursesService maps that violation to 409 COURSE_NAME_TAKEN.
 *
 * The prerequisites are rows of `course_prerequisites` (see CoursePrerequisite), not a relation
 * on this class. The foreign keys are declared on the class, by table name, and without
 * relations: this keeps every constraint name under our control (the SQL of the migration is
 * written by hand), the same pattern as LessonPlan.
 */
@Entity({ name: "courses" })
@ForeignKey("people", ["created_by_id"], ["id"], { name: "fk_courses_created_by_id" })
@ForeignKey("people", ["archived_by_id"], ["id"], { name: "fk_courses_archived_by_id" })
export class Course extends BaseEntity {
  @Column({ name: "name", type: "varchar", length: 200 })
  name: string;

  @Column({ name: "description", type: "text" })
  description: string;

  @Column({ name: "objective", type: "text", nullable: true, default: null })
  objective: string | null;

  /** Level of the content. A class takes it from here when created (RN-14). */
  @Column({
    name: "category",
    type: "enum",
    enum: CourseCategory,
    enumName: "courses_category_enum",
  })
  category: CourseCategory;

  @Column({ name: "created_by_id", type: "uuid" })
  createdById: string;

  @Column(() => ArchivableColumns, { prefix: false })
  archive: ArchivableColumns;
}
