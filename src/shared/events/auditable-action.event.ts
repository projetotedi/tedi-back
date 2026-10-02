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
  /** A student was registered (Person + StudentProfile). */
  STUDENT_CREATED = "STUDENT_CREATED",
  /** Student data changed. Payload carries only non-sensitive values plus changedFields. */
  STUDENT_UPDATED = "STUDENT_UPDATED",
  /** A student was archived instead of deleted (RN-27). */
  STUDENT_ARCHIVED = "STUDENT_ARCHIVED",
  /** An archived student was reactivated. */
  STUDENT_UNARCHIVED = "STUDENT_UNARCHIVED",
  /** A person submitted the member registration through an access invite (status pending, no access). */
  MEMBER_REGISTRATION_SUBMITTED = "MEMBER_REGISTRATION_SUBMITTED",
  /** Coordination approved a registration: role, department, main function and join date set; access granted. */
  MEMBER_REGISTRATION_APPROVED = "MEMBER_REGISTRATION_APPROVED",
  /** Coordination rejected a registration with a mandatory note; access stays closed. */
  MEMBER_REGISTRATION_REJECTED = "MEMBER_REGISTRATION_REJECTED",
  /** Coordination created a department (GUS-91). */
  DEPARTMENT_CREATED = "DEPARTMENT_CREATED",
}

/**
 * Payload emitted on the `auditable.action` channel whenever an auditable
 * action occurs. The persistence listener (E9.b) saves this to the audit log.
 *
 * Fields:
 *  - actorId     — UUID of the person who triggered the action
 *  - action      — which AuditableAction occurred
 *  - targetType  — entity type affected ("invite" | "person" | "student" | "member" | "department" | ...)
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
