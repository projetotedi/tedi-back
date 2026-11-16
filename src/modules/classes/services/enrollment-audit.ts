import { AuditableAction, AuditableActionEvent } from "@shared/events/auditable-action.event";

export const ENROLLMENT_TARGET_TYPE = "enrollment";

/**
 * The audit event of an enrollment (`targetType "enrollment"`). Only ids, statuses and dates: the
 * caller never puts the reason of a change (`statusReason`, free text that may carry health
 * information) nor any personal data of the student in `before` or `after` (RNF-13).
 */
export function buildEnrollmentAuditEvent(
  action: AuditableAction,
  actorId: string,
  enrollmentId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  occurredAt: Date,
): AuditableActionEvent {
  const event = new AuditableActionEvent();
  event.actorId = actorId;
  event.action = action;
  event.targetType = ENROLLMENT_TARGET_TYPE;
  event.targetId = enrollmentId;
  event.before = before;
  event.after = after;
  event.occurredAt = occurredAt;
  return event;
}
