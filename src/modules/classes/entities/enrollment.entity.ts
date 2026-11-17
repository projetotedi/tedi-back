import { Check, Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import { SchoolClass } from "./class.entity";

/**
 * The enrollment of a student in a class (RN-15: always in a class, never straight in a course),
 * with its status (RF-027). The roll call, the history of the student and the courses she
 * completed come from here (RF-031, RN-16). Removing an enrollment is a soft delete (`deletedAt`),
 * only of an active one: dropped and completed are history.
 *
 * - `uq_enrollments_class_id_student_id` is unique on (class, student) among the rows that are not
 *   removed: one live enrollment per pair, and a removed one frees the pair, so enrolling again is
 *   a new row.
 * - `student_id` points to `people`, as `lesson_assignments.person_id` does: "is a student" (has a
 *   student profile) is a rule of the service, not of the foreign key. It is a table name because
 *   `classes` does not import `Person` (section 10.1); the string only resolves when the DataSource
 *   loads every entity.
 * - `ck_enrollments_status_changed_at` keeps `statusChangedAt` on or after the day of the
 *   enrollment in America/Sao_Paulo. The zone is literal, the same text as the migration: the
 *   schema e2e compares this expression with it.
 * - `statusReason` is free text that may carry health information: it never goes to an event nor
 *   to a listing, only to the answer of the change of status (RNF-13).
 *
 * The foreign keys are declared on the class, without relations, so every constraint name stays
 * under our control (the SQL of the migration is written by hand), the pattern of SchoolClass.
 */
@Entity({ name: "enrollments" })
@Index("uq_enrollments_class_id_student_id", ["classId", "studentId"], {
  unique: true,
  where: `"deleted_at" IS NULL`,
})
@Index("idx_enrollments_student_id", ["studentId"])
@Check(
  "ck_enrollments_status_changed_at",
  `"status_changed_at" >= ("enrolled_at" AT TIME ZONE 'America/Sao_Paulo')::date`,
)
@ForeignKey(() => SchoolClass, ["class_id"], ["id"], { name: "fk_enrollments_class_id" })
@ForeignKey("people", ["student_id"], ["id"], { name: "fk_enrollments_student_id" })
@ForeignKey("people", ["created_by_id"], ["id"], { name: "fk_enrollments_created_by_id" })
export class Enrollment extends BaseEntity {
  @Column({ name: "class_id", type: "uuid" })
  classId: string;

  /** The id of the Person of the student. */
  @Column({ name: "student_id", type: "uuid" })
  studentId: string;

  @Column({
    name: "status",
    type: "enum",
    enum: EnrollmentStatus,
    enumName: "enrollments_status_enum",
    default: EnrollmentStatus.ACTIVE,
  })
  status: EnrollmentStatus;

  /** The instant of the enrollment: the `now` of the POST that created it. */
  @Column({ name: "enrolled_at", type: "timestamptz" })
  enrolledAt: Date;

  /** "YYYY-MM-DD" in America/Sao_Paulo: from when the current status holds (M4). */
  @Column({ name: "status_changed_at", type: "date" })
  statusChangedAt: string;

  /** Why the status changed last; null without a reason. Never in an event or a listing. */
  @Column({ name: "status_reason", type: "varchar", length: 500, nullable: true, default: null })
  statusReason: string | null;

  @Column({ name: "created_by_id", type: "uuid" })
  createdById: string;
}
