import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, In } from "typeorm";
import { LessonsService } from "@modules/lessons/services/lessons.service";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { AdjustHourEntryDto } from "../dto/adjust-hour-entry.dto";
import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { RejectHourEntryDto } from "../dto/reject-hour-entry.dto";
import { ValidateHourEntriesDto } from "../dto/validate-hour-entries.dto";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { buildHourEntryAuditEvent } from "./hour-entry-audit";
import {
  adjustedMinutesUnchanged,
  duplicateHourEntry,
  entryNotPendingForReview,
  hourEntriesNotFound,
  hourEntryNotFound,
  selfReviewNotAllowed,
} from "./hour-entry-errors";
import { findCancelledLessonIds } from "./hour-entry-lessons";
import { toHourEntryResponse } from "./hour-entry-response.mapper";

/** The statuses a review leads to. */
type ReviewStatus = Exclude<HourEntryStatus, HourEntryStatus.PENDING>;

/** What a review writes on a pending entry. */
interface Review {
  status: ReviewStatus;
  validatedMinutes: number;
  /** The justification of an adjustment or the reason of a rejection; null for an approval. */
  note: string | null;
}

/** Who reviewed and when: the same for every entry, row of history and audit event of a call. */
interface ReviewStamp {
  reviewerId: string;
  now: Date;
}

/** The type of the row of history and the audit action of each review. */
function reviewEventOf(status: ReviewStatus): {
  eventType: HourEntryEventType;
  auditAction: AuditableAction;
} {
  switch (status) {
    case HourEntryStatus.APPROVED:
      return {
        eventType: HourEntryEventType.APPROVED,
        auditAction: AuditableAction.HOUR_ENTRY_APPROVED,
      };
    case HourEntryStatus.ADJUSTED:
      return {
        eventType: HourEntryEventType.ADJUSTED,
        auditAction: AuditableAction.HOUR_ENTRY_ADJUSTED,
      };
    case HourEntryStatus.REJECTED:
      return {
        eventType: HourEntryEventType.REJECTED,
        auditAction: AuditableAction.HOUR_ENTRY_REJECTED,
      };
    default: {
      const unknownStatus: never = status;
      throw new Error(`Unknown review status: ${String(unknownStatus)}.`);
    }
  }
}

/** The approval of an entry of a batch: its own declared minutes, no note. */
function approvalOf(entry: HourEntry): Review {
  return { status: HourEntryStatus.APPROVED, validatedMinutes: entry.declaredMinutes, note: null };
}

/** The positions (`ids.<i>`) of the ids that repeat an earlier one of the body. */
function repeatedPositions(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return ids.flatMap((id, index) => {
    if (seen.has(id)) return [`ids.${index}`];
    seen.add(id);
    return [];
  });
}

/** The positions (`ids.<i>`) of the items of the body that `matches` picks. */
function positionsWhere<T>(items: readonly T[], matches: (item: T) => boolean): string[] {
  return items.flatMap((item, index) => (matches(item) ? [`ids.${index}`] : []));
}

/** The row of history of a review: from pending and the declared minutes to the review. */
function historyRowOf(
  manager: EntityManager,
  entry: HourEntry,
  review: Review,
  stamp: ReviewStamp,
): HourEntryEvent {
  return manager.create(HourEntryEvent, {
    hourEntryId: entry.id,
    type: reviewEventOf(review.status).eventType,
    actorId: stamp.reviewerId,
    fromStatus: HourEntryStatus.PENDING,
    toStatus: review.status,
    fromMinutes: entry.declaredMinutes,
    toMinutes: review.validatedMinutes,
    note: review.note,
    createdAt: stamp.now,
    updatedAt: stamp.now,
  });
}

/** The audit event of a review. No free text: the note stays out (RNF-13). */
function auditEventOf(entry: HourEntry, review: Review, stamp: ReviewStamp): AuditableActionEvent {
  return buildHourEntryAuditEvent({
    action: reviewEventOf(review.status).auditAction,
    actorId: stamp.reviewerId,
    hourEntryId: entry.id,
    before: { status: HourEntryStatus.PENDING, validatedMinutes: null },
    after: {
      personId: entry.personId,
      status: review.status,
      declaredMinutes: entry.declaredMinutes,
      validatedMinutes: review.validatedMinutes,
      reviewedById: stamp.reviewerId,
    },
    occurredAt: stamp.now,
  });
}

