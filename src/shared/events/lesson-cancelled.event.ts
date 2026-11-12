/** Channel of the event a lesson cancellation produces. */
export const LESSON_CANCELLED_EVENT = "lesson.cancelled";

/**
 * Emitted by the lessons module, after the commit, when a lesson goes from any status to
 * `cancelled` (GUS-151). A repeated cancel of a lesson that is already cancelled emits nothing.
 *
 * It is the hook of RN-07: hours already recorded for a cancelled lesson must be reversed. The
 * `hours` module (E7) will listen to this channel and do it, without `lessons` knowing it exists
 * (docs/ARCHITECTURE.md section 3). Nobody listens today, so emitting it is free.
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
  /** Id of the person who cancelled it. */
  readonly cancelledById: string;
  /** Instant of the cancellation. */
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
