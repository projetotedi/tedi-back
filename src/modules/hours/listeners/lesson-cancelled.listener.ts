import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { DataSource } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { AUDITABLE_ACTION_EVENT } from "@shared/events/auditable-action.event";
import {
  LESSON_CANCELLED_EVENT,
  LessonCancelledEvent,
} from "@shared/events/lesson-cancelled.event";
import { LessonHoursService } from "../services/lesson-hours.service";

/**
 * A cancelled lesson did not happen, so its hours go (RN-07): when `lessons` cancels a lesson, this
 * listener reverses, in one transaction, every active entry of it (of the attendance, or logged and
 * linked to it, GUS-172), as the person who cancelled it, with one instant from the Clock. The rows of the attendance stay (who signed what);
 * their entry is reversed.
 *
 * Idempotent: the same event again finds nothing active and writes nothing. Delivered at most once:
 * the event lives in the process, without an outbox, so a crash between the commit of the
 * cancellation and this listener leaves the hours. The repair is to cancel the lesson again:
 * `lessons` emits the event again for a lesson already cancelled (GUS-168).
 *
 * A failure is logged here with the ids of the lesson and of who cancelled it (ids only: the
 * message of a database error can carry values) and rethrown, so the EventSubscribersLoader of
 * @nestjs/event-emitter logs it with its stack; do NOT pass `suppressErrors: false`, which would
 * turn it into an unhandled rejection of the synchronous `emit` of `LessonsService.cancel`.
 */
@Injectable()
export class LessonCancelledListener {
  private readonly logger = new Logger(LessonCancelledListener.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly lessonHours: LessonHoursService,
  ) {}

  @OnEvent(LESSON_CANCELLED_EVENT)
  async reverseLessonHours(event: LessonCancelledEvent): Promise<void> {
    const now = this.clock.now();
    const auditEvents = await this.dataSource
      .transaction((manager) =>
        this.lessonHours.reverseLessonEntries(manager, event.lessonId, event.cancelledById, now),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Reversing the attendance hours of the cancelled lesson ${event.lessonId} (cancelled by ${event.cancelledById}) failed; cancel the lesson again to retry.`,
        );
        throw error;
      });

    for (const auditEvent of auditEvents) {
      this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, auditEvent);
    }
  }
}
