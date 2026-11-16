import { Injectable } from "@nestjs/common";
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
 * listener reverses, in one transaction, every active attendance entry of it, as the person who
 * cancelled it, with one instant from the Clock. The rows of the attendance stay (who signed what);
 * their entry is reversed.
 *
 * Idempotent: the same event again finds nothing active and writes nothing, so re-emitting it is
 * safe. Delivered at most once: the event lives in the process, without an outbox, so a crash
 * between the commit of the cancellation and this listener leaves the hours. An error here is
 * caught and logged with its stack by the EventSubscribersLoader of @nestjs/event-emitter; do NOT
 * pass `suppressErrors: false`, which would turn it into an unhandled rejection of the synchronous
 * `emit` of `LessonsService.cancel`.
 */
@Injectable()
export class LessonCancelledListener {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly lessonHours: LessonHoursService,
  ) {}

  @OnEvent(LESSON_CANCELLED_EVENT)
  async reverseLessonHours(event: LessonCancelledEvent): Promise<void> {
    const now = this.clock.now();
    const auditEvents = await this.dataSource.transaction((manager) =>
      this.lessonHours.reverseLessonEntries(manager, event.lessonId, event.cancelledById, now),
    );

    for (const auditEvent of auditEvents) {
      this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, auditEvent);
    }
  }
}
