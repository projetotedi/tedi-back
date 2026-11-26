import { Check, Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { MemberAttendanceStatus } from "../enums/member-attendance-status.enum";

/**
 * The attendance of a member at a lesson (F6.2, GUS-168): whether the teacher or a monitor was
 * there, who signed it and when, and the hour entry a presence generated.
 *
 * The attendance is of the PERSON in the lesson, not of the row of the assignment:
 * `uq_member_attendance_lesson_id_person_id` keeps one per person per lesson. `assignmentId` is the
 * confirmed assignment through which it was signed the last time it was written; a member cancelled
 * and assigned again finds the attendance she had. `lessonId` and `personId` are a copy of the
 * assignment (immutable there), so this module never reads the table of `assignments`.
 *
 * `hourEntryId` points to the hour entry the presence generated, and keeps pointing to it after the
 * cancellation of the lesson reverses it (its history shows the `reversed`). A present row always
 * has one and an absent row never does: `ck_member_attendance_hour_entry`.
 *
 * The row is never deleted: the soft delete of BaseEntity is not used, and the unique index ignores
 * soft-deleted rows only by the convention of the repository. The foreign keys are declared on the
 * class, by table name and without relations, the same pattern as Lesson and HourEntry: the tables
 * belong to other modules, whose entities this one does not import.
 */
@Entity({ name: "member_attendance" })
@Index("uq_member_attendance_lesson_id_person_id", ["lessonId", "personId"], {
  unique: true,
  where: `"deleted_at" IS NULL`,
})
@Index("idx_member_attendance_person_id", ["personId"])
@Check("ck_member_attendance_hour_entry", `("status" = 'present') = ("hour_entry_id" IS NOT NULL)`)
@ForeignKey("lesson_assignments", ["assignment_id"], ["id"], {
  name: "fk_member_attendance_assignment_id",
})
@ForeignKey("lessons", ["lesson_id"], ["id"], { name: "fk_member_attendance_lesson_id" })
@ForeignKey("people", ["person_id"], ["id"], { name: "fk_member_attendance_person_id" })
@ForeignKey("people", ["confirmed_by_id"], ["id"], {
  name: "fk_member_attendance_confirmed_by_id",
})
@ForeignKey("hour_entries", ["hour_entry_id"], ["id"], {
  name: "fk_member_attendance_hour_entry_id",
})
export class MemberAttendance extends BaseEntity {
  /** The confirmed assignment through which the attendance was signed the last time. */
  @Column({ name: "assignment_id", type: "uuid" })
  assignmentId: string;

  @Column({ name: "lesson_id", type: "uuid" })
  lessonId: string;

  /** The member whose attendance it is. */
  @Column({ name: "person_id", type: "uuid" })
  personId: string;

  @Column({
    name: "status",
    type: "enum",
    enum: MemberAttendanceStatus,
    enumName: "member_attendance_status_enum",
  })
  status: MemberAttendanceStatus;

  /** Who signed it the last time (the first signature or a correction). */
  @Column({ name: "confirmed_by_id", type: "uuid" })
  confirmedById: string;

  @Column({ name: "confirmed_at", type: "timestamptz" })
  confirmedAt: Date;

  /** The hour entry the presence generated; null for an absence. */
  @Column({ name: "hour_entry_id", type: "uuid", nullable: true, default: null })
  hourEntryId: string | null;
}
