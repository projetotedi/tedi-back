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
  LESSON_PLAN_CREATED = "LESSON_PLAN_CREATED",
  LESSON_PLAN_UPDATED = "LESSON_PLAN_UPDATED",
  LESSON_PLAN_ARCHIVED = "LESSON_PLAN_ARCHIVED",
  LESSON_PLAN_UNARCHIVED = "LESSON_PLAN_UNARCHIVED",
  /** A course was created, with its prerequisites (GUS-97). */
  COURSE_CREATED = "COURSE_CREATED",
  /** Course data or prerequisites changed. Payload carries only the changed fields plus changedFields (GUS-97). */
  COURSE_UPDATED = "COURSE_UPDATED",
  /** A class was created, with its edition when that did not exist yet (GUS-101). */
  CLASS_CREATED = "CLASS_CREATED",
  /** Class data changed, or its edition. Payload carries only the changed fields plus changedFields (GUS-101). */
  CLASS_UPDATED = "CLASS_UPDATED",
  /** A class was archived instead of deleted (RN-27, GUS-101). */
  CLASS_ARCHIVED = "CLASS_ARCHIVED",
  /** An archived class was reactivated (GUS-101). */
  CLASS_UNARCHIVED = "CLASS_UNARCHIVED",
}

/**
 * Payload emitted on the `auditable.action` channel whenever an auditable
 * action occurs. The persistence listener (E9.b) saves this to the audit log.
 *
 * Fields:
 *  - actorId     — UUID of the person who triggered the action
 *  - action      — which AuditableAction occurred
 *  - targetType  — entity type affected ("invite" | "person" | "student" | "member" | "department" | "course" | "class" | ...)
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
