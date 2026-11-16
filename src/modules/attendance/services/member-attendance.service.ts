import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, In } from "typeorm";
import {
  AssignmentRole,
  ConfirmedAssignment,
  ConfirmedStaffService,
} from "@modules/assignments/services/confirmed-staff.service";
import { LessonHoursService } from "@modules/hours/services/lesson-hours.service";
import {
  LessonsService,
  LessonStatus,
  LessonSummary,
} from "@modules/lessons/services/lessons.service";
import { PeopleService } from "@modules/people/services/people.service";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { ConfirmMemberAttendanceDto } from "../dto/confirm-member-attendance.dto";
import { MemberAttendanceResponseDto } from "../dto/member-attendance.response.dto";
import { MemberAttendance } from "../entities/member-attendance.entity";
import { MemberAttendanceStatus } from "../enums/member-attendance-status.enum";
import {
  assignmentNotConfirmed,
  attendanceCorrectionForbidden,
  duplicateAssignment,
  lessonCancelled,
  lessonInFuture,
  lessonNotFound,
} from "./attendance-errors";
import { toMemberAttendanceResponse } from "./member-attendance-response.mapper";

const ATTENDANCE_TARGET_TYPE = "member_attendance";

/** An entry of the body, with the id in lower case: the pipe of the DTO accepts upper case. */
interface RequestedEntry {
  assignmentId: string;
  status: MemberAttendanceStatus;
}

/** An entry of the body resolved to the confirmed assignment it names. */
interface ResolvedEntry {
  status: MemberAttendanceStatus;
  assignment: ConfirmedAssignment;
}

/**
 * What an entry does to the attendance of its person in the lesson: sign it for the first time,
 * correct a signed one to the other status, or nothing (the same status is already signed).
 */
type Change =
  | { kind: "first"; entry: ResolvedEntry }
  | { kind: "correction"; entry: ResolvedEntry; row: MemberAttendance }
  | { kind: "unchanged"; entry: ResolvedEntry };

type Correction = Extract<Change, { kind: "correction" }>;

/**
 * A change once its lesson hours are recorded: `hourEntryId` is the entry it generated, null when
 * it records none (an absence, or nothing to change). It travels with the change, so the row of the
 * attendance always gets the entry of its own person.
 */
type RecordedChange = Change & { hourEntryId: string | null };

type RecordedCorrection = Extract<RecordedChange, { kind: "correction" }>;

/** A batch that passed every check: the lesson, what each entry does, and the corrections. */
interface CheckedBatch {
  lesson: LessonSummary;
  changes: Change[];
  corrections: Correction[];
}

/** The key of the advisory lock that serializes every writer of the attendance of one lesson. */
function attendanceLockKey(lessonId: string): string {
  return `attendance.members:${lessonId}`;
}

/** The position of an entry of the body, as the field of `details`. */
function fieldOf(index: number): string {
  return `entries.${index}.assignmentId`;
}

/** The positions of the entries whose assignment repeats an earlier one of the body. */
function repeatedPositions(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return ids.flatMap((id, index) => {
    if (seen.has(id)) return [fieldOf(index)];
    seen.add(id);
    return [];
  });
}

/**
 * The entries of the body resolved to the confirmed assignments of the lesson, in ONE pass: each
 * one is either resolved or its position goes to `notConfirmed` (the 400 ASSIGNMENT_NOT_CONFIRMED).
 */
function resolveEntries(
  requested: readonly RequestedEntry[],
  staffById: ReadonlyMap<string, ConfirmedAssignment>,
): { entries: ResolvedEntry[]; notConfirmed: string[] } {
  const entries: ResolvedEntry[] = [];
  const notConfirmed: string[] = [];
  requested.forEach((entry, index) => {
    const assignment = staffById.get(entry.assignmentId);
    if (assignment === undefined) {
      notConfirmed.push(fieldOf(index));
    } else {
      entries.push({ status: entry.status, assignment });
    }
  });
  return { entries, notConfirmed };
}

