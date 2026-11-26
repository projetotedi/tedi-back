import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, SelectQueryBuilder } from "typeorm";
import { ClassesService } from "@modules/classes/services/classes.service";
import { LessonsService, LessonStatus } from "@modules/lessons/services/lessons.service";
import { MemberRegistrationStatus, MembersService } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
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
  attendanceEntryNotRemovable,
  entryNotPending,
  hourEntryDateInFuture,
  hourEntryNotFound,
  invalidPeriod,
  lessonNotInClass,
  linkedClassArchived,
  linkedClassNotFound,
  linkedLessonCancelled,
  linkedLessonNotFound,
  memberNotFound,
  selfOnBehalfNotAllowed,
} from "./hour-entry-errors";
import { findCancelledLessonIds, NO_CANCELLED_LESSONS } from "./hour-entry-lessons";
import { toHourEntryResponse } from "./hour-entry-response.mapper";
import { HourCategoryNotesService } from "./hour-category-notes.service";
import { buildHoursSummary, HoursSummaryRow } from "./hours-summary";

const HOUR_ENTRY_TARGET_TYPE = "hour_entry";

/** 400 INVALID_PERIOD when both ends come and the start is after the end. YYYY-MM-DD compares as text. */
export function assertValidPeriod(period: HoursPeriodQueryDto): void {
  if (period.from !== undefined && period.to !== undefined && period.from > period.to) {
    throw invalidPeriod();
  }
}

/** Restricts the query to the days of the period, both ends included, for the ends that come. */
export function applyPeriod(
  builder: SelectQueryBuilder<HourEntry>,
  period: HoursPeriodQueryDto,
): void {
  if (period.from !== undefined) builder.andWhere("entry.date >= :from", { from: period.from });
  if (period.to !== undefined) builder.andWhere("entry.date <= :to", { to: period.to });
}

/**
 * What a new hour entry is, already decided by the caller: whose hours, who logged them and how.
 * Internal to the module, like `createEntry`: the LessonHoursService builds one for the attendance
 * (GUS-168).
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
  /** The class of the lesson of the attendance, or the link of a route (GUS-172); omitted is null. */
  classId?: string | null;
  /** The lesson of the attendance, or the link of a route (GUS-172); omitted is null. */
  lessonId?: string | null;
  /**
   * Who approves the entry as it is born, with its declared minutes: the presence of a lesson
   * (GUS-168), while LESSON_HOURS_INITIAL_STATUS is approved. Null in the routes, which leave it
   * pending for the review (GUS-164).
   */
  approvedById: string | null;
}

/** The entry that was written, and the audit events the caller emits AFTER its commit. */
export interface CreatedHourEntry {
  entry: HourEntry;
  /** HOUR_ENTRY_CREATED and, when the entry was born approved, HOUR_ENTRY_APPROVED, in this order. */
  auditEvents: AuditableActionEvent[];
}

/** The review columns of a new entry: none while pending, the approval when it comes. */
type BornReview =
  | {
      status: HourEntryStatus.PENDING;
      validatedMinutes: null;
      reviewedById: null;
      reviewedAt: null;
    }
  | {
      status: HourEntryStatus.APPROVED;
      validatedMinutes: number;
      reviewedById: string;
      reviewedAt: Date;
    };

type BornApproval = Extract<BornReview, { status: HourEntryStatus.APPROVED }>;

/** How a draft is born: pending, or approved by `approvedById` with the declared minutes, at `now`. */
function bornReviewOf(draft: HourEntryDraft, now: Date): BornReview {
  if (draft.approvedById === null) {
    return {
      status: HourEntryStatus.PENDING,
      validatedMinutes: null,
      reviewedById: null,
      reviewedAt: null,
    };
  }
  return {
    status: HourEntryStatus.APPROVED,
    validatedMinutes: draft.declaredMinutes,
    reviewedById: draft.approvedById,
    reviewedAt: now,
  };
}

/** Who an entry logged on behalf of someone is for, with the facts the policy needs. */
interface MemberTarget {
  personId: string;
  departmentIds: string[];
}

/** Whose hours an entry logged through a route are, who logged them and how. */
interface DraftAuthorship {
  personId: string;
  createdById: string;
  origin: HourEntryOrigin;
}

/** The class and the lesson an entry logged through a route is linked to, already checked. */
interface HourEntryLink {
  classId: string | null;
  lessonId: string | null;
}

const NO_LINK: HourEntryLink = { classId: null, lessonId: null };

/** What the audit event of an hour entry carries. `before` is null for a creation. */
interface HourEntryAudit {
  action: AuditableAction;
  actorId: string;
  hourEntryId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  occurredAt: Date;
}

