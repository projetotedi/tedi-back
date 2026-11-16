import { Inject, Injectable } from "@nestjs/common";
import { EntityManager, In } from "typeorm";
import { minutesBetween } from "@shared/dates/time-of-day";
import { AuditableAction, AuditableActionEvent } from "@shared/events/auditable-action.event";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { buildHourEntryAuditEvent } from "./hour-entry-audit";
import { HoursService } from "./hours.service";

/**
 * Token of the status lesson hours are born with (Q6.6, still open with the PO): a provider of
 * `hours.module.ts`, not an env, so a test swaps it and the decision changes in one line. With
 * `pending`, see the risk 4 of docs/ARCHITECTURE.md section 18.
 */
export const LESSON_HOURS_INITIAL_STATUS = "LESSON_HOURS_INITIAL_STATUS";

export type LessonHoursInitialStatus = HourEntryStatus.APPROVED | HourEntryStatus.PENDING;

/** A presence signed in a lesson: whose it is, who signed it and the lesson as it is now. */
export interface LessonPresence {
  personId: string;
  confirmedById: string;
  lesson: {
    id: string;
    classId: string;
    title: string;
    /** "YYYY-MM-DD". */
    date: string;
    /** "HH:mm". */
    startTime: string;
    /** "HH:mm". */
    endTime: string;
  };
}

/** The entry a presence generated, and the audit events the caller emits AFTER its commit. */
export interface RecordedLessonHours {
  hourEntryId: string;
  auditEvents: AuditableActionEvent[];
}

/**
 * The lesson hours of the attendance (F7.1, RF-060, GUS-168): the one entry point of the attendance
 * in `hours`, and the only export of HoursModule. The attendance keeps the entry its presence
 * generated (`hour_entry_id`), so the presence and its hours are written in ONE transaction: every
 * method takes the `manager` and the `now` of the caller, opens no transaction and emits nothing,
 * and the caller emits the audit events it gets back after its commit (the pattern of
 * `HoursService.createEntry`).
 *
 * Reversing (RF-071, RN-07) is a soft delete of the entry, at `now`, with a `reversed` row in its
 * history and HOUR_ENTRY_REVERSED. It reverses an entry in any status (approved, adjusted, rejected
 * or pending): the review only acts on pending ones, and both lock the row FOR UPDATE. The entries
 * are always locked in the order of their ids, as the review does, so a correction of the
 * attendance, the cancellation of the lesson and a batch of the review never wait in a circle.
 */
@Injectable()
export class LessonHoursService {
  constructor(
    private readonly hours: HoursService,
    @Inject(LESSON_HOURS_INITIAL_STATUS) private readonly initialStatus: LessonHoursInitialStatus,
  ) {}

  /**
   * Writes the lesson hours of a presence: `origin` attendance, category lesson, the title of the
   * lesson as the activity, its day, its duration in minutes (the real duration of the lesson,
   * RN-03, as scheduled when it is signed) and its class, authored by who signed. Born approved by
   * who signed while LESSON_HOURS_INITIAL_STATUS says so, otherwise pending for the review.
   */
  async recordPresence(
    manager: EntityManager,
    presence: LessonPresence,
    now: Date,
  ): Promise<RecordedLessonHours> {
    const { lesson } = presence;
    const { entry, auditEvents } = await this.hours.createEntry(
      manager,
      {
        personId: presence.personId,
        createdById: presence.confirmedById,
        origin: HourEntryOrigin.ATTENDANCE,
        activity: lesson.title,
        category: HourEntryCategory.LESSON,
        date: lesson.date,
        declaredMinutes: minutesBetween(lesson.startTime, lesson.endTime),
        notes: null,
        classId: lesson.classId,
        lessonId: lesson.id,
        approvedById:
          this.initialStatus === HourEntryStatus.APPROVED ? presence.confirmedById : null,
      },
      now,
    );

    return { hourEntryId: entry.id, auditEvents };
  }

  /**
   * Reverses the entries of a correction to absent, all in one call (one lock in the order of the
   * ids). An entry already removed or reversed is not found and is skipped: reversing again is a
   * no-op. An empty list answers [] without querying.
   */
  async reverseEntries(
    manager: EntityManager,
    hourEntryIds: readonly string[],
    actorId: string,
    now: Date,
  ): Promise<AuditableActionEvent[]> {
    if (hourEntryIds.length === 0) return [];

    const entries = await manager.find(HourEntry, {
      where: { id: In([...hourEntryIds]) },
      order: { id: "ASC" },
      lock: { mode: "pessimistic_write" },
    });
    return this.reverse(manager, entries, actorId, now);
  }

  /**
   * Reverses every ACTIVE attendance entry of a lesson (its cancellation, RN-07). The ones already
   * reversed (by a correction, or by this same cancellation arriving twice) are not found, so it is
   * idempotent; a lesson without them writes nothing and answers [].
   */
  async reverseLessonEntries(
    manager: EntityManager,
    lessonId: string,
    actorId: string,
    now: Date,
  ): Promise<AuditableActionEvent[]> {
    const entries = await manager.find(HourEntry, {
      where: { lessonId, origin: HourEntryOrigin.ATTENDANCE },
      order: { id: "ASC" },
      lock: { mode: "pessimistic_write" },
    });
    return this.reverse(manager, entries, actorId, now);
  }

  /**
   * One UPDATE soft-deletes the entries (`deleted_at` and `updated_at` are `now`, never the clock of
   * the database: `softDelete` would use it) and one save writes a `reversed` row each. The row
   * goes from the status and the minutes the entry was worth to nothing: the validated minutes of
   * an approved or adjusted entry, 0 of a rejected one, the declared minutes of a pending one
   * (`??` and not `||`: 0 is a value).
   */
  private async reverse(
    manager: EntityManager,
    entries: HourEntry[],
    actorId: string,
    now: Date,
  ): Promise<AuditableActionEvent[]> {
    if (entries.length === 0) return [];

    await manager.update(
      HourEntry,
      { id: In(entries.map((entry) => entry.id)) },
      { deletedAt: now, updatedAt: now },
    );
    await manager.save(
      HourEntryEvent,
      entries.map((entry) =>
        manager.create(HourEntryEvent, {
          hourEntryId: entry.id,
          type: HourEntryEventType.REVERSED,
          actorId,
          fromStatus: entry.status,
          toStatus: null,
          fromMinutes: entry.validatedMinutes ?? entry.declaredMinutes,
          toMinutes: null,
          note: null,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    );

    return entries.map((entry) =>
      buildHourEntryAuditEvent({
        action: AuditableAction.HOUR_ENTRY_REVERSED,
        actorId,
        hourEntryId: entry.id,
        before: {
          personId: entry.personId,
          lessonId: entry.lessonId,
          status: entry.status,
          declaredMinutes: entry.declaredMinutes,
          validatedMinutes: entry.validatedMinutes,
        },
        after: { deletedAt: now },
        occurredAt: now,
      }),
    );
  }
}