function changeOf(entry: ResolvedEntry, row: MemberAttendance | undefined): Change {
  if (row === undefined) return { kind: "first", entry };
  return row.status === entry.status
    ? { kind: "unchanged", entry }
    : { kind: "correction", entry, row };
}

function isCorrection(change: Change): change is Correction {
  return change.kind === "correction";
}

/** Whether the change leaves the person present, so it records new lesson hours. */
function recordsHours(change: Change): boolean {
  switch (change.kind) {
    case "first":
    case "correction":
      return change.entry.status === MemberAttendanceStatus.PRESENT;
    case "unchanged":
      return false;
    default: {
      const unknownChange: never = change;
      throw new Error(`Unknown attendance change: ${JSON.stringify(unknownChange)}.`);
    }
  }
}

/** The entries the corrections to absent reverse: the ones their presence generated. */
function reversedEntryIdsOf(corrections: readonly Correction[]): string[] {
  return corrections.flatMap((correction) =>
    correction.entry.status === MemberAttendanceStatus.ABSENT && correction.row.hourEntryId !== null
      ? [correction.row.hourEntryId]
      : [],
  );
}

function auditEventOf(
  action: AuditableAction,
  actorId: string,
  targetId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  occurredAt: Date,
): AuditableActionEvent {
  const event = new AuditableActionEvent();
  event.actorId = actorId;
  event.action = action;
  event.targetType = ATTENDANCE_TARGET_TYPE;
  event.targetId = targetId;
  event.before = before;
  event.after = after;
  event.occurredAt = occurredAt;
  return event;
}

/** MEMBER_ATTENDANCE_CONFIRMED of a first signature, as it was inserted. */
function confirmedAuditOf(
  row: MemberAttendance,
  lessonId: string,
  actorId: string,
  now: Date,
): AuditableActionEvent {
  return auditEventOf(
    AuditableAction.MEMBER_ATTENDANCE_CONFIRMED,
    actorId,
    row.id,
    null,
    {
      lessonId,
      personId: row.personId,
      assignmentId: row.assignmentId,
      status: row.status,
      hourEntryId: row.hourEntryId,
      confirmedAt: now,
    },
    now,
  );
}

/** MEMBER_ATTENDANCE_CORRECTED of a correction: the signature as it was, and as it is now. */
function correctedAuditOf(
  change: RecordedCorrection,
  actorId: string,
  now: Date,
): AuditableActionEvent {
  const { row, entry } = change;
  return auditEventOf(
    AuditableAction.MEMBER_ATTENDANCE_CORRECTED,
    actorId,
    row.id,
    {
      status: row.status,
      confirmedById: row.confirmedById,
      confirmedAt: row.confirmedAt,
      hourEntryId: row.hourEntryId,
    },
    {
      status: entry.status,
      confirmedById: actorId,
      confirmedAt: now,
      hourEntryId: change.hourEntryId,
      assignmentId: entry.assignment.id,
    },
    now,
  );
}

/**
 * The attendance of the members of a lesson (F6.2, GUS-168): who of its confirmed staff was there,
 * who signed it and the hour entry a presence generated. Signing a presence writes the lesson hours
 * of the member (F7.1) and correcting it to absent reverses them (RF-071), in the SAME transaction,
 * through the LessonHoursService the hours export (docs/ARCHITECTURE.md section 18, P1).
 *
 * The lesson is read through LessonsService, its confirmed staff through ConfirmedStaffService and
 * the names through PeopleService: this module touches no table of another one. Every write runs in
 * one transaction, with one `now` from the Clock for the rows, the hours and the audit events, and
 * the audit events go out after the commit, only when something changed.
 */
