import { AuditableAction, AuditableActionEvent } from "@shared/events/auditable-action.event";
import { StudentAttendance } from "../entities/student-attendance.entity";

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
