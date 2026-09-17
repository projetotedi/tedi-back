/**
 * Channel name for auditable action events.
 * Listeners subscribe to this channel to persist audit logs.
 */
export const AUDITABLE_ACTION_EVENT = "auditable.action";

/**
 * Enumeration of all actions that produce an audit trail.
 * New entries must match the persistence listener (future E9.b).
 */
export enum AuditableAction {
  INVITE_CREATED = "INVITE_CREATED",
  ACCESS_CREATED = "ACCESS_CREATED",
}

/**
 * Payload emitted on the `auditable.action` channel whenever an auditable
 * action occurs. The persistence listener (E9.b) saves this to the audit log.
 *
 * Fields:
 *  - actorId     — UUID of the person who triggered the action
 *  - action      — which AuditableAction occurred
 *  - targetType  — entity type affected ("invite" | "person" | ...)
 *  - targetId    — UUID of the affected entity
 *  - before      — snapshot of the entity before the change (null if created)
 *  - after       — snapshot of the entity after the change
 *  - occurredAt  — wall-clock timestamp of the event
 */
export class AuditableActionEvent {
  actorId: string;
  action: AuditableAction;
  targetType: string;
  targetId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  occurredAt: Date;
}
