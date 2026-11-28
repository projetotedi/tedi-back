import { Check, Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatusReason } from "../enums/assignment-status-reason.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";

/**
 * The assignment (alocação) of a member to a lesson, as teacher or as monitor (RF-047). It is what
 * the coverage of a lesson (F5.4) counts, and the base the attendance and, later, the hours are
 * built on: the hours of a lesson are born from the presence of whoever is assigned to it.
 *
 * It starts `pending` or `confirmed` (the coordinator or the director chooses, `source` `direct`),
 * and it is never deleted or archived: its end state is `cancelled` (or `declined`, an application
 * that was refused, GUS-160, or `expired`, an application nobody decided in time, GUS-179), which
 * keeps the row, so the history of who was assigned stays. That is why there are no
 * `ArchivableColumns`. A member that was cancelled can be assigned to the same
 * lesson again: it is a new row.
 *
 * Two rules are held by the database, as partial unique indexes, because two requests at the same
 * time would pass the pre-checks of the service together (docs/ARCHITECTURE.md section 15):
 * - `uq_lesson_assignments_lesson_id_person_id_active`: one member holds at most one place in a
 *   lesson, as teacher or as monitor, never both and never twice (RN-01). Only `pending` and
 *   `confirmed` rows count: a `cancelled`, `declined` or `expired` one frees the place;
 * - `uq_lesson_assignments_lesson_id_confirmed_teacher`: a lesson has at most one CONFIRMED
 *   teacher (RN-02). Several `pending` teachers are fine (candidates), and a monitor never counts.
 * Both ignore soft-deleted rows. `idx_lesson_assignments_lesson_id` serves "the staff of this
 * lesson" and `idx_lesson_assignments_person_id` serves "the lessons of this member".
 *
 * The checks exist because the service is not the only way in, and a row that breaks them would
 * lie about who did what (they are the safety net; the service answers first, with a business
 * error):
 * - `ck_lesson_assignments_cancellation`: the status `cancelled` and `cancelled_at` go together;
 * - `ck_lesson_assignments_cancelled_by`: who cancelled and when go together;
 * - `ck_lesson_assignments_reviewed_by`: who reviewed (confirmed, or refused an application) and
 *   when go together;
 * - `ck_lesson_assignments_confirmed_reviewed`: a confirmed assignment always says who confirmed
 *   it and when. Cancelling a confirmed one keeps its `reviewed_*` and adds `cancelled_*`.
 *
 * `note` is free text and can hold personal data (RNF-13): only who can manage assignments
 * (`assignments.create`) reads it, the other profiles get null in the list of a lesson, and it is
 * never in an audit event.
 *
 * The foreign keys are declared on the class, by table name and without relations: this keeps
 * every constraint name under our control (the SQL of the migration is written by hand), the same
 * pattern as Lesson. They are table names because `assignments` imports no entity of another
 * module (docs/ARCHITECTURE.md sections 1 and 10): `lessons` and `people` belong to other modules.
 * A string only resolves when the DataSource loads those entities too, so an e2e of this module
 * loads the entities of every module.
 */
@Entity({ name: "lesson_assignments" })
@Index("uq_lesson_assignments_lesson_id_person_id_active", ["lessonId", "personId"], {
  unique: true,
  where: `"status" IN ('pending', 'confirmed') AND "deleted_at" IS NULL`,
})
@Index("uq_lesson_assignments_lesson_id_confirmed_teacher", ["lessonId"], {
  unique: true,
  where: `"role" = 'teacher' AND "status" = 'confirmed' AND "deleted_at" IS NULL`,
})
@Index("idx_lesson_assignments_lesson_id", ["lessonId"])
@Index("idx_lesson_assignments_person_id", ["personId"])
@Check(
  "ck_lesson_assignments_cancellation",
  `("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)`,
)
@Check(
  "ck_lesson_assignments_cancelled_by",
  `("cancelled_at" IS NULL) = ("cancelled_by_id" IS NULL)`,
)
@Check("ck_lesson_assignments_reviewed_by", `("reviewed_at" IS NULL) = ("reviewed_by_id" IS NULL)`)
@Check(
  "ck_lesson_assignments_confirmed_reviewed",
  `"status" <> 'confirmed' OR "reviewed_at" IS NOT NULL`,
)
@ForeignKey("lessons", ["lesson_id"], ["id"], { name: "fk_lesson_assignments_lesson_id" })
@ForeignKey("people", ["person_id"], ["id"], { name: "fk_lesson_assignments_person_id" })
@ForeignKey("people", ["created_by_id"], ["id"], { name: "fk_lesson_assignments_created_by_id" })
@ForeignKey("people", ["reviewed_by_id"], ["id"], { name: "fk_lesson_assignments_reviewed_by_id" })
@ForeignKey("people", ["cancelled_by_id"], ["id"], {
  name: "fk_lesson_assignments_cancelled_by_id",
})
export class LessonAssignment extends BaseEntity {
  /** The lesson the member is assigned to. */
  @Column({ name: "lesson_id", type: "uuid" })
  lessonId: string;

  /** The member who teaches or monitors the lesson. */
  @Column({ name: "person_id", type: "uuid" })
  personId: string;

  @Column({
    name: "role",
    type: "enum",
    enum: AssignmentRole,
    enumName: "lesson_assignments_role_enum",
  })
  role: AssignmentRole;

  /** `pending` by default, the safe side: nobody is staff of a lesson without somebody saying so. */
  @Column({
    name: "status",
    type: "enum",
    enum: AssignmentStatus,
    enumName: "lesson_assignments_status_enum",
    default: AssignmentStatus.PENDING,
  })
  status: AssignmentStatus;

  @Column({
    name: "source",
    type: "enum",
    enum: AssignmentSource,
    enumName: "lesson_assignments_source_enum",
    default: AssignmentSource.DIRECT,
  })
  source: AssignmentSource;

  /** Free text about the assignment. It can hold personal data (RNF-13): never in an event. */
  @Column({ name: "note", type: "varchar", length: 500, nullable: true, default: null })
  note: string | null;

  /**
   * Why the system ended the assignment (GUS-179): `lesson_cancelled` when the cancellation of the
   * lesson made it `cancelled` or `expired`. Null for what a person decided.
   */
  @Column({
    name: "status_reason",
    type: "enum",
    enum: AssignmentStatusReason,
    enumName: "lesson_assignments_status_reason_enum",
    nullable: true,
    default: null,
  })
  statusReason: AssignmentStatusReason | null;

  /** Who made the assignment (for an application, the member who applied). */
  @Column({ name: "created_by_id", type: "uuid" })
  createdById: string;

  /**
   * Who decided it: the one who confirmed it, or who made it already confirmed. Set with
   * `reviewedAt`, and kept when the assignment is cancelled later.
   */
  @Column({ name: "reviewed_by_id", type: "uuid", nullable: true, default: null })
  reviewedById: string | null;

  /** The instant of that decision. Not null for every confirmed assignment. */
  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true, default: null })
  reviewedAt: Date | null;

  /** Who withdrew the assignment. Set with `cancelledAt`. */
  @Column({ name: "cancelled_by_id", type: "uuid", nullable: true, default: null })
  cancelledById: string | null;

  /** The instant of the cancellation. Not null exactly when the status is `cancelled`. */
  @Column({ name: "cancelled_at", type: "timestamptz", nullable: true, default: null })
  cancelledAt: Date | null;
}
