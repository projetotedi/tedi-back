import { Check, Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";
import { StudentAttendance } from "./student-attendance.entity";

/**
 * One correction of the attendance of a student (GUS-166, S10): from which status to which, why, and
 * who did it. `createdAt` is the instant of the correction.
 *
 * Append-only: the trigger `trg_attendance_corrections_append_only` of the migration refuses UPDATE
 * and DELETE (23001), the pattern of `hour_entry_events`. A correction always changes the status
 * (`ck_attendance_corrections_status_changed`) and has a reason that is not blank
 * (`ck_attendance_corrections_reason`). The reason is free text that may carry health data: it never
 * goes to an event, and the list shows it only to whoever takes the roll call of the lesson.
 *
 * The foreign keys are declared on the class and without relations, the pattern of
 * StudentAttendance: the attendance by its entity (this module), the person by table name.
 */
@Entity({ name: "attendance_corrections" })
@Index("idx_attendance_corrections_student_attendance_id", ["studentAttendanceId"])
@Check("ck_attendance_corrections_status_changed", `"from_status" <> "to_status"`)
@Check("ck_attendance_corrections_reason", `length(btrim("reason")) > 0`)
@ForeignKey(() => StudentAttendance, ["student_attendance_id"], ["id"], {
  name: "fk_attendance_corrections_student_attendance_id",
})
@ForeignKey("people", ["corrected_by_id"], ["id"], {
  name: "fk_attendance_corrections_corrected_by_id",
})
export class AttendanceCorrection extends BaseEntity {
  @Column({ name: "student_attendance_id", type: "uuid" })
  studentAttendanceId: string;

  @Column({
    name: "from_status",
    type: "enum",
    enum: StudentAttendanceStatus,
    enumName: "student_attendance_status_enum",
  })
  fromStatus: StudentAttendanceStatus;

  @Column({
    name: "to_status",
    type: "enum",
    enum: StudentAttendanceStatus,
    enumName: "student_attendance_status_enum",
  })
  toStatus: StudentAttendanceStatus;

  /** Why it was corrected. Never in an event (RNF-13). */
  @Column({ name: "reason", type: "varchar", length: 500 })
  reason: string;

  @Column({ name: "corrected_by_id", type: "uuid" })
  correctedById: string;
}
