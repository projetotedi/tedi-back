import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager } from "typeorm";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { CreateHourEntryDto } from "../dto/create-hour-entry.dto";
import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { hourEntryDateInFuture } from "./hour-entry-errors";
import { toHourEntryResponse } from "./hour-entry-response.mapper";

const HOUR_ENTRY_TARGET_TYPE = "hour_entry";

/**
 * What a new hour entry is, already decided by the caller: whose hours, who logged them and how.
 * Internal to the module, like `createEntry`: the attendance (GUS-168) builds one from a listener
 * of this module.
 */
export interface HourEntryDraft {
  personId: string;
  createdById: string;
  origin: HourEntryOrigin;
  activity: string;
  category: HourEntryCategory;
  /** "YYYY-MM-DD", today or before in APP_TIME_ZONE. */
  date: string;
  declaredMinutes: number;
  notes: string | null;
  /** Only the attendance fills it; omitted is null. */
  classId?: string | null;
  /** Only the attendance fills it; omitted is null. */
  lessonId?: string | null;
}

/** The entry that was written, and the audit event the caller emits AFTER its commit. */
export interface CreatedHourEntry {
  entry: HourEntry;
  auditEvent: AuditableActionEvent;
}

/**
 * Hour entries of the people (E7, GUS-162): log for oneself and read one's own statement.
 *
 * Every write runs in a transaction and the audit event goes out after the commit. Every instant
 * of a write (the columns of the entry, the row of its history and the audit event) is the same
 * `now`, read once from the Clock: the API and the database run on different hosts, and two clocks
 * could put the history of an entry out of order.
 */
@Injectable()
export class HoursService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
  ) {}

  /**
   * The one place that writes a new hour entry, with its `created` event in the history. It is
   * born `pending`, with no validated minutes and no review. The point of reuse of the attendance
   * (GUS-168), which passes `origin: attendance` with the class and the lesson.
   *
   * It does not open a transaction and it emits nothing: the caller passes the `manager` of its
   * transaction and emits `auditEvent` after the commit. 400 HOUR_ENTRY_DATE_IN_FUTURE for a day
   * after today in APP_TIME_ZONE, before anything is written: the rule lives here so every way in
   * (the two routes and the attendance) gets it.
   *
   * The audit event carries no free text (`activity`, `notes`): RNF-13.
   */
  async createEntry(manager: EntityManager, draft: HourEntryDraft): Promise<CreatedHourEntry> {
    const now = this.clock.now();
    if (draft.date > todayInAppTimeZone(now)) throw hourEntryDateInFuture();

    const entry = await manager.save(
      manager.create(HourEntry, {
        personId: draft.personId,
        createdById: draft.createdById,
        origin: draft.origin,
        activity: draft.activity,
        category: draft.category,
        date: draft.date,
        declaredMinutes: draft.declaredMinutes,
        notes: draft.notes,
        classId: draft.classId ?? null,
        lessonId: draft.lessonId ?? null,
        status: HourEntryStatus.PENDING,
        validatedMinutes: null,
        reviewNote: null,
        reviewedById: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await manager.save(
      manager.create(HourEntryEvent, {
        hourEntryId: entry.id,
        type: HourEntryEventType.CREATED,
        actorId: draft.createdById,
        fromStatus: null,
        toStatus: HourEntryStatus.PENDING,
        fromMinutes: null,
        toMinutes: entry.declaredMinutes,
        note: null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const auditEvent = this.buildAuditEvent(
      AuditableAction.HOUR_ENTRY_CREATED,
      draft.createdById,
      entry.id,
      null,
      {
        personId: entry.personId,
        category: entry.category,
        date: entry.date,
        declaredMinutes: entry.declaredMinutes,
        status: entry.status,
        origin: entry.origin,
        classId: entry.classId,
        lessonId: entry.lessonId,
      },
      now,
    );

    return { entry, auditEvent };
  }

  /**
   * `POST /me/hour-entries`: the logged-in person logs her own hours, `manual` and authored by
   * herself. Errors: 400 VALIDATION_FAILED (the DTO) and 400 HOUR_ENTRY_DATE_IN_FUTURE. Emits
   * HOUR_ENTRY_CREATED after the commit.
   */
  async logMyHours(dto: CreateHourEntryDto, actor: AuthUser): Promise<HourEntryResponseDto> {
    const { entry, auditEvent } = await this.dataSource.transaction((manager) =>
      this.createEntry(manager, {
        personId: actor.id,
        createdById: actor.id,
        origin: HourEntryOrigin.MANUAL,
        activity: dto.activity,
        category: dto.category,
        date: dto.date,
        declaredMinutes: dto.declaredMinutes,
        notes: dto.notes ?? null,
      }),
    );

    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, auditEvent);
    return toHourEntryResponse(entry);
  }

  private buildAuditEvent(
    action: AuditableAction,
    actorId: string,
    hourEntryId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    occurredAt: Date,
  ): AuditableActionEvent {
    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = action;
    event.targetType = HOUR_ENTRY_TARGET_TYPE;
    event.targetId = hourEntryId;
    event.before = before;
    event.after = after;
    event.occurredAt = occurredAt;
    return event;
  }
}
