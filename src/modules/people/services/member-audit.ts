import { AuditableAction, AuditableActionEvent } from "@shared/events/auditable-action.event";

/** `targetType` of the member registration events; `targetId` is the id of the Person. */
export const MEMBER_TARGET_TYPE = "member";

/**
 * Allow-list: the only member values that may appear in AuditableActionEvent before/after
 * (RNF-13/14, LGPD data minimization).
 *
 * cpf, address, city, state, phone, e-mails, birthDate, course, className and volunteerTermUrl
 * never enter. The persistence listener (E9.b) turns the event into a permanent audit log, so
 * what enters here must be safe to keep. An allow-list (not a deny-list) makes any new field
 * start out of the event.
 *
 * reviewNote enters: it is the "why" of the decision (like archiveReason). The DTOs warn the
 * coordinator not to record sensitive data in it.
 */
export const MEMBER_AUDIT_FIELDS = [
  "registrationStatus",
  "requestedRole",
  "role",
  "accessEnabled",
  "departmentId",
  "mainFunction",
  "joinedAt",
  "reviewNote",
  "inviteId",
  "resubmitted",
] as const;

/** Picks only the allow-listed fields from the given values. */
export function memberAuditSnapshot(
  values: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const field of MEMBER_AUDIT_FIELDS) {
    if (values[field] !== undefined) {
      snapshot[field] = values[field];
    }
  }
  return snapshot;
}

/**
 * Builds the audit event of a member registration action. before/after go through the
 * allow-list, so a caller that passes a whole entity by mistake still leaks nothing.
 * The caller emits it AFTER its transaction commits.
 */
export function buildMemberEvent(
  action: AuditableAction,
  actorId: string,
  personId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  now: Date,
): AuditableActionEvent {
  const event = new AuditableActionEvent();
  event.actorId = actorId;
  event.action = action;
  event.targetType = MEMBER_TARGET_TYPE;
  event.targetId = personId;
  event.before = before === null ? null : memberAuditSnapshot(before);
  event.after = memberAuditSnapshot(after);
  event.occurredAt = now;
  return event;
}
