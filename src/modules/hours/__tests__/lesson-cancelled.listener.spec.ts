import { Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Clock } from "@shared/dates/clock";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { LessonCancelledEvent } from "@shared/events/lesson-cancelled.event";
import { LessonCancelledListener } from "../listeners/lesson-cancelled.listener";
import { LessonHoursService } from "../services/lesson-hours.service";

const NOW = new Date("2026-03-11T12:00:00.000Z");
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const COORDINATOR_ID = "01999a3e-0000-7000-8000-0000000000ee";

const EVENT = new LessonCancelledEvent({
  lessonId: LESSON_ID,
  classId: "01999a3e-7c1b-7000-8000-0000000000c1",
  date: "2026-03-10",
  cancelledById: COORDINATOR_ID,
  cancelledAt: new Date("2026-03-11T11:59:00.000Z"),
});

describe("LessonCancelledListener", () => {
  let listener: LessonCancelledListener;
  let order: string[];

  const manager = { name: "the manager of the transaction" };
  const dataSource = { transaction: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  const lessonHours = { reverseLessonEntries: jest.fn() };
  const reversals = [new AuditableActionEvent(), new AuditableActionEvent()];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];
    clock.now.mockReturnValue(NOW);
    dataSource.transaction.mockImplementation(async (work: (m: unknown) => Promise<unknown>) => {
      const result = await work(manager);
      order.push("commit");
      return result;
    });
    lessonHours.reverseLessonEntries.mockImplementation(async () => {
      order.push("reverse");
      return reversals;
    });
    eventEmitter.emit.mockImplementation(() => {
      order.push("emit-audit");
      return true;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LessonCancelledListener,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: LessonHoursService, useValue: lessonHours },
      ],
    }).compile();
    listener = moduleRef.get(LessonCancelledListener);
  });

  it("reverses the attendance hours of the cancelled lesson in a transaction, as the person who cancelled it, with one instant from the Clock", async () => {
    await listener.reverseLessonHours(EVENT);

    expect(clock.now).toHaveBeenCalledTimes(1);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(lessonHours.reverseLessonEntries).toHaveBeenCalledWith(
      manager,
      LESSON_ID,
      COORDINATOR_ID,
      NOW,
    );
  });

  it("emits the audit events of the reversal after the commit", async () => {
    await listener.reverseLessonHours(EVENT);

    expect(order).toEqual(["reverse", "commit", "emit-audit", "emit-audit"]);
    expect(eventEmitter.emit.mock.calls).toEqual([
      [AUDITABLE_ACTION_EVENT, reversals[0]],
      [AUDITABLE_ACTION_EVENT, reversals[1]],
    ]);
  });

  it("emits nothing when the transaction fails, and lets the error reach the event emitter", async () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const failure = new Error("connection lost");
    lessonHours.reverseLessonEntries.mockRejectedValue(failure);

    await expect(listener.reverseLessonHours(EVENT)).rejects.toBe(failure);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it("logs the lesson id when the reversal of a cancelled lesson fails", async () => {
    const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const failure = new Error('duplicate key value violates "uq_x": Key (person_id)=(secret)');
    lessonHours.reverseLessonEntries.mockRejectedValue(failure);

    await expect(listener.reverseLessonHours(EVENT)).rejects.toBe(failure);

    expect(logged).toHaveBeenCalledTimes(1);
    const [message, ...rest] = logged.mock.calls[0];
    expect(message).toContain(LESSON_ID);
    expect(message).toContain(COORDINATOR_ID);
    // Only ids: the message of a database error can carry values, and the stack is logged by the
    // EventSubscribersLoader once the error is rethrown.
    expect(String(message)).not.toContain("secret");
    expect(rest).toEqual([]);
  });

  it("does not log when the reversal succeeds", async () => {
    const logged = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    await listener.reverseLessonHours(EVENT);

    expect(logged).not.toHaveBeenCalled();
  });
});
