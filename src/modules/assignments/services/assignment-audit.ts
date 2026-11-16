import { AuditableAction, AuditableActionEvent } from "@shared/events/auditable-action.event";

export const ASSIGNMENT_TARGET_TYPE = "lesson_assignment";

/** What the audit event of an assignment carries. `before` is null for a creation. */
export interface AssignmentAudit {
  action: AuditableAction;
  actorId: string;
  assignmentId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  occurredAt: Date;
}

/**
 * The audit event of an assignment (`targetType "lesson_assignment"`), shared by the direct
 * assignment (GUS-158) and the application (GUS-160). The note never goes in: the caller builds
 * `before` and `after` without it (RNF-13).
 */
export function buildAssignmentAuditEvent({
  action,
  actorId,
  assignmentId,
  before,
  after,
  occurredAt,
}: AssignmentAudit): AuditableActionEvent {
  const event = new AuditableActionEvent();
  event.actorId = actorId;
  event.action = action;
  event.targetType = ASSIGNMENT_TARGET_TYPE;
  event.targetId = assignmentId;
  event.before = before;
  event.after = after;
  event.occurredAt = occurredAt;
  return event;
}