/**
 * Hour entries of the people (E7, GUS-162): log for oneself or on behalf of a member, read one's
 * own statement and summary, and remove one's own pending entry.
 *
 * Every write runs in a transaction and the audit event goes out after the commit. Every instant
 * of a write (the columns of the entry, the row of its history and the audit event) is the same
 * `now`, read once from the Clock: the API and the database run on different hosts, and two clocks
 * could put the history of an entry out of order.
 *
 * The people are read through the services PeopleModule exports, and the class and the lesson an
 * entry is linked to (GUS-172) through the ones ClassesModule and LessonsModule export; this module
 * touches no table of another one.
 */
@Injectable()
export class HoursService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly people: PeopleService,
    private readonly members: MembersService,
    private readonly permissions: PermissionPolicy,
    private readonly notes: HourCategoryNotesService,
    private readonly classes: ClassesService,
    private readonly lessons: LessonsService,
  ) {}

  /**
   * The one place that writes a new hour entry, with its `created` event in the history. It is
   * born `pending`, with no validated minutes and no review, or `approved` by `approvedById` with
   * its declared minutes. The point of reuse of the attendance (GUS-168), which passes
   * `origin: attendance` with the class and the lesson, and the approval while lesson hours are
   * born approved.
   *
   * An approved entry gets two rows of history at the same instant, saved in this order (the ids
   * are UUID v7, so `created_at, id` reads them in it): `created` (to pending, by the author) and
   * `approved` (from pending, same minutes, by `approvedById`). Every reader of the history keeps
   * its rules: `created` leads to pending, and a reviewed status is reached by a row of review.
   *
   * It does not open a transaction, it emits nothing and it reads no clock: the caller passes the
   * `manager` of its transaction and `now`, one instant per operation (a batch of the attendance
   * has one), and emits `auditEvents` after the commit. 400 HOUR_ENTRY_DATE_IN_FUTURE for a day
   * after today in APP_TIME_ZONE, before anything is written: the rule lives here so every way in
   * (the two routes and the attendance) gets it.
   *
   * The audit events carry no free text (`activity`, `notes`): RNF-13.
   */
  async createEntry(
    manager: EntityManager,
    draft: HourEntryDraft,
    now: Date,
  ): Promise<CreatedHourEntry> {
    if (draft.date > todayInAppTimeZone(now)) throw hourEntryDateInFuture();
    const review = bornReviewOf(draft, now);

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
        status: review.status,
        validatedMinutes: review.validatedMinutes,
        reviewNote: null,
        reviewedById: review.reviewedById,
        reviewedAt: review.reviewedAt,
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

    const auditEvents = [
      this.buildAuditEvent({
        action: AuditableAction.HOUR_ENTRY_CREATED,
        actorId: draft.createdById,
        hourEntryId: entry.id,
        before: null,
        after: {
          personId: entry.personId,
          category: entry.category,
          date: entry.date,
          declaredMinutes: entry.declaredMinutes,
          // The step of the creation, as the history records it: the approval has its own event.
          status: HourEntryStatus.PENDING,
          origin: entry.origin,
          classId: entry.classId,
          lessonId: entry.lessonId,
        },
        occurredAt: now,
      }),
    ];

    if (review.status === HourEntryStatus.APPROVED) {
      const approval = await this.recordBornApproval(manager, entry, review, now);
      auditEvents.push(approval);
    }

    return { entry, auditEvents };
  }

  /**
   * The approval of an entry born approved: the `approved` row of its history (from pending, the
   * same minutes, by who approved), saved after the `created` one at the same instant, and the
   * HOUR_ENTRY_APPROVED it returns, with the same shape as the approval of the review (GUS-164).
   */
  private async recordBornApproval(
    manager: EntityManager,
    entry: HourEntry,
    review: BornApproval,
    now: Date,
  ): Promise<AuditableActionEvent> {
    await manager.save(
      manager.create(HourEntryEvent, {
        hourEntryId: entry.id,
        type: HourEntryEventType.APPROVED,
        actorId: review.reviewedById,
        fromStatus: HourEntryStatus.PENDING,
        toStatus: HourEntryStatus.APPROVED,
        fromMinutes: entry.declaredMinutes,
        toMinutes: review.validatedMinutes,
        note: null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    return this.buildAuditEvent({
      action: AuditableAction.HOUR_ENTRY_APPROVED,
      actorId: review.reviewedById,
      hourEntryId: entry.id,
      before: { status: HourEntryStatus.PENDING, validatedMinutes: null },
      after: {
        personId: entry.personId,
        status: HourEntryStatus.APPROVED,
        declaredMinutes: entry.declaredMinutes,
        validatedMinutes: review.validatedMinutes,
        reviewedById: review.reviewedById,
      },
      occurredAt: now,
    });
  }

  /**
   * `POST /me/hour-entries`: the logged-in person logs her own hours, `manual` and authored by
   * herself, optionally linked to a class or a lesson (`linkOf`). Errors: 400 VALIDATION_FAILED (the
   * DTO), the errors of the link and 400 HOUR_ENTRY_DATE_IN_FUTURE. Emits HOUR_ENTRY_CREATED after
   * the commit.
   */
  async logMyHours(dto: CreateHourEntryDto, actor: AuthUser): Promise<HourEntryResponseDto> {
    const draft = this.draftFrom(dto, {
      personId: actor.id,
      createdById: actor.id,
      origin: HourEntryOrigin.MANUAL,
    });
    const now = this.clock.now();
    const { entry, auditEvents } = await this.dataSource.transaction(async (manager) => {
      const link = await this.linkOf(manager, dto);
      return this.createEntry(manager, { ...draft, ...link }, now);
    });

    for (const auditEvent of auditEvents) {
      this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, auditEvent);
    }
    return toHourEntryResponse(entry, NO_CANCELLED_LESSONS);
  }

  /**
   * `POST /members/:id/hour-entries`: someone with hours.logForOthers logs hours for a member,
   * `on_behalf` and authored by herself. A director only for a member of her own department;
   * coordination and the superadmin for any member.
   *
   * Errors, in the order they are answered: 404 MEMBER_NOT_FOUND for a malformed id (the pipe of
   * the route, before the body), 400 VALIDATION_FAILED (the DTO), 400 SELF_ON_BEHALF_NOT_ALLOWED
   * (the id is the actor's, in any letter case, before the target is read), 404 MEMBER_NOT_FOUND,
   * 403 FORBIDDEN_SCOPE, the errors of the link (`linkOf`) and 400 HOUR_ENTRY_DATE_IN_FUTURE. The 404 comes before the 403, as in the
   * member record. Emits HOUR_ENTRY_CREATED after the commit.
   *
   * The scope is read before the transaction: a change of department at the same instant is not
   * serialized with the entry (accepted, as in the member record).
   */
  async logHoursForMember(
    requestedPersonId: string,
    dto: CreateHourEntryDto,
    actor: AuthUser,
  ): Promise<HourEntryResponseDto> {
    if (requestedPersonId.toLowerCase() === actor.id.toLowerCase()) {
      throw selfOnBehalfNotAllowed();
    }

    const target = await this.findMemberTarget(requestedPersonId);
    this.permissions.assertCan(actor, Permission.HOURS_LOG_FOR_OTHERS, target);

    const draft = this.draftFrom(dto, {
      personId: target.personId,
      createdById: actor.id,
      origin: HourEntryOrigin.ON_BEHALF,
    });
    const now = this.clock.now();
    const { entry, auditEvents } = await this.dataSource.transaction(async (manager) => {
      const link = await this.linkOf(manager, dto);
      return this.createEntry(manager, { ...draft, ...link }, now);
    });

    for (const auditEvent of auditEvents) {
      this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, auditEvent);
    }
    return toHourEntryResponse(entry, NO_CANCELLED_LESSONS);
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

    const cancelled = await findCancelledLessonIds(this.lessons, entries);
    return {
      data: entries.map((entry) => toHourEntryResponse(entry, cancelled)),
      total,
      page,
      limit,
    };
  }

  /**
   * `GET /me/hours/summary`: the totals of the logged-in person in the period, by status and by
   * category, with the observation of coordination on each category (GUS-173), and the bank of
   * hours. One query, grouped by status and category (at most 28 rows), and one for the observations;
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

    return buildHoursSummary(
      rows,
      { from: query.from ?? null, to: query.to ?? null },
      await this.notes.notesOf(actor.id),
    );
  }

  /**
   * `DELETE /me/hour-entries/:id`: the person removes one of her own pending entries. It is a soft
   * delete: `deleted_at` is set and the row stays, so its history stays whole, and a `removed` event
   * (from `pending` and the declared minutes to nothing) is written in the same transaction.
   *
   * The owner is checked by the query (`id` and `person_id` of the session), never by the policy:
   * the superadmin has `all` on account.manageOwn and would remove anyone's entry. So an entry of
   * another person answers 404 HOUR_ENTRY_NOT_FOUND, like an unknown one and one already removed;
   * lesson hours of an attendance answer 409 ATTENDANCE_ENTRY_NOT_REMOVABLE, whatever their status
   * (GUS-168: they change only with the attendance, by a correction or the cancellation of the
   * lesson, and removing them would leave a presence pointing to an entry that is gone); a reviewed
   * entry answers 409 ENTRY_NOT_PENDING.
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
      if (entry.origin === HourEntryOrigin.ATTENDANCE) throw attendanceEntryNotRemovable();
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
      this.buildAuditEvent({
        action: AuditableAction.HOUR_ENTRY_REMOVED,
        actorId: actor.id,
        hourEntryId: removed.id,
        before: { status: HourEntryStatus.PENDING, declaredMinutes: removed.declaredMinutes },
        after: { deletedAt: now },
        occurredAt: now,
      }),
    );
  }

  /**
   * The class and the lesson of the body (GUS-172), checked inside the transaction of the entry.
   * Both are optional, and none is no link.
   *
   * - A lesson: it must exist (400 LESSON_NOT_FOUND) and the class of the entry is the lesson's.
   *   With a class too, it must be that one (400 LESSON_NOT_IN_CLASS). A cancelled lesson did not
   *   happen (409 LESSON_CANCELLED), and the class of the lesson must not be archived (409
   *   CLASS_ARCHIVED, on `lessonId`).
   * - Only a class: it must exist (400 CLASS_NOT_FOUND) and not be archived (409 CLASS_ARCHIVED).
   *
   * The person does not need to be assigned to the lesson: the entry goes through the review of
   * the coordination. The lesson is read FOR SHARE, and then its class, the order `LessonsService`
   * locks them in: cancelling the lesson or archiving the class at the same time waits for the entry,
   * or the entry sees them cancelled or archived. The ids returned are the database's.
   */
  private async linkOf(manager: EntityManager, dto: CreateHourEntryDto): Promise<HourEntryLink> {
    const classId = dto.classId ?? null;
    const lessonId = dto.lessonId ?? null;

    if (lessonId !== null) {
      const lesson = await this.lessons.getLessonSummary(lessonId, manager, { forShare: true });
      if (lesson === null) throw linkedLessonNotFound();
      if (classId !== null && classId !== lesson.classId) throw lessonNotInClass();
      if (lesson.status === LessonStatus.CANCELLED) throw linkedLessonCancelled();
      await this.assertClassLinkable(manager, lesson.classId, "lessonId");
      return { classId: lesson.classId, lessonId: lesson.id };
    }

    if (classId !== null) {
      const id = await this.assertClassLinkable(manager, classId, "classId");
      return { classId: id, lessonId: null };
    }

    return NO_LINK;
  }

  /**
   * The class an entry is linked to, read FOR SHARE: it must exist (400 CLASS_NOT_FOUND) and not be
   * archived (409 CLASS_ARCHIVED on `field`). Returns its id as the database has it.
   */
  private async assertClassLinkable(
    manager: EntityManager,
    classId: string,
    field: "classId" | "lessonId",
  ): Promise<string> {
    const schoolClass = await this.classes.getClassSummary(classId, manager, { forShare: true });
    if (schoolClass === null) throw linkedClassNotFound();
    if (schoolClass.archivedAt !== null) throw linkedClassArchived(field);
    return schoolClass.id;
  }

  /**
   * The member an entry on behalf is for: a person that exists (not deleted) with an APPROVED
   * member registration, else 404 MEMBER_NOT_FOUND (a pending or rejected registration, a student,
   * coordination and the superadmin without a profile). A member whose access was disabled is still
   * one: the hours are of work already done.
   *
   * The departments are the ones of the approved profile, the same rule the AuthGuard uses for the
   * actor. The id returned is the one of the database (lower case), not the one of the URL.
   */
  private async findMemberTarget(requestedPersonId: string): Promise<MemberTarget> {
    const person = (await this.people.findRefsByIds([requestedPersonId])).at(0);
    if (person === undefined) throw memberNotFound();

    const facts = await this.members.findAccessFacts(person.id);
    if (facts.registrationStatus !== MemberRegistrationStatus.APPROVED) throw memberNotFound();

    return { personId: person.id, departmentIds: facts.departmentIds };
  }

  /**
   * The draft of an entry logged through one of the two routes: the fields of the body, with whose
   * hours they are, who logged them and how. Notes omitted in the body are null. It is born pending:
   * a route never approves (the review is GUS-164).
   */
  private draftFrom(dto: CreateHourEntryDto, authorship: DraftAuthorship): HourEntryDraft {
    return {
      personId: authorship.personId,
      createdById: authorship.createdById,
      origin: authorship.origin,
      activity: dto.activity,
      category: dto.category,
      date: dto.date,
      declaredMinutes: dto.declaredMinutes,
      notes: dto.notes ?? null,
      approvedById: null,
    };
  }

  private buildAuditEvent({
    action,
    actorId,
    hourEntryId,
    before,
    after,
    occurredAt,
  }: HourEntryAudit): AuditableActionEvent {
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
