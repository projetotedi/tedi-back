import { Injectable, OnModuleInit } from "@nestjs/common";
import { isUUID } from "class-validator";
import { EntityManager, In } from "typeorm";
import {
  LessonCancellationHandler,
  LessonCancellationRegistry,
} from "@modules/lessons/services/lesson-cancellation.registry";
import { AuditableAction, AuditableActionEvent } from "@shared/events/auditable-action.event";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatusReason } from "../enums/assignment-status-reason.enum";
import { ACTIVE_ASSIGNMENT_STATUSES, AssignmentStatus } from "../enums/assignment-status.enum";
import { buildAssignmentAuditEvent } from "./assignment-audit";

/** The active assignments of a lesson: the ones its cancellation ends. */
function activeOf(lessonId: string) {
  return { lessonId, status: In([...ACTIVE_ASSIGNMENT_STATUSES]) };
}

/** A pending application expires with its lesson; any other active assignment is cancelled. */
function isPendingApplication(assignment: LessonAssignment): boolean {
  return (
    assignment.source === AssignmentSource.APPLICATION &&
    assignment.status === AssignmentStatus.PENDING
  );
}

/**
 * What the cancellation of a lesson does to its assignments (GUS-179): the implementation, in
 * `assignments`, of the port `lessons` defines (`LessonCancellationHandler`, docs/ARCHITECTURE.md
 * section 15). It plugs itself in the `LessonCancellationRegistry` when the module starts, and
 * `LessonsService.cancel` calls it inside the transaction of the lesson:
 * - the confirmed assignments and the pending direct ones become `cancelled`, with who cancelled the
 *   lesson and when (`cancelledById`, `cancelledAt`), as `PATCH /assignments/:id/cancel` writes them;
 * - the pending applications become `expired`: nobody decided them, so they leave the queue without
 *   a reviewer and without `cancelled_*` (the CHECK ties those to `cancelled`).
 * Both keep the row and get `statusReason` `lesson_cancelled`, which the history of the member shows,
 * and the same instant in `updatedAt`. Declined, cancelled and expired ones stay as they are.
 *
 * Locks: `holdAssignments` takes the active assignments of the lesson FOR KEY SHARE before the
 * lesson is locked. That conflicts with the FOR UPDATE that confirming, approving, declining and
 * cancelling an assignment take first, so none of them is halfway (holding the assignment and
 * waiting for the lesson) while the cancellation waits for one of them; and it does not conflict
 * with the FOR SHARE of the attendance, which locks the lesson before the confirmed assignments
 * (P11). `endAssignments` then reads them again FOR UPDATE, in a statement of its own: an
 * assignment made while the cancellation waited for the lesson is ended too.
 */
@Injectable()
export class LessonCancellationHandlerService implements LessonCancellationHandler, OnModuleInit {
  constructor(private readonly registry: LessonCancellationRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async holdAssignments(manager: EntityManager, lessonId: string): Promise<void> {
    // Not a UUID, not a lesson (Postgres would answer 22P02): the lookup of the lesson says 404.
    if (!isUUID(lessonId)) return;

    await manager.find(LessonAssignment, {
      select: { id: true },
      where: activeOf(lessonId),
      order: { id: "ASC" },
      lock: { mode: "for_key_share" },
    });
  }

  async endAssignments(
    manager: EntityManager,
    lessonId: string,
    actorId: string,
    now: Date,
  ): Promise<AuditableActionEvent[]> {
    const active = await manager.find(LessonAssignment, {
      where: activeOf(lessonId),
      order: { createdAt: "ASC", id: "ASC" },
      lock: { mode: "pessimistic_write" },
    });

    const toExpire = active.filter(isPendingApplication);
    const toCancel = active.filter((assignment) => !isPendingApplication(assignment));
    const reason = AssignmentStatusReason.LESSON_CANCELLED;

    if (toCancel.length > 0) {
      await manager.update(
        LessonAssignment,
        { id: In(toCancel.map((assignment) => assignment.id)) },
        {
          status: AssignmentStatus.CANCELLED,
          cancelledAt: now,
          cancelledById: actorId,
          statusReason: reason,
          updatedAt: now,
        },
      );
    }
    if (toExpire.length > 0) {
      await manager.update(
        LessonAssignment,
        { id: In(toExpire.map((assignment) => assignment.id)) },
        { status: AssignmentStatus.EXPIRED, statusReason: reason, updatedAt: now },
      );
    }

    return active.map((assignment) => {
      const what = {
        lessonId: assignment.lessonId,
        personId: assignment.personId,
        role: assignment.role,
        statusReason: reason,
      };
      return buildAssignmentAuditEvent({
        actorId,
        assignmentId: assignment.id,
        before: { status: assignment.status },
        occurredAt: now,
        ...(isPendingApplication(assignment)
          ? {
              action: AuditableAction.LESSON_ASSIGNMENT_EXPIRED,
              after: { status: AssignmentStatus.EXPIRED, ...what },
            }
          : {
              action: AuditableAction.LESSON_ASSIGNMENT_CANCELLED,
              after: { status: AssignmentStatus.CANCELLED, cancelledAt: now, ...what },
            }),
      });
    });
  }
}
