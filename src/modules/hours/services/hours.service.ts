import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, SelectQueryBuilder } from "typeorm";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { CreateHourEntryDto } from "../dto/create-hour-entry.dto";
import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { HoursPeriodQueryDto } from "../dto/hours-period-query.dto";
import { HoursSummaryResponseDto } from "../dto/hours-summary.response.dto";
import { ListMyHourEntriesQueryDto } from "../dto/list-my-hour-entries-query.dto";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import {
  entryNotPending,
  hourEntryDateInFuture,
  hourEntryNotFound,
  invalidPeriod,
} from "./hour-entry-errors";
import { toHourEntryResponse } from "./hour-entry-response.mapper";
import { buildHoursSummary, HoursSummaryRow } from "./hours-summary";

const HOUR_ENTRY_TARGET_TYPE = "hour_entry";

/** 400 INVALID_PERIOD when both ends come and the start is after the end. YYYY-MM-DD compares as text. */
function assertValidPeriod(period: HoursPeriodQueryDto): void {
  if (period.from !== undefined && period.to !== undefined && period.from > period.to) {
    throw invalidPeriod();
  }
}

/** Restricts the query to the days of the period, both ends included, for the ends that come. */
function applyPeriod(builder: SelectQueryBuilder<HourEntry>, period: HoursPeriodQueryDto): void {
  if (period.from !== undefined) builder.andWhere("entry.date >= :from", { from: period.from });
  if (period.to !== undefined) builder.andWhere("entry.date <= :to", { to: period.to });
}

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
 * Hour entries of the people (E7, GUS-162): log for oneself, read one's own statement and summary,
 * and remove one's own pending entry.
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

  /**
   * `GET /me/hour-entries`: the statement of the logged-in person, the most recent day first (then
   * the most recent entry of the day), paginated. Filters by status, category and period, both ends
   * included. Removed entries are left out. 400 INVALID_PERIOD before querying.
   *
   * The person is filtered in the query, by the id of the session: never through the policy.
   */
  async listMyEntries(
    actor: AuthUser,
    query: ListMyHourEntriesQueryDto,
  ): Promise<PaginatedResult<HourEntryResponseDto>> {
    assertValidPeriod(query);
    const { page, limit } = normalizePagination(query);

    const builder = this.dataSource
      .getRepository(HourEntry)
      .createQueryBuilder("entry")
      .where("entry.person_id = :personId", { personId: actor.id });
    if (query.status !== undefined) {
      builder.andWhere("entry.status = :status", { status: query.status });
    }
    if (query.category !== undefined) {
      builder.andWhere("entry.category = :category", { category: query.category });
    }
    applyPeriod(builder, query);

    const [entries, total] = await builder
      .orderBy("entry.date", "DESC")
      .addOrderBy("entry.created_at", "DESC")
      .addOrderBy("entry.id", "DESC")
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();

    return { data: entries.map(toHourEntryResponse), total, page, limit };
  }

  /**
   * `GET /me/hours/summary`: the totals of the logged-in person in the period, by status and by
   * category, and the bank of hours. One query, grouped by status and category (at most 28 rows);
   * the counts are cast to `int` because Postgres sums into `bigint`, which `pg` hands over as a
   * string. Removed entries are left out. 400 INVALID_PERIOD before querying.
   */
  async getMySummary(
    actor: AuthUser,
    query: HoursPeriodQueryDto,
  ): Promise<HoursSummaryResponseDto> {
    assertValidPeriod(query);

    const builder = this.dataSource
      .getRepository(HourEntry)
      .createQueryBuilder("entry")
      .select("entry.status", "status")
      .addSelect("entry.category", "category")
      .addSelect("COUNT(*)::int", "entries")
      .addSelect("COALESCE(SUM(entry.declared_minutes), 0)::int", "declaredMinutes")
      .addSelect("COALESCE(SUM(entry.validated_minutes), 0)::int", "validatedMinutes")
      .where("entry.person_id = :personId", { personId: actor.id });
    applyPeriod(builder, query);

    const rows = await builder
      .groupBy("entry.status")
      .addGroupBy("entry.category")
      .getRawMany<HoursSummaryRow>();

    return buildHoursSummary(rows, { from: query.from ?? null, to: query.to ?? null });
  }

  /**
   * `DELETE /me/hour-entries/:id`: the person removes one of her own pending entries. It is a soft
   * delete: `deleted_at` is set and the row stays, so its history stays whole, and a `removed` event
   * (from `pending` and the declared minutes to nothing) is written in the same transaction.
   *
   * The owner is checked by the query (`id` and `person_id` of the session), never by the policy:
   * the superadmin has `all` on account.manageOwn and would remove anyone's entry. So an entry of
   * another person answers 404 HOUR_ENTRY_NOT_FOUND, like an unknown one and one already removed;
   * a reviewed entry answers 409 ENTRY_NOT_PENDING.
   *
   * The entry is read FOR UPDATE: two removals of it, or a removal and the review of GUS-164, run
   * one after the other. The one that waits reads the row again after the other commits, and
   * answers 404 (it was removed) or 409 (it was reviewed). `deleted_at`, `updated_at`, the instant
   * of the event and the one of the audit are the same `now`. Emits HOUR_ENTRY_REMOVED after the
   * commit.
   *
   * `requestedId` is only the key of the lookup (the pipe accepts upper case): the writes and the
   * event use the id the database returns.
   */
  async removeMyEntry(requestedId: string, actor: AuthUser): Promise<void> {
    const now = this.clock.now();

    const removed = await this.dataSource.transaction(async (manager) => {
      const entry = await manager.findOne(HourEntry, {
        where: { id: requestedId, personId: actor.id },
        lock: { mode: "pessimistic_write" },
      });
      if (entry === null) throw hourEntryNotFound();
      if (entry.status !== HourEntryStatus.PENDING) throw entryNotPending();

      await manager.update(HourEntry, { id: entry.id }, { deletedAt: now, updatedAt: now });
      await manager.save(
        manager.create(HourEntryEvent, {
          hourEntryId: entry.id,
          type: HourEntryEventType.REMOVED,
          actorId: actor.id,
          fromStatus: HourEntryStatus.PENDING,
          toStatus: null,
          fromMinutes: entry.declaredMinutes,
          toMinutes: null,
          note: null,
          createdAt: now,
          updatedAt: now,
        }),
      );

      return entry;
    });

    this.eventEmitter.emit(
      AUDITABLE_ACTION_EVENT,
      this.buildAuditEvent(
        AuditableAction.HOUR_ENTRY_REMOVED,
        actor.id,
        removed.id,
        { status: HourEntryStatus.PENDING, declaredMinutes: removed.declaredMinutes },
        { deletedAt: now },
        now,
      ),
    );
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
