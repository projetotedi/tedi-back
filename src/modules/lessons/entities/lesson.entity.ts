import { Check, Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { timeOfDayTransformer } from "@shared/entities/time-of-day.transformer";
import { LessonStatus } from "../enums/lesson-status.enum";

/**
 * A lesson (aula): one meeting of a class (turma), on a day, from a time to a time. It can come
 * from a lesson plan of the catalog, or be created on its own. The unit that the calendar,
 * the allocation of teachers and monitors, the attendance and, later, the hours are built on.
 *
 * It is not archived, and it is not deleted: its end state is `cancelled` (F4.5), which keeps the
 * row, the reason and who cancelled it. That is why there are no `ArchivableColumns`. Cancelling
 * a lesson reverses the hours already recorded for it (RN-07); this module only announces it, with
 * the `lesson.cancelled` event, and the `hours` module does the rest.
 *
 * `classId`, `lessonPlanId` and `sequenceOrder` are fixed when the lesson is created and never
 * change (RN-20): the lesson belongs to one class, and the plan it came from is its origin. The
 * `title` and the `objective` are a COPY of the plan, taken at creation and editable afterwards:
 * editing or archiving the plan later does not touch lessons that already exist (RN-18). So the
 * lesson carries no reference that would make it follow the plan. `sequenceOrder` is the position
 * the plan had in the sequence of the course when the lesson was created, a snapshot (it is only
 * there when the plan is), and it does not follow a later reordering of the sequence.
 *
 * `date` is a calendar day inside the period of its class (RN-21), a "YYYY-MM-DD" string with no
 * time and no time zone, like the dates of SchoolClass. `startTime` and `endTime` are the wall
 * clock of the project, "HH:mm" strings, from the `time` column; the class has no shift (RN-22),
 * so the time of day lives here. A lesson does not cross midnight: it ends after it starts. The
 * duration is not stored: it is the difference between the two times, calculated when read.
 *
 * Moving a lesson is a reschedule, not a new lesson: the id stays and `originalDate` keeps the
 * FIRST day it was scheduled for (it is not overwritten by a second reschedule). `rescheduleReason`
 * and `rescheduleNote` describe the last one. `date`, `startTime` and `endTime` only change
 * through the reschedule, so the original date can never be bypassed.
 *
 * The checks exist because the service is not the only way in, and a row that breaks them would
 * break the calendar (they are the safety net; the service answers first, with a business error):
 * - `ck_lessons_time_range`: a lesson ends after it starts, never at the same minute or before;
 * - `ck_lessons_sequence_order`: the position in the sequence starts at 1;
 * - `ck_lessons_sequence_requires_plan`: a position only makes sense for a lesson that has a plan;
 * - `ck_lessons_expected_students` and `ck_lessons_expected_monitors`: a head count is not negative
 *   (null means "not informed");
 * - `ck_lessons_cancellation`: the status `cancelled` and `cancelled_at` go together, so a row can
 *   never be cancelled without the instant, nor carry an instant while not cancelled.
 *
 * The foreign keys are declared on the class, by table name and without relations: this keeps
 * every constraint name under our control (the SQL of the migration is written by hand), the same
 * pattern as SchoolClass. They are table names because `lessons` imports no entity of another
 * module (docs/ARCHITECTURE.md sections 1 and 10): `classes` and `lesson_plans` belong to other
 * modules and `people` to a third. A string only resolves when the DataSource loads those entities
 * too, so an e2e of this module loads the entities of every module.
 *
 * The index on `(class_id, date)` serves "the lessons of this class, in order", which the
 * listing of a class and its calendar are made of.
 */
@Entity({ name: "lessons" })
@Index("idx_lessons_class_id_date", ["classId", "date"])
@Check("ck_lessons_time_range", '"end_time" > "start_time"')
@Check("ck_lessons_sequence_order", '"sequence_order" IS NULL OR "sequence_order" >= 1')
@Check(
  "ck_lessons_sequence_requires_plan",
  '"sequence_order" IS NULL OR "lesson_plan_id" IS NOT NULL',
)
@Check("ck_lessons_expected_students", '"expected_students" IS NULL OR "expected_students" >= 0')
@Check("ck_lessons_expected_monitors", '"expected_monitors" IS NULL OR "expected_monitors" >= 0')
@Check("ck_lessons_cancellation", `("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)`)
@ForeignKey("classes", ["class_id"], ["id"], { name: "fk_lessons_class_id" })
@ForeignKey("lesson_plans", ["lesson_plan_id"], ["id"], { name: "fk_lessons_lesson_plan_id" })
@ForeignKey("people", ["created_by_id"], ["id"], { name: "fk_lessons_created_by_id" })
@ForeignKey("people", ["cancelled_by_id"], ["id"], { name: "fk_lessons_cancelled_by_id" })
export class Lesson extends BaseEntity {
  /** The class this lesson belongs to. It never changes after the lesson is created (RN-20). */
  @Column({ name: "class_id", type: "uuid" })
  classId: string;

  /** The plan this lesson was created from, or null for a lesson created on its own (RN-20). */
  @Column({ name: "lesson_plan_id", type: "uuid", nullable: true, default: null })
  lessonPlanId: string | null;

  /** Position the plan had in the sequence of the course when this lesson was created (RN-20). */
  @Column({ name: "sequence_order", type: "integer", nullable: true, default: null })
  sequenceOrder: number | null;

  /** Copied from the plan when the lesson comes from one, editable afterwards (RN-18). */
  @Column({ name: "title", type: "varchar", length: 200 })
  title: string;

  /** Copied from the plan when the lesson comes from one, editable afterwards (RN-18). */
  @Column({ name: "objective", type: "text", nullable: true, default: null })
  objective: string | null;

  /** Day of the lesson, "YYYY-MM-DD", inside the period of the class (RN-21). */
  @Column({ name: "date", type: "date" })
  date: string;

  /** "HH:mm". Postgres hands the `time` column over as "HH:mm:ss"; the transformer cuts it. */
  @Column({ name: "start_time", type: "time", transformer: timeOfDayTransformer })
  startTime: string;

  /** "HH:mm", after `startTime`. */
  @Column({ name: "end_time", type: "time", transformer: timeOfDayTransformer })
  endTime: string;

  @Column({ name: "location", type: "varchar", length: 200, nullable: true, default: null })
  location: string | null;

  /** How many students are expected. Null means not informed; it is not copied from the class. */
  @Column({ name: "expected_students", type: "integer", nullable: true, default: null })
  expectedStudents: number | null;

  /** How many monitors are expected. Null means not informed. */
  @Column({ name: "expected_monitors", type: "integer", nullable: true, default: null })
  expectedMonitors: number | null;

  /** Free text: what the lesson is about, apart from the title. */
  @Column({ name: "subject", type: "varchar", length: 200, nullable: true, default: null })
  subject: string | null;

  /** Notes written after the lesson. Free text: it can hold personal data (RNF-13). */
  @Column({ name: "post_notes", type: "text", nullable: true, default: null })
  postNotes: string | null;

  @Column({
    name: "status",
    type: "enum",
    enum: LessonStatus,
    enumName: "lessons_status_enum",
    default: LessonStatus.PLANNED,
  })
  status: LessonStatus;

  /** Why the lesson was cancelled. Set with `cancelledAt`. Free text (RNF-13). */
  @Column({ name: "cancel_reason", type: "text", nullable: true, default: null })
  cancelReason: string | null;

  /** The instant of the cancellation. Not null exactly when the status is `cancelled`. */
  @Column({ name: "cancelled_at", type: "timestamptz", nullable: true, default: null })
  cancelledAt: Date | null;

  @Column({ name: "cancelled_by_id", type: "uuid", nullable: true, default: null })
  cancelledById: string | null;

  /** The first day the lesson was scheduled for, set by the first reschedule and kept after it. */
  @Column({ name: "original_date", type: "date", nullable: true, default: null })
  originalDate: string | null;

  /** Why the lesson was moved, in the last reschedule. Free text (RNF-13). */
  @Column({ name: "reschedule_reason", type: "text", nullable: true, default: null })
  rescheduleReason: string | null;

  /** A note about the last reschedule. Free text (RNF-13). */
  @Column({ name: "reschedule_note", type: "text", nullable: true, default: null })
  rescheduleNote: string | null;

  @Column({ name: "created_by_id", type: "uuid" })
  createdById: string;
}