/**
 * The answer of a reviewed entry: the entry as it was read, with the columns the review wrote. The
 * review wins over what was read, field by field.
 */
function reviewedResponse(
  entry: HourEntry,
  review: Review,
  stamp: ReviewStamp,
  cancelledLessonIds: ReadonlySet<string>,
): HourEntryResponseDto {
  return {
    ...toHourEntryResponse(entry, cancelledLessonIds),
    status: review.status,
    validatedMinutes: review.validatedMinutes,
    reviewNote: review.note,
    reviewedById: stamp.reviewerId,
    reviewedAt: stamp.now,
    updatedAt: stamp.now,
  };
}

/**
 * The review of hour entries by coordination (GUS-164): validate a batch, adjust and reject. Only a
 * pending entry is reviewed, nobody reviews her own hours (the person of the entry, whoever logged
 * it), and a review is final.
 *
 * hours.review is `all` or `none` in the matrix, so the AuthGuard decides who reviews and this
 * service does not ask the PermissionPolicy (docs/ARCHITECTURE.md section 14). If the matrix ever
 * gives it `department`, this service has to load the department of each entry and check it.
 *
 * Every review runs in a transaction that reads the entries FOR UPDATE, so a review and a removal
 * (or two reviews) of the same entry run one after the other, and the one that waits sees the
 * other's result. The columns of the entry, the row of history and the audit event share one
 * `now` from the Clock. The audit events go out after the commit, without the note (RNF-13).
 */
