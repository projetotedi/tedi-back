import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager } from "typeorm";
import {
  LessonsService,
  LessonStatus,
  LessonSummary,
} from "@modules/lessons/services/lessons.service";
import { PeopleService } from "@modules/people/services/people.service";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { CorrectStudentAttendanceDto } from "../dto/correct-student-attendance.dto";
import { JustifyAbsenceDto } from "../dto/justify-absence.dto";
import { StudentAttendanceResponseDto } from "../dto/student-attendance.response.dto";
import { AttendanceCorrection } from "../entities/attendance-correction.entity";
import { StudentAttendance } from "../entities/student-attendance.entity";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";
import {
  lessonCancelled,
  studentAttendanceNotAbsent,
  studentAttendanceNotFound,
  studentAttendanceStatusUnchanged,
} from "./attendance-errors";
import { correctedAuditOf, justifiedAuditOf } from "./student-attendance-audit";
import { toStudentAttendanceResponse } from "./student-attendance-response.mapper";
import { StudentRollCallAccess } from "./student-roll-call-access";

/** What a write of one attendance did: the id to read back, and its audit event when it changed. */
interface RecordOutcome {
  id: string;
  auditEvent: AuditableActionEvent | null;
}

/**
 * The writes of one signed attendance of a student (GUS-166, docs/ARCHITECTURE.md section 18.1):
 * justify an absence (S8) and correct the status with a reason and a history (S10, S11).
 *
 * Both lock in the order of the roll call (S3): a plain read of the attendance (to find its lesson),
 * the lesson FOR SHARE, the class FOR SHARE (409 CLASS_ARCHIVED), the advisory lock of the roll call
 * of the lesson, then the attendance itself FOR UPDATE, the local defense of the read-modify-write.
 * A cancelled lesson answers 409 LESSON_CANCELLED; a lesson rescheduled to the future does not
 * matter, since the attendance exists. Each write runs in one transaction with one `now` from the
 * Clock, and its audit event goes out after the commit, only when something changed. The answer is
 * the attendance read after the commit, with its notes: whoever justifies or corrects can see them.
 */
