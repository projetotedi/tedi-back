import { AuditableAction, AuditableActionEvent } from "@shared/events/auditable-action.event";
import { StudentAttendance } from "../entities/student-attendance.entity";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";

const STUDENT_ATTENDANCE_TARGET_TYPE = "student_attendance";

/**
 * The audit events of the roll call of the students (GUS-166, S16). They carry ids, statuses and
 * instants only: never the note of a justification, the reason of a correction or even the reason of
 * a justification ("health" is health data in itself, RNF-13).
 */
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
  event.targetType = STUDENT_ATTENDANCE_TARGET_TYPE;
  event.targetId = targetId;
  event.before = before;
  event.after = after;
  event.occurredAt = occurredAt;
  return event;
}

/** STUDENT_ATTENDANCE_SIGNED of a first signature, as it was inserted. */
export function signedAuditOf(
  row: StudentAttendance,
  actorId: string,
  now: Date,
): AuditableActionEvent {
  return auditEventOf(
    AuditableAction.STUDENT_ATTENDANCE_SIGNED,
    actorId,
    row.id,
    null,
    {
      lessonId: row.lessonId,
      enrollmentId: row.enrollmentId,
      status: row.status,
      signedById: row.signedById,
      signedAt: row.signedAt,
    },
    now,
  );
}

/**
 * STUDENT_ABSENCE_JUSTIFIED of a justification, new or replaced: whether the absence was justified
 * before, and which fields changed (`justificationReason`, `justificationNote`), never their values.
 */
export function justifiedAuditOf(
  before: StudentAttendance,
  changedFields: readonly string[],
  actorId: string,
  now: Date,
): AuditableActionEvent {
  return auditEventOf(
    AuditableAction.STUDENT_ABSENCE_JUSTIFIED,
    actorId,
    before.id,
    { justified: before.justificationReason !== null },
    { justified: true, justifiedAt: now, changedFields: [...changedFields] },
    now,
  );
}

/**
 * STUDENT_ATTENDANCE_CORRECTED of a correction: the status and whether it was justified, before and
 * after (a correction to present clears the justification), and the id of the correction. Never its
 * reason.
 */
export function correctedAuditOf(
  before: StudentAttendance,
  toStatus: StudentAttendanceStatus,
  correctionId: string,
  actorId: string,
  now: Date,
): AuditableActionEvent {
  const justifiedBefore = before.justificationReason !== null;
  return auditEventOf(
    AuditableAction.STUDENT_ATTENDANCE_CORRECTED,
    actorId,
    before.id,
    { status: before.status, justified: justifiedBefore },
    {
      status: toStatus,
      justified: toStatus === StudentAttendanceStatus.PRESENT ? false : justifiedBefore,
      correctionId,
      correctedAt: now,
    },
    now,
  );
}
