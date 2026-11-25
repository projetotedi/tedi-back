import { AuditableAction, AuditableActionEvent } from "@shared/events/auditable-action.event";

const HOUR_ENTRY_TARGET_TYPE = "hour_entry";

/** What the audit event of an hour entry carries. `before` is null for a creation. */
export interface HourEntryAudit {
  action: AuditableAction;
  actorId: string;
  hourEntryId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  occurredAt: Date;
}

/**
 * The audit event of an hour entry (`targetType "hour_entry"`), for the review (GUS-164). The same
 * as the private builder of HoursService, kept apart while GUS-162 is under review; they become one
 * in a later refactor. The caller never puts free text (activity, notes, review note) in
 * `before` or `after` (RNF-13).
 */
export function buildHourEntryAuditEvent({
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
