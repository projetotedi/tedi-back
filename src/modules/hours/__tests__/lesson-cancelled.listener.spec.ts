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
    const failure = new Error("connection lost");
    lessonHours.reverseLessonEntries.mockRejectedValue(failure);

    await expect(listener.reverseLessonHours(EVENT)).rejects.toBe(failure);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