@Injectable()
export class StudentAttendanceRecordsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly lessons: LessonsService,
    private readonly people: PeopleService,
    private readonly access: StudentRollCallAccess,
  ) {}

  /**
   * `PATCH /student-attendance/:id/justify`: justifies an absence, or replaces its justification
   * (reason, note, who and when). The status does not change: a justified absence is still an
   * absence, in the attendance rate too. The same reason and note again is a no-op (no write, no
   * event).
   *
   * Errors, in the order they are answered: 404 STUDENT_ATTENDANCE_NOT_FOUND, 409 LESSON_CANCELLED,
   * 409 CLASS_ARCHIVED, 403 FORBIDDEN_SCOPE (a member who does not take the roll call of the lesson:
   * the confirmed assignments are read FOR SHARE, after the advisory lock) and 409
   * STUDENT_ATTENDANCE_NOT_ABSENT.
   *
   * Emits STUDENT_ABSENCE_JUSTIFIED after the commit, with the names of the fields that changed and
   * never their values.
   */
  async justify(
    requestedId: string,
    dto: JustifyAbsenceDto,
    actor: AuthUser,
  ): Promise<StudentAttendanceResponseDto> {
    const now = this.clock.now();
    const note = dto.note ?? null;

    const outcome = await this.dataSource.transaction(async (manager): Promise<RecordOutcome> => {
      const { id, lesson } = await this.lockRollCallOf(manager, requestedId);
      await this.access.assertCanTake(actor, lesson.id, manager);
      const row = await this.lockRow(manager, id);
      if (row.status !== StudentAttendanceStatus.ABSENT) throw studentAttendanceNotAbsent();

      const changedFields = [
        ...(row.justificationReason === dto.reason ? [] : ["justificationReason"]),
        ...(row.justificationNote === note ? [] : ["justificationNote"]),
      ];
      if (changedFields.length === 0) return { id: row.id, auditEvent: null };

      await manager.update(
        StudentAttendance,
        { id: row.id },
        {
          justificationReason: dto.reason,
          justificationNote: note,
          justifiedById: actor.id,
          justifiedAt: now,
          updatedAt: now,
        },
      );
      return { id: row.id, auditEvent: justifiedAuditOf(row, changedFields, actor.id, now) };
    });

    return this.finish(outcome);
  }

  /**
   * `PATCH /student-attendance/:id/correct`: changes the status of a signed attendance, with a
   * reason, and records the correction in the history (`attendance_corrections`: from, to, reason,
   * who and when), in the same transaction. The first signature (`signedBy`, `signedAt`) stays. An
   * absence corrected to present loses its justification (a presence is never justified); back to
   * absent it is not restored.
   *
   * Errors, in the order they are answered: 404 STUDENT_ATTENDANCE_NOT_FOUND, 409 LESSON_CANCELLED,
   * 409 CLASS_ARCHIVED and 400 STUDENT_ATTENDANCE_STATUS_UNCHANGED (a correction to the status it already
   * has would throw the reason away). Who may is attendance.correct, all or none, so the guard of
   * the route decides it and the policy is not asked here.
   *
   * Emits STUDENT_ATTENDANCE_CORRECTED after the commit, without the reason.
   */
  async correct(
    requestedId: string,
    dto: CorrectStudentAttendanceDto,
    actor: AuthUser,
  ): Promise<StudentAttendanceResponseDto> {
    const now = this.clock.now();

    const outcome = await this.dataSource.transaction(async (manager): Promise<RecordOutcome> => {
      const { id } = await this.lockRollCallOf(manager, requestedId);
      const row = await this.lockRow(manager, id);
      if (row.status === dto.status) throw studentAttendanceStatusUnchanged();

      const correction = await manager.save(
        AttendanceCorrection,
        manager.create(AttendanceCorrection, {
          studentAttendanceId: row.id,
          fromStatus: row.status,
          toStatus: dto.status,
          reason: dto.reason,
          correctedById: actor.id,
          createdAt: now,
          updatedAt: now,
        }),
      );
      const clearedJustification =
        dto.status === StudentAttendanceStatus.PRESENT
          ? {
              justificationReason: null,
              justificationNote: null,
              justifiedById: null,
              justifiedAt: null,
            }
          : {};
      await manager.update(
        StudentAttendance,
        { id: row.id },
        { status: dto.status, updatedAt: now, ...clearedJustification },
      );

      return {
        id: row.id,
        auditEvent: correctedAuditOf(row, dto.status, correction.id, actor.id, now),
      };
    });

    return this.finish(outcome);
  }

  /**
   * The attendance and the roll call of its lesson, locked: a plain read of the attendance (404 when
   * it is not there), its lesson FOR SHARE (409 LESSON_CANCELLED), then the class FOR SHARE and the
   * advisory lock of the roll call through `StudentRollCallAccess`. The foreign key requires the lesson: a missing
   * one throws.
   */
  private async lockRollCallOf(
    manager: EntityManager,
    requestedId: string,
  ): Promise<{ id: string; lesson: LessonSummary }> {
    const peek = await manager.findOne(StudentAttendance, { where: { id: requestedId } });
    if (peek === null) throw studentAttendanceNotFound();

    const lesson = await this.lessons.getLessonSummary(peek.lessonId, manager, { forShare: true });
    if (lesson === null) {
      throw new Error(
        `Lesson ${peek.lessonId} of the attendance ${peek.id} was not found, but the foreign key requires it.`,
      );
    }
    if (lesson.status === LessonStatus.CANCELLED) throw lessonCancelled();
    await this.access.lockClassAndRollCall(manager, lesson);

    return { id: peek.id, lesson };
  }

  /** The attendance FOR UPDATE, read again under the locks. It is never deleted: missing throws. */
  private async lockRow(manager: EntityManager, id: string): Promise<StudentAttendance> {
    const row = await manager.findOne(StudentAttendance, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (row === null)
      throw new Error(`The attendance ${id} is gone under the lock of its roll call.`);

    return row;
  }

  /** Emits the audit event of a write that changed something, then answers the attendance. */
  private async finish(outcome: RecordOutcome): Promise<StudentAttendanceResponseDto> {
    if (outcome.auditEvent !== null) {
      this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, outcome.auditEvent);
    }
    return this.readRecord(outcome.id);
  }

  /**
   * One attendance as it is now, with its corrections (the oldest first) and every name in ONE call
   * to `PeopleService.findRefsByIds`. Read after the commit of a write of it, so it exists.
   */
  private async readRecord(id: string): Promise<StudentAttendanceResponseDto> {
    const row = await this.dataSource.getRepository(StudentAttendance).findOne({ where: { id } });
    if (row === null) throw new Error(`The attendance ${id} was written and is not there.`);

    const corrections = await this.dataSource.getRepository(AttendanceCorrection).find({
      where: { studentAttendanceId: row.id },
      order: { createdAt: "ASC", id: "ASC" },
    });
    const people = await this.people.findRefsByIds([
      row.signedById,
      ...(row.justifiedById === null ? [] : [row.justifiedById]),
      ...corrections.map((correction) => correction.correctedById),
    ]);

    return toStudentAttendanceResponse(
      row,
      corrections,
      new Map(people.map((person) => [person.id, person])),
      { canSeeNotes: true },
    );
  }
}
