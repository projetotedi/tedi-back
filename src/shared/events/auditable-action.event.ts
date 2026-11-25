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
  /** Coordination ended the participation of a member: status inactive, exit date and reason; access disabled in the same transaction. The free note is never in the payload (RNF-13, GUS-147). */
  MEMBER_DEACTIVATED = "MEMBER_DEACTIVATED",
  /** An inactive member is active again; the exit is cleared and the access is NOT enabled (PATCH /access/:id/enabled, GUS-147). */
  MEMBER_REACTIVATED = "MEMBER_REACTIVATED",
  /** Coordination or the director of the department edited the data of a member (GUS-146). Payload carries only the allow-listed values (department, main function, join date) plus changedFields, which names every changed field without its value (RNF-13/14). */
  MEMBER_UPDATED = "MEMBER_UPDATED",
  /** Coordination created a department (GUS-91). */
  DEPARTMENT_CREATED = "DEPARTMENT_CREATED",
  LESSON_PLAN_CREATED = "LESSON_PLAN_CREATED",
  LESSON_PLAN_UPDATED = "LESSON_PLAN_UPDATED",
  LESSON_PLAN_ARCHIVED = "LESSON_PLAN_ARCHIVED",
  LESSON_PLAN_UNARCHIVED = "LESSON_PLAN_UNARCHIVED",
  /** A lesson plan was duplicated (GUS-118). Target is the copy; after carries sourceLessonPlanId and the copied fields. */
  LESSON_PLAN_DUPLICATED = "LESSON_PLAN_DUPLICATED",
  /** A course was created, with its prerequisites (GUS-97). */
  COURSE_CREATED = "COURSE_CREATED",
  /** Course data or prerequisites changed. Payload carries only the changed fields plus changedFields (GUS-97). */
  COURSE_UPDATED = "COURSE_UPDATED",
  /** The lesson plan sequence of a course was replaced; before and after carry lessonPlanIds in order (GUS-98). */
  COURSE_LESSON_PLANS_REPLACED = "COURSE_LESSON_PLANS_REPLACED",
  /** A course was duplicated (GUS-117). Target is the copy; after carries sourceCourseId, the copied fields and lessonPlanIds in order. */
  COURSE_DUPLICATED = "COURSE_DUPLICATED",
  /** A course was archived instead of deleted; it takes no new class (RN-27, RF-020, GUS-116). After carries archivedAt and archiveReason. */
  COURSE_ARCHIVED = "COURSE_ARCHIVED",
  /** An archived course was reactivated (GUS-116). Before carries the three archive columns. */
  COURSE_UNARCHIVED = "COURSE_UNARCHIVED",
  /** A class was created, with its edition when that did not exist yet (GUS-101). */
  CLASS_CREATED = "CLASS_CREATED",
  /** Class data changed, or its edition. Payload carries only the changed fields plus changedFields (GUS-101). */
  CLASS_UPDATED = "CLASS_UPDATED",
  /** A class was archived instead of deleted (RN-27, GUS-101). */
  CLASS_ARCHIVED = "CLASS_ARCHIVED",
  /** An archived class was reactivated (GUS-101). */
  CLASS_UNARCHIVED = "CLASS_UNARCHIVED",
  /** A student was enrolled in a class, one event per enrollment of the batch; after carries ids, status, dates and missingPrerequisiteIds, no personal data (GUS-108). */
  ENROLLMENT_CREATED = "ENROLLMENT_CREATED",
  /** The status of an enrollment changed. before and after carry status and statusChangedAt; changedFields names statusReason when it changed, never its value (RNF-13, GUS-108). */
  ENROLLMENT_STATUS_CHANGED = "ENROLLMENT_STATUS_CHANGED",
  /** An active enrollment made by mistake was removed; the row stays with deleted_at (GUS-108). */
  ENROLLMENT_REMOVED = "ENROLLMENT_REMOVED",
  /** A lesson was created, alone or from a lesson plan (GUS-151). */
  LESSON_CREATED = "LESSON_CREATED",
  /** Lesson data changed. Payload carries only the changed fields plus changedFields; the free text of postNotes is never in it (RNF-13, GUS-151). */
  LESSON_UPDATED = "LESSON_UPDATED",
  /** A lesson was cancelled with a reason; it stays, with status cancelled. The reason is not in the payload (RNF-13, GUS-151). */
  LESSON_CANCELLED = "LESSON_CANCELLED",
  /** A lesson moved to another date or time. It is the same lesson: before and after carry the schedule (GUS-151). */
  LESSON_RESCHEDULED = "LESSON_RESCHEDULED",
  /** A member was assigned to a lesson, as teacher or monitor, pending or already confirmed. Target is the assignment; the note is never in the payload (RNF-13, GUS-158). */
  LESSON_ASSIGNMENT_CREATED = "LESSON_ASSIGNMENT_CREATED",
  /** A pending assignment was confirmed: the member is now staff of the lesson. The note is never in the payload (RNF-13, GUS-158). */
  LESSON_ASSIGNMENT_CONFIRMED = "LESSON_ASSIGNMENT_CONFIRMED",
  /** A pending or confirmed assignment was cancelled; the row stays. The note is never in the payload (RNF-13, GUS-158). */
  LESSON_ASSIGNMENT_CANCELLED = "LESSON_ASSIGNMENT_CANCELLED",
  /** A member applied to a lesson, as teacher or monitor: the application is pending, source application, and the member is the actor. The note is never in the payload (RNF-13, GUS-160). */
  LESSON_ASSIGNMENT_APPLIED = "LESSON_ASSIGNMENT_APPLIED",
  /** A pending application was approved by whoever reviews them: it is now a confirmed assignment, counted in the coverage. The note is never in the payload (RNF-13, GUS-160). */
  LESSON_ASSIGNMENT_APPROVED = "LESSON_ASSIGNMENT_APPROVED",
  /** A pending application was declined by whoever reviews them; the row stays and the place of the member in the lesson is free again. The note is never in the payload (RNF-13, GUS-160). */
  LESSON_ASSIGNMENT_DECLINED = "LESSON_ASSIGNMENT_DECLINED",
  /** An hour entry was logged: by the person, on her behalf or by the attendance (GUS-162). No free text in the payload (RNF-13). */
  HOUR_ENTRY_CREATED = "HOUR_ENTRY_CREATED",
  /** A pending hour entry was removed by its person; the row stays with deleted_at (GUS-162). */
  HOUR_ENTRY_REMOVED = "HOUR_ENTRY_REMOVED",
  /** A pending hour entry was approved by coordination with its declared minutes, alone or in a batch; one event per entry (GUS-164). Or on creation, by whoever confirmed the attendance of the lesson, while lesson hours are born approved (GUS-168). */
  HOUR_ENTRY_APPROVED = "HOUR_ENTRY_APPROVED",
  /** A pending hour entry was approved with other minutes. The justification is not in the payload (RNF-13, GUS-164). */
  HOUR_ENTRY_ADJUSTED = "HOUR_ENTRY_ADJUSTED",
  /** A pending hour entry was rejected; it leaves the bank of hours. The reason is not in the payload (RNF-13, GUS-164). */
  HOUR_ENTRY_REJECTED = "HOUR_ENTRY_REJECTED",
  /** The hours of a lesson, of a presence or linked to it (GUS-172), were reversed, by a correction of the attendance to absent or by the cancellation of the lesson (RF-071, RN-07); the entry is soft-deleted, in any status. No free text in the payload (GUS-168). */
  HOUR_ENTRY_REVERSED = "HOUR_ENTRY_REVERSED",
  /** The attendance of a member at a lesson was signed for the first time, present or absent; a presence carries the hour entry it generated (GUS-168). */
  MEMBER_ATTENDANCE_CONFIRMED = "MEMBER_ATTENDANCE_CONFIRMED",
  /** A signed attendance changed status (present to absent or back), with who signed it before and after; there is no reason (GUS-168). */
  MEMBER_ATTENDANCE_CORRECTED = "MEMBER_ATTENDANCE_CORRECTED",
  /** The attendance of a student at a lesson was signed for the first time, present or absent; after carries ids, status and instant only (GUS-166). */
  STUDENT_ATTENDANCE_SIGNED = "STUDENT_ATTENDANCE_SIGNED",
  /** An absence of a student was justified, or its justification replaced; changedFields names the fields that changed, never their values: the reason and the note may be health data (RNF-13, GUS-166). */
  STUDENT_ABSENCE_JUSTIFIED = "STUDENT_ABSENCE_JUSTIFIED",
  /** A signed attendance of a student changed status through a correction; carries the statuses, whether it is justified and the id of the correction, never its reason (RNF-13, GUS-166). */
  STUDENT_ATTENDANCE_CORRECTED = "STUDENT_ATTENDANCE_CORRECTED",
}

/**
 * Payload emitted on the `auditable.action` channel whenever an auditable
 * action occurs. The persistence listener (E9.b) saves this to the audit log.
 *
 * Fields:
 *  - actorId     — UUID of the person who triggered the action
 *  - action      — which AuditableAction occurred
 *  - targetType  — entity type affected ("invite" | "person" | "student" | "member" | "department" | "course" | "class" | "lesson" | "lesson_assignment" | "hour_entry" | "member_attendance" | "enrollment" | "student_attendance" | ...)
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
