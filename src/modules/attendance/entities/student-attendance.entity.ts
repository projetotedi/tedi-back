import { Check, Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { AbsenceJustificationReason } from "../enums/absence-justification-reason.enum";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";

/**
 * The attendance of a student at a lesson (F6.1, GUS-166): whether the ENROLLMENT was there, who
 * signed it and when, and the justification of an absence. Students generate no hours.
 *
 * The attendance is of the enrollment in the lesson (`uq_student_attendance_lesson_id_enrollment_id`):
 * the roll call of a lesson is the enrollments its class expects on its day plus the ones signed in
 * it, whatever happens to them later (docs/ARCHITECTURE.md section 18.1, S2). `signedById` and
 * `signedAt` are the first signature and never change: a correction has its own author and instant,
 * in `attendance_corrections`.
 *
 * The justification only exists on an absence (`ck_student_attendance_justification_absent`), and
 * its reason, who and when come together, the note only with a reason
 * (`ck_student_attendance_justification_columns`). The note is free text that may carry health
 * data: it never goes to an event (RNF-13).
 *
 * The row is never deleted (an enrollment with attendance cannot be removed, S15): the soft delete
 * of BaseEntity is not used, and the unique index ignores soft-deleted rows only by the convention of
 * the repository. The foreign keys are declared on the class, by table name and without relations:
 * the tables belong to other modules, whose entities this one does not import.
 */
@Entity({ name: "student_attendance" })
@Index("uq_student_attendance_lesson_id_enrollment_id", ["lessonId", "enrollmentId"], {
  unique: true,
  where: `"deleted_at" IS NULL`,
})
@Index("idx_student_attendance_enrollment_id", ["enrollmentId"])
@Check(
  "ck_student_attendance_justification_absent",
  `"justification_reason" IS NULL OR "status" = 'absent'`,
)
@Check(
  "ck_student_attendance_justification_columns",
  `("justification_reason" IS NULL) = ("justified_by_id" IS NULL) AND ("justification_reason" IS NULL) = ("justified_at" IS NULL) AND ("justification_note" IS NULL OR "justification_reason" IS NOT NULL)`,
)
@ForeignKey("lessons", ["lesson_id"], ["id"], { name: "fk_student_attendance_lesson_id" })
@ForeignKey("enrollments", ["enrollment_id"], ["id"], {
  name: "fk_student_attendance_enrollment_id",
})
@ForeignKey("people", ["signed_by_id"], ["id"], { name: "fk_student_attendance_signed_by_id" })
@ForeignKey("people", ["justified_by_id"], ["id"], {
  name: "fk_student_attendance_justified_by_id",
})
export class StudentAttendance extends BaseEntity {
  @Column({ name: "lesson_id", type: "uuid" })
  lessonId: string;

  @Column({ name: "enrollment_id", type: "uuid" })
  enrollmentId: string;

  @Column({
    name: "status",
    type: "enum",
    enum: StudentAttendanceStatus,
    enumName: "student_attendance_status_enum",
  })
  status: StudentAttendanceStatus;

  /** Who signed the attendance for the first time. A correction does not change it. */
  @Column({ name: "signed_by_id", type: "uuid" })
  signedById: string;

  @Column({ name: "signed_at", type: "timestamptz" })
  signedAt: Date;

  /** Why the student missed the lesson; null while the absence is not justified. */
  @Column({
    name: "justification_reason",
    type: "enum",
    enum: AbsenceJustificationReason,
    enumName: "student_attendance_justification_reason_enum",
    nullable: true,
    default: null,
  })
  justificationReason: AbsenceJustificationReason | null;

  /** Free text of the justification. Never in an event (RNF-13). */
  @Column({
    name: "justification_note",
    type: "varchar",
    length: 500,
    nullable: true,
    default: null,
  })
  justificationNote: string | null;

  /** Who justified the absence the last time; null without a justification. */
  @Column({ name: "justified_by_id", type: "uuid", nullable: true, default: null })
  justifiedById: string | null;

  @Column({ name: "justified_at", type: "timestamptz", nullable: true, default: null })
  justifiedAt: Date | null;
}
