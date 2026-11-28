import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { AuditableActionEvent } from "@shared/events/auditable-action.event";

/**
 * The port of the cancellation of a lesson (GUS-179): what the module that assigns people to the
 * lessons does to them when a lesson is cancelled, inside the SAME transaction as the lesson, so the
 * answer of `PATCH /lessons/:id/cancel` already counts nobody in the coverage. `lessons` cannot
 * import `assignments` (the arrow is `assignments -> lessons`, docs/ARCHITECTURE.md section 3), so
 * `lessons` defines the port and `assignments` implements it, as with the coverage.
 *
 * Two calls, because of the order of the locks (docs/ARCHITECTURE.md section 15.1): confirming an
 * assignment and approving an application lock the assignment FOR UPDATE and only then the lesson
 * FOR SHARE, so a cancellation that locked the lesson first and its assignments after could wait
 * for one of them in a circle.
 */
export interface LessonCancellationHandler {
  /**
   * Called FIRST, before the lesson is locked: holds the active assignments of the lesson, so a
   * confirmation or an approval of one of them either ends before the cancellation goes on, or
   * waits for it to end. It changes nothing.
   */
  holdAssignments(manager: EntityManager, lessonId: string): Promise<void>;

  /**
   * Called after the lesson is saved cancelled (or found already cancelled): ends the active
   * assignments of the lesson in the transaction of `manager` and answers their audit events, which
   * the caller emits after the commit.
   */
  endAssignments(
    manager: EntityManager,
    lessonId: string,
    actorId: string,
    now: Date,
  ): Promise<AuditableActionEvent[]>;
}

/**
 * Where `assignments` plugs in its `LessonCancellationHandler` when the module starts.
 * `LessonsModule` exports it and `LessonsService.cancel` calls it.
 *
 * It is a port and not the `lesson.cancelled` event: a listener runs after the commit, and the
 * assignments must change in the same transaction as the lesson. The hours still listen to the
 * event (RN-07): their reversal is a side effect that can be repeated.
 *
 * Without a handler registered nobody is assigned as far as `lessons` knows, so both calls do
 * nothing (a null object): an application that loads `lessons` without `assignments` still cancels
 * its lessons.
 */
@Injectable()
export class LessonCancellationRegistry implements LessonCancellationHandler {
  private handler: LessonCancellationHandler | null = null;

  /**
   * Plugs the handler in. One only: two would both change the same assignments, so it throws
   * instead of choosing between them.
   */
  register(handler: LessonCancellationHandler): void {
    if (this.handler !== null) {
      throw new Error("A lesson cancellation handler is already registered.");
    }
    this.handler = handler;
  }

  async holdAssignments(manager: EntityManager, lessonId: string): Promise<void> {
    if (this.handler === null) return;

    await this.handler.holdAssignments(manager, lessonId);
  }

  async endAssignments(
    manager: EntityManager,
    lessonId: string,
    actorId: string,
    now: Date,
  ): Promise<AuditableActionEvent[]> {
    if (this.handler === null) return [];

    return this.handler.endAssignments(manager, lessonId, actorId, now);
  }
}