@Injectable()
export class HoursReviewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly lessons: LessonsService,
  ) {}

  /**
   * `PATCH /hour-entries/validate`: approves every entry of the body with its declared minutes, all
   * or none. Answers the entries in the order of the body.
   *
   * Errors, in the order they are answered, the last four with the positions of the body in
   * `details` (`ids.<i>`): 400 VALIDATION_FAILED (the DTO), 400 DUPLICATE_HOUR_ENTRY (an id repeated
   * in any letter case, before the transaction), 400 HOUR_ENTRY_NOT_FOUND (unknown or removed),
   * 409 SELF_REVIEW_NOT_ALLOWED and 409 ENTRY_NOT_PENDING. Any error undoes the whole batch.
   *
   * The entries are locked in the order of their ids, so two batches with entries in common never
   * wait for each other in a circle. One UPDATE writes the batch and one save writes its rows of
   * history. Emits one HOUR_ENTRY_APPROVED per entry after the commit.
   */
  async validateEntries(
    dto: ValidateHourEntriesDto,
    actor: AuthUser,
  ): Promise<HourEntryResponseDto[]> {
    const ids = dto.ids.map((id) => id.toLowerCase());
    const repeated = repeatedPositions(ids);
    if (repeated.length > 0) throw duplicateHourEntry(repeated);

    const stamp: ReviewStamp = { reviewerId: actor.id, now: this.clock.now() };

    const approved = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.find(HourEntry, {
        where: { id: In(ids) },
        order: { id: "ASC" },
        lock: { mode: "pessimistic_write" },
      });
      const lockedById = new Map(locked.map((entry) => [entry.id, entry]));
      const requested = ids.map((id) => lockedById.get(id));

      const unknown = positionsWhere(requested, (entry) => entry === undefined);
      if (unknown.length > 0) throw hourEntriesNotFound(unknown);
      const entries = requested.filter((entry): entry is HourEntry => entry !== undefined);

      const own = positionsWhere(entries, (entry) => entry.personId === actor.id);
      if (own.length > 0) throw selfReviewNotAllowed(own);
      const reviewed = positionsWhere(entries, (entry) => entry.status !== HourEntryStatus.PENDING);
      if (reviewed.length > 0) throw entryNotPendingForReview(reviewed);

      await manager
        .createQueryBuilder()
        .update(HourEntry)
        .set({
          status: HourEntryStatus.APPROVED,
          validatedMinutes: () => '"declared_minutes"',
          reviewNote: null,
          reviewedById: stamp.reviewerId,
          reviewedAt: stamp.now,
          updatedAt: stamp.now,
        })
        .where("id IN (:...ids)", { ids: locked.map((entry) => entry.id) })
        .execute();
      await manager.save(
        HourEntryEvent,
        locked.map((entry) => historyRowOf(manager, entry, approvalOf(entry), stamp)),
      );

      return entries;
    });

    for (const entry of approved) {
      this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, auditEventOf(entry, approvalOf(entry), stamp));
    }
    const cancelled = await findCancelledLessonIds(this.lessons, approved);
    return approved.map((entry) => reviewedResponse(entry, approvalOf(entry), stamp, cancelled));
  }

  /**
   * `PATCH /hour-entries/:id/adjust`: approves a pending entry with other minutes and a
   * justification, which the member sees in her statement. The declared minutes stay. More than
   * declared is allowed; the same as declared answers 400 ADJUSTED_MINUTES_UNCHANGED (that is a
   * validation). Emits HOUR_ENTRY_ADJUSTED after the commit.
   *
   * Errors, in the order they are answered: 404 HOUR_ENTRY_NOT_FOUND for a malformed id (the pipe
   * of the route), 400 VALIDATION_FAILED (the DTO), 404 HOUR_ENTRY_NOT_FOUND (unknown or removed),
   * 409 SELF_REVIEW_NOT_ALLOWED, 409 ENTRY_NOT_PENDING and 400 ADJUSTED_MINUTES_UNCHANGED.
   */
  adjustEntry(
    requestedId: string,
    dto: AdjustHourEntryDto,
    actor: AuthUser,
  ): Promise<HourEntryResponseDto> {
    return this.reviewOne(requestedId, actor, {
      status: HourEntryStatus.ADJUSTED,
      validatedMinutes: dto.validatedMinutes,
      note: dto.justification,
    });
  }

  /**
   * `PATCH /hour-entries/:id/reject`: rejects a pending entry with a reason, which the member sees
   * in her statement. The validated minutes are 0, so the entry stays out of the bank of hours.
   * Errors as the adjustment, without ADJUSTED_MINUTES_UNCHANGED. Emits HOUR_ENTRY_REJECTED after
   * the commit.
   */
  rejectEntry(
    requestedId: string,
    dto: RejectHourEntryDto,
    actor: AuthUser,
  ): Promise<HourEntryResponseDto> {
    return this.reviewOne(requestedId, actor, {
      status: HourEntryStatus.REJECTED,
      validatedMinutes: 0,
      note: dto.reason,
    });
  }

  /**
   * Reviews one entry, read FOR UPDATE. `requestedId` is only the key of the lookup (the pipe
   * accepts upper case): the write and the row of history use the id the database returns.
   */
  private async reviewOne(
    requestedId: string,
    actor: AuthUser,
    review: Review,
  ): Promise<HourEntryResponseDto> {
    const stamp: ReviewStamp = { reviewerId: actor.id, now: this.clock.now() };

    const entry = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(HourEntry, {
        where: { id: requestedId },
        lock: { mode: "pessimistic_write" },
      });
      if (locked === null) throw hourEntryNotFound();
      if (locked.personId === actor.id) throw selfReviewNotAllowed();
      if (locked.status !== HourEntryStatus.PENDING) throw entryNotPendingForReview();
      if (
        review.status === HourEntryStatus.ADJUSTED &&
        review.validatedMinutes === locked.declaredMinutes
      ) {
        throw adjustedMinutesUnchanged();
      }

      await manager.update(
        HourEntry,
        { id: locked.id },
        {
          status: review.status,
          validatedMinutes: review.validatedMinutes,
          reviewNote: review.note,
          reviewedById: stamp.reviewerId,
          reviewedAt: stamp.now,
          updatedAt: stamp.now,
        },
      );
      await manager.save(historyRowOf(manager, locked, review, stamp));

      return locked;
    });

    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, auditEventOf(entry, review, stamp));
    const cancelled = await findCancelledLessonIds(this.lessons, [entry]);
    return reviewedResponse(entry, review, stamp, cancelled);
  }
}