@Injectable()
export class MemberAttendanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly lessons: LessonsService,
    private readonly confirmedStaff: ConfirmedStaffService,
    private readonly lessonHours: LessonHoursService,
    private readonly people: PeopleService,
    private readonly policy: PermissionPolicy,
  ) {}

  /**
   * `GET /lessons/:id/attendance/members`: the confirmed assignments of the lesson, the teacher
   * first, each with the attendance of its member, who signed it and the hour entry. 404
   * LESSON_NOT_FOUND for an id that is not a lesson; a cancelled lesson is read the same way. A
   * plain read: no transaction, no lock and no event.
   */
  async listByLesson(requestedLessonId: string): Promise<MemberAttendanceResponseDto[]> {
    const lesson = await this.lessons.getLessonSummary(requestedLessonId);
    if (lesson === null) throw lessonNotFound();

    return this.readLessonAttendance(lesson.id);
  }

  /**
   * `PUT /lessons/:id/attendance/members`: signs the attendance of confirmed assignments of the
   * lesson, all or none, and answers the list of the lesson read after the commit.
   *
   * Each entry is the attendance of the PERSON of the assignment in the lesson: the first one signs
   * it; the same status again is a no-op (no write, no hours, no event); the other status is a
   * correction (present to absent reverses the hour entry, absent to present records new lesson
   * hours). Who may: every entry passes `PermissionPolicy.assertCan(attendance.confirmMember)` with
   * the confirmed teacher of the lesson as `lessonTeacherIds`, so nobody signs her own attendance
   * and a member only signs in the lesson she teaches; a correction needs attendance.correct too.
   *
   * Errors, in the order they are answered: 400 DUPLICATE_ASSIGNMENT (an id repeated in any letter
   * case, before the transaction), 404 LESSON_NOT_FOUND, 409 LESSON_CANCELLED, 409 LESSON_IN_FUTURE
   * (after today in APP_TIME_ZONE; today is fine), 400 ASSIGNMENT_NOT_CONFIRMED (not confirmed in
   * this lesson), 403 SELF_ATTENDANCE_NOT_ALLOWED or FORBIDDEN_SCOPE (the first entry that fails,
   * in the order of the body) and 403 FORBIDDEN (a correction without attendance.correct). The 400
   * carry the positions in `details`; the 403 are about who asks and carry none. Every check comes
   * before the first write.
   *
   * Locks, in this order (P11): the lesson FOR SHARE (it conflicts with the FOR UPDATE of the
   * cancellation of the lesson), the advisory lock of the attendance of the lesson (two PUT of the
   * same lesson run one after the other, and the one that waits reads again and becomes a no-op),
   * the confirmed assignments FOR SHARE (they conflict with the FOR UPDATE of their confirmation and
   * cancellation), then the entries to reverse FOR UPDATE in the order of their ids, in ONE call.
   * The writes are sequential on purpose: one manager is one connection, and the audit events keep
   * the order of the body.
   *
   * Emits, after the commit: the events of the hours in the order they were written, then
   * MEMBER_ATTENDANCE_CONFIRMED and MEMBER_ATTENDANCE_CORRECTED in the order of the body.
   */
  async confirm(
    requestedLessonId: string,
    dto: ConfirmMemberAttendanceDto,
    actor: AuthUser,
  ): Promise<MemberAttendanceResponseDto[]> {
    const requested: RequestedEntry[] = dto.entries.map((entry) => ({
      assignmentId: entry.assignmentId.toLowerCase(),
      status: entry.status,
    }));
    const repeated = repeatedPositions(requested.map((entry) => entry.assignmentId));
    if (repeated.length > 0) throw duplicateAssignment(repeated);

    const now = this.clock.now();

    const outcome = await this.dataSource.transaction(async (manager) => {
      const { lesson, changes, corrections } = await this.checkBatch(
        manager,
        requestedLessonId,
        requested,
        actor,
        now,
      );

      // No write before this line: the batch is all or none. The order of the writes is the order
      // of the locks (P11): the reversals first, then the new hours, then the attendance.
      const reversals = await this.lessonHours.reverseEntries(
        manager,
        reversedEntryIdsOf(corrections),
        actor.id,
        now,
      );
      const recorded = await this.recordHours(manager, lesson, changes, actor.id, now);
      const attendanceAudits = await this.writeAttendance(
        manager,
        lesson,
        recorded.changes,
        actor.id,
        now,
      );

      return {
        lessonId: lesson.id,
        auditEvents: [...reversals, ...recorded.auditEvents, ...attendanceAudits],
      };
    });

    for (const auditEvent of outcome.auditEvents) {
      this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, auditEvent);
    }
    return this.readLessonAttendance(outcome.lessonId);
  }

  /**
   * Every check of a batch, inside its transaction and before any write, in the order the errors
   * are answered: the lesson (locked FOR SHARE), the advisory lock of its attendance, its confirmed
   * assignments (FOR SHARE), attendance.confirmMember on each entry, the signed attendance of the
   * people of the batch, and attendance.correct on each correction.
   */
  private async checkBatch(
    manager: EntityManager,
    requestedLessonId: string,
    requested: readonly RequestedEntry[],
    actor: AuthUser,
    now: Date,
  ): Promise<CheckedBatch> {
    const lesson = await this.lessons.getLessonSummary(requestedLessonId, manager, {
      forShare: true,
    });
    if (lesson === null) throw lessonNotFound();
    if (lesson.status === LessonStatus.CANCELLED) throw lessonCancelled();
    if (lesson.date > todayInAppTimeZone(now)) throw lessonInFuture();

    await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      attendanceLockKey(lesson.id),
    ]);
    const staff = await this.confirmedStaff.findConfirmedAssignments(lesson.id, manager, {
      forShare: true,
    });
    const { entries, notConfirmed } = resolveEntries(
      requested,
      new Map(staff.map((assignment) => [assignment.id, assignment])),
    );
    if (notConfirmed.length > 0) throw assignmentNotConfirmed(notConfirmed);

    const lessonTeacherIds = staff
      .filter((assignment) => assignment.role === AssignmentRole.TEACHER)
      .map((assignment) => assignment.personId);
    for (const entry of entries) {
      this.policy.assertCan(actor, Permission.ATTENDANCE_CONFIRM_MEMBER, {
        personId: entry.assignment.personId,
        lessonTeacherIds,
      });
    }

    const signed = await manager.find(MemberAttendance, {
      where: {
        lessonId: lesson.id,
        personId: In(entries.map((entry) => entry.assignment.personId)),
      },
    });
    const signedByPerson = new Map(signed.map((row) => [row.personId, row]));
    const changes = entries.map((entry) =>
      changeOf(entry, signedByPerson.get(entry.assignment.personId)),
    );

    const corrections = changes.filter(isCorrection);
    if (corrections.length > 0) {
      if (this.policy.scopeOf(actor, Permission.ATTENDANCE_CORRECT) === "none") {
        throw attendanceCorrectionForbidden();
      }
      for (const correction of corrections) {
        this.policy.assertCan(actor, Permission.ATTENDANCE_CORRECT, {
          personId: correction.entry.assignment.personId,
          lessonTeacherIds,
        });
      }
    }

    return { lesson, changes, corrections };
  }

  /**
   * The new lesson hours of the batch, in the order of the body (sequential: one connection), for
   * every change that leaves its person present. Each change comes back with the entry it generated.
   */
  private async recordHours(
    manager: EntityManager,
    lesson: LessonSummary,
    changes: readonly Change[],
    actorId: string,
    now: Date,
  ): Promise<{ changes: RecordedChange[]; auditEvents: AuditableActionEvent[] }> {
    const recordedChanges: RecordedChange[] = [];
    const auditEvents: AuditableActionEvent[] = [];
    for (const change of changes) {
      if (!recordsHours(change)) {
        recordedChanges.push({ ...change, hourEntryId: null });
        continue;
      }
      const recorded = await this.lessonHours.recordPresence(
        manager,
        { personId: change.entry.assignment.personId, confirmedById: actorId, lesson },
        now,
      );
      recordedChanges.push({ ...change, hourEntryId: recorded.hourEntryId });
      auditEvents.push(...recorded.auditEvents);
    }
    return { changes: recordedChanges, auditEvents };
  }

  /**
   * The rows of the attendance: one insert of the first signatures, then one update per
   * correction. Returns their audit events in the order of the body.
   */
  private async writeAttendance(
    manager: EntityManager,
    lesson: LessonSummary,
    changes: readonly RecordedChange[],
    actorId: string,
    now: Date,
  ): Promise<AuditableActionEvent[]> {
    const insertedByPerson = await this.insertFirstSignatures(
      manager,
      lesson,
      changes,
      actorId,
      now,
    );

    const auditEvents: AuditableActionEvent[] = [];
    for (const change of changes) {
      switch (change.kind) {
        case "first": {
          const row = insertedByPerson.get(change.entry.assignment.personId);
          if (row === undefined) {
            throw new Error(`The attendance of ${change.entry.assignment.id} was not inserted.`);
          }
          auditEvents.push(confirmedAuditOf(row, lesson.id, actorId, now));
          break;
        }
        case "correction":
          await this.applyCorrection(manager, change, actorId, now);
          auditEvents.push(correctedAuditOf(change, actorId, now));
          break;
        case "unchanged":
          break;
        default: {
          const unknownChange: never = change;
          throw new Error(`Unknown attendance change: ${JSON.stringify(unknownChange)}.`);
        }
      }
    }
    return auditEvents;
  }

  /** The first signatures of the batch in ONE insert, by person (one per person in a lesson). */
  private async insertFirstSignatures(
    manager: EntityManager,
    lesson: LessonSummary,
    changes: readonly RecordedChange[],
    actorId: string,
    now: Date,
  ): Promise<Map<string, MemberAttendance>> {
    const rows = changes.flatMap((change) =>
      change.kind === "first"
        ? [
            manager.create(MemberAttendance, {
              assignmentId: change.entry.assignment.id,
              lessonId: lesson.id,
              personId: change.entry.assignment.personId,
              status: change.entry.status,
              confirmedById: actorId,
              confirmedAt: now,
              hourEntryId: change.hourEntryId,
              createdAt: now,
              updatedAt: now,
            }),
          ]
        : [],
    );
    const inserted = rows.length === 0 ? [] : await manager.save(MemberAttendance, rows);
    return new Map(inserted.map((row) => [row.personId, row]));
  }

  /**
   * A correction: the new status and its entry (null for an absence), who corrected it, when, and
   * through which confirmed assignment.
   */
  private async applyCorrection(
    manager: EntityManager,
    change: RecordedCorrection,
    actorId: string,
    now: Date,
  ): Promise<void> {
    await manager.update(
      MemberAttendance,
      { id: change.row.id },
      {
        status: change.entry.status,
        hourEntryId: change.hourEntryId,
        confirmedById: actorId,
        confirmedAt: now,
        assignmentId: change.entry.assignment.id,
        updatedAt: now,
      },
    );
  }

  /**
   * The list of a lesson in four queries however many people it has: the confirmed assignments,
   * their attendance (one `IN`) and every name in ONE call to `PeopleService.findRefsByIds` (the
   * members and who signed). A lesson without confirmed staff answers [] without reading the
   * attendance. The attendance is matched by the person, not by the assignment: a member assigned
   * again keeps the attendance she had.
   */
  private async readLessonAttendance(lessonId: string): Promise<MemberAttendanceResponseDto[]> {
    const staff = await this.confirmedStaff.findConfirmedAssignments(lessonId);
    if (staff.length === 0) return [];

    const personIds = staff.map((assignment) => assignment.personId);
    const rows = await this.dataSource
      .getRepository(MemberAttendance)
      .find({ where: { lessonId, personId: In(personIds) } });
    const rowsByPerson = new Map(rows.map((row) => [row.personId, row]));

    const people = await this.people.findRefsByIds([
      ...personIds,
      ...rows.map((row) => row.confirmedById),
    ]);
    const peopleById = new Map(people.map((person) => [person.id, person]));

    return staff.map((assignment) =>
      toMemberAttendanceResponse(
        assignment,
        rowsByPerson.get(assignment.personId) ?? null,
        peopleById,
      ),
    );
  }
}
