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
  /** Person's role was changed by a coordinator or superadmin. */
  ROLE_CHANGED = "ROLE_CHANGED",
  /** Person's access was re-enabled. */
  ACCESS_ENABLED = "ACCESS_ENABLED",
  /** Person's access was disabled. */
  ACCESS_DISABLED = "ACCESS_DISABLED",
  /** A password-reset invite was created for a person. */
  PASSWORD_RESET_CREATED = "PASSWORD_RESET_CREATED",
  /** An invite was revoked before it could be used. */
  INVITE_REVOKED = "INVITE_REVOKED",
  /** A person completed a password reset via invite. */
  PASSWORD_RESET = "PASSWORD_RESET",
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
