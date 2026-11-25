/** Channel of the event a lesson cancellation produces. */
export const LESSON_CANCELLED_EVENT = "lesson.cancelled";

/**
 * Emitted by the lessons module, after the commit, when a lesson goes from any status to
 * `cancelled` (GUS-151). A repeated cancel of a lesson that is already cancelled writes nothing and
 * has no audit event, but emits this event again (GUS-168): the listeners are idempotent, so it is
 * how a reaction that failed (the reversal of the hours) is repaired. Whoever listens must do
 * nothing for a lesson whose reaction is already done.
 *
 * It is the hook of RN-07: hours already recorded for a cancelled lesson must be reversed. The
 * `hours` module listens to this channel (LessonCancelledListener, GUS-168) and reverses the
 * hours of the lesson, without `lessons` knowing it exists (docs/ARCHITECTURE.md
 * section 3).
 *
 * It is not the audit event: the trail of the cancellation goes out on `auditable.action` as
 * `LESSON_CANCELLED`. This one carries only what a reaction needs, and no free text (the reason
 * of the cancellation may hold personal data, RNF-13).
 */
export class LessonCancelledEvent {
  /** Id of the lesson that was cancelled. */
  readonly lessonId: string;
  /** Id of the class the lesson belongs to. */
  readonly classId: string;
  /** Day the lesson was scheduled for, "YYYY-MM-DD" (a rescheduled lesson carries the new day). */
  readonly date: string;
  /** Id of the person who cancelled it, or who asked to cancel it again. */
  readonly cancelledById: string;
  /** Instant of the cancellation, or of the request to cancel it again. */
  readonly cancelledAt: Date;

  constructor(
    init: Pick<
      LessonCancelledEvent,
      "lessonId" | "classId" | "date" | "cancelledById" | "cancelledAt"
    >,
  ) {
    Object.assign(this, init);
  }
}
