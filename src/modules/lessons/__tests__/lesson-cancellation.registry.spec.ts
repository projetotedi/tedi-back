import { EntityManager } from "typeorm";
import { AuditableAction, AuditableActionEvent } from "@shared/events/auditable-action.event";
import {
  LessonCancellationHandler,
  LessonCancellationRegistry,
} from "../services/lesson-cancellation.registry";

const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const NOW = new Date("2026-03-09T12:00:00.000Z");

describe("LessonCancellationRegistry", () => {
  const manager = {} as EntityManager;

  function handler(events: AuditableActionEvent[] = []): LessonCancellationHandler {
    return {
      holdAssignments: jest.fn().mockResolvedValue(undefined),
      endAssignments: jest.fn().mockResolvedValue(events),
    };
  }

  it("does nothing without a handler registered: no assignment held, none ended, no event", async () => {
    const registry = new LessonCancellationRegistry();

    await expect(registry.holdAssignments(manager, LESSON_ID)).resolves.toBeUndefined();
    await expect(registry.endAssignments(manager, LESSON_ID, ACTOR_ID, NOW)).resolves.toEqual([]);
  });

  it("delegates both calls to the handler, with the manager of the transaction", async () => {
    const registry = new LessonCancellationRegistry();
    const event = Object.assign(new AuditableActionEvent(), {
      action: AuditableAction.LESSON_ASSIGNMENT_CANCELLED,
    });
    const registered = handler([event]);
    registry.register(registered);

    await registry.holdAssignments(manager, LESSON_ID);
    await expect(registry.endAssignments(manager, LESSON_ID, ACTOR_ID, NOW)).resolves.toEqual([
      event,
    ]);
    expect(registered.holdAssignments).toHaveBeenCalledWith(manager, LESSON_ID);
    expect(registered.endAssignments).toHaveBeenCalledWith(manager, LESSON_ID, ACTOR_ID, NOW);
  });

  it("throws when a second handler registers", () => {
    const registry = new LessonCancellationRegistry();
    registry.register(handler());

    expect(() => registry.register(handler())).toThrow("already registered");
  });
});
