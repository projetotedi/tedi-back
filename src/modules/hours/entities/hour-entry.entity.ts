import { Check, Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";

/**
 * An hour entry (lançamento de horas): minutes of work of a person, on a day, in a category,
 * waiting for or after the review by coordination (E7). The bank of hours of a person is made of
 * the validated minutes of her approved and adjusted entries.
 *
 * An entry that was sent is never edited: to fix one, the person removes it (only while it is
 * `pending`) and logs it again. Removing is a soft delete (`deleted_at`): the row stays, so the
 * history that points to it stays whole, and every read of TypeORM leaves it out unless it asks
 * `withDeleted`. Each change is a row of `hour_entry_events`, which is append-only.
 *
 * `declaredMinutes` is what the person says she worked, in whole minutes; `validatedMinutes` is
 * what coordination accepted, null until the review. `createdById` is who logged it: the person
 * herself (`manual`), someone on her behalf (`on_behalf`) or whoever confirmed the attendance
 * (`attendance`). `classId` and `lessonId` are only filled by the attendance (GUS-168).
 *
 * The checks are the safety net of what the service already answers, since the service is not the
 * only way in:
 * - `ck_hour_entries_declared_minutes`: from 1 minute to one day;
 * - `ck_hour_entries_validated_minutes`: null, or from 0 to one day;
 * - `ck_hour_entries_pending_not_validated`: a pending entry has no validated minutes;
 * - `ck_hour_entries_origin_author`: a manual entry is logged by its person, an on_behalf one by
 *   someone else; the attendance takes either.
 *
 * The foreign keys are declared on the class, by table name and without relations, the same
 * pattern as Lesson: `people`, `classes` and `lessons` belong to other modules, whose entities this
 * one does not import. A string only resolves when the DataSource loads those entities too, so an
 * e2e of this module loads the entities of every module.
 *
 * The index on `(person_id, date)` serves the statement and the summary of a person.
 */
@Entity({ name: "hour_entries" })
@Index("idx_hour_entries_person_id_date", ["personId", "date"])
@Check("ck_hour_entries_declared_minutes", '"declared_minutes" > 0 AND "declared_minutes" <= 1440')
@Check(
  "ck_hour_entries_validated_minutes",
  '"validated_minutes" IS NULL OR ("validated_minutes" >= 0 AND "validated_minutes" <= 1440)',
)
@Check(
  "ck_hour_entries_pending_not_validated",
  `"status" <> 'pending' OR "validated_minutes" IS NULL`,
)
@Check(
  "ck_hour_entries_origin_author",
  `"origin" = 'attendance' OR (("origin" = 'manual') = ("created_by_id" = "person_id"))`,
)
@ForeignKey("people", ["person_id"], ["id"], { name: "fk_hour_entries_person_id" })
@ForeignKey("people", ["created_by_id"], ["id"], { name: "fk_hour_entries_created_by_id" })
@ForeignKey("people", ["reviewed_by_id"], ["id"], { name: "fk_hour_entries_reviewed_by_id" })
@ForeignKey("classes", ["class_id"], ["id"], { name: "fk_hour_entries_class_id" })
@ForeignKey("lessons", ["lesson_id"], ["id"], { name: "fk_hour_entries_lesson_id" })
export class HourEntry extends BaseEntity {
  /** Whose hours these are. */
  @Column({ name: "person_id", type: "uuid" })
  personId: string;

  /** What was done. Free text (RNF-13): it never goes to an audit event. */
  @Column({ name: "activity", type: "varchar", length: 200 })
  activity: string;

  @Column({
    name: "category",
    type: "enum",
    enum: HourEntryCategory,
    enumName: "hour_entries_category_enum",
  })
  category: HourEntryCategory;

  /** Day of the work, "YYYY-MM-DD", never after today in APP_TIME_ZONE. */
  @Column({ name: "date", type: "date" })
  date: string;

  /** Minutes the person declares, from 1 to 1440. */
  @Column({ name: "declared_minutes", type: "integer" })
  declaredMinutes: number;

  /** Minutes accepted by coordination; null until the review (GUS-164). */
  @Column({ name: "validated_minutes", type: "integer", nullable: true, default: null })
  validatedMinutes: number | null;

  /** Free text of the person (RNF-13). */
  @Column({ name: "notes", type: "text", nullable: true, default: null })
  notes: string | null;

  @Column({
    name: "status",
    type: "enum",
    enum: HourEntryStatus,
    enumName: "hour_entries_status_enum",
    default: HourEntryStatus.PENDING,
  })
  status: HourEntryStatus;

  @Column({
    name: "origin",
    type: "enum",
    enum: HourEntryOrigin,
    enumName: "hour_entries_origin_enum",
  })
  origin: HourEntryOrigin;

  /** Who logged it: the person herself, someone on her behalf, or whoever confirmed the attendance. */
  @Column({ name: "created_by_id", type: "uuid" })
  createdById: string;

  /** The class of the lesson whose attendance created the entry (GUS-168). */
  @Column({ name: "class_id", type: "uuid", nullable: true, default: null })
  classId: string | null;

  /** The lesson whose attendance created the entry (GUS-168). */
  @Column({ name: "lesson_id", type: "uuid", nullable: true, default: null })
  lessonId: string | null;

  /** Justification of an adjustment or reason of a rejection (GUS-164). Free text (RNF-13). */
  @Column({ name: "review_note", type: "text", nullable: true, default: null })
  reviewNote: string | null;

  @Column({ name: "reviewed_by_id", type: "uuid", nullable: true, default: null })
  reviewedById: string | null;

  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true, default: null })
  reviewedAt: Date | null;
}
