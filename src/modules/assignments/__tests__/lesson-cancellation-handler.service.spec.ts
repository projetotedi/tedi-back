import "reflect-metadata";
import { EntityManager, In } from "typeorm";
import { LessonCancellationRegistry } from "@modules/lessons/services/lesson-cancellation.registry";
import { AuditableAction } from "@shared/events/auditable-action.event";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatusReason } from "../enums/assignment-status-reason.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { LessonCancellationHandlerService } from "../services/lesson-cancellation-handler.service";

const NOW = new Date("2026-03-09T12:00:00.000Z");
const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const CONFIRMED_ID = "01999a3e-7c1b-7000-8000-0000000000a1";
const DIRECT_PENDING_ID = "01999a3e-7c1b-7000-8000-0000000000a2";
const APPLICATION_ID = "01999a3e-7c1b-7000-8000-0000000000a3";
const APPROVED_ID = "01999a3e-7c1b-7000-8000-0000000000a4";
const PERSON_ID = "01999a3e-0000-7000-8000-0000000000b1";

function assignment(
  id: string,
  status: AssignmentStatus,
  source: AssignmentSource,
  role: AssignmentRole = AssignmentRole.MONITOR,
): LessonAssignment {
  return Object.assign(new LessonAssignment(), {
    id,
    lessonId: LESSON_ID,
    personId: PERSON_ID,
    role,
    status,
    source,
  });
}

const ACTIVE = {
  lessonId: LESSON_ID,
  status: In([AssignmentStatus.PENDING, AssignmentStatus.CONFIRMED]),
};

describe("LessonCancellationHandlerService (GUS-179)", () => {
  let service: LessonCancellationHandlerService;
  let registry: LessonCancellationRegistry;
  const manager = { find: jest.fn(), update: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    registry = new LessonCancellationRegistry();
    service = new LessonCancellationHandlerService(registry);
  });

  it("registers itself in the LessonCancellationRegistry when the module starts", async () => {
    service.onModuleInit();
    manager.find.mockResolvedValue([]);

    await registry.holdAssignments(manager as unknown as EntityManager, LESSON_ID);

    expect(manager.find).toHaveBeenCalledTimes(1);
    expect(() => registry.register(service)).toThrow("already registered");
  });

  describe("holdAssignments", () => {
    it("locks the active assignments of the lesson FOR KEY SHARE, in the order of their ids, and changes nothing", async () => {
      manager.find.mockResolvedValue([]);

      await service.holdAssignments(manager as unknown as EntityManager, LESSON_ID);

      expect(manager.find).toHaveBeenCalledWith(LessonAssignment, {
        select: { id: true },
        where: ACTIVE,
        order: { id: "ASC" },
        lock: { mode: "for_key_share" },
      });
      expect(manager.update).not.toHaveBeenCalled();
    });

    it("asks nothing for an id that is not a UUID: the lookup of the lesson answers 404", async () => {
      await service.holdAssignments(manager as unknown as EntityManager, "not-a-uuid");

      expect(manager.find).not.toHaveBeenCalled();
    });
  });

  describe("endAssignments", () => {
    it("cancels the confirmed and the pending direct assignments, and expires the pending applications, with the reason", async () => {
      manager.find.mockResolvedValue([
        assignment(CONFIRMED_ID, AssignmentStatus.CONFIRMED, AssignmentSource.DIRECT),
        assignment(DIRECT_PENDING_ID, AssignmentStatus.PENDING, AssignmentSource.DIRECT),
        assignment(APPLICATION_ID, AssignmentStatus.PENDING, AssignmentSource.APPLICATION),
        assignment(APPROVED_ID, AssignmentStatus.CONFIRMED, AssignmentSource.APPLICATION),
      ]);

      await service.endAssignments(manager as unknown as EntityManager, LESSON_ID, ACTOR_ID, NOW);

      expect(manager.find).toHaveBeenCalledWith(LessonAssignment, {
        where: ACTIVE,
        order: { createdAt: "ASC", id: "ASC" },
        lock: { mode: "pessimistic_write" },
      });
      expect(manager.update).toHaveBeenCalledTimes(2);
      expect(manager.update).toHaveBeenCalledWith(
        LessonAssignment,
        { id: In([CONFIRMED_ID, DIRECT_PENDING_ID, APPROVED_ID]) },
        {
          status: AssignmentStatus.CANCELLED,
          cancelledAt: NOW,
          cancelledById: ACTOR_ID,
          statusReason: AssignmentStatusReason.LESSON_CANCELLED,
          updatedAt: NOW,
        },
      );
      // No cancelled_* and no reviewer: the CHECKs tie them to cancelled and to a decision.
      expect(manager.update).toHaveBeenCalledWith(
        LessonAssignment,
        { id: In([APPLICATION_ID]) },
        {
          status: AssignmentStatus.EXPIRED,
          statusReason: AssignmentStatusReason.LESSON_CANCELLED,
          updatedAt: NOW,
        },
      );
    });

    it("answers one audit event per assignment, with who cancelled the lesson, and no note", async () => {
      manager.find.mockResolvedValue([
        Object.assign(
          assignment(
            CONFIRMED_ID,
            AssignmentStatus.CONFIRMED,
            AssignmentSource.DIRECT,
            AssignmentRole.TEACHER,
          ),
          { note: "A aluna foi internada." },
        ),
        assignment(APPLICATION_ID, AssignmentStatus.PENDING, AssignmentSource.APPLICATION),
      ]);

      const events = await service.endAssignments(
        manager as unknown as EntityManager,
        LESSON_ID,
        ACTOR_ID,
        NOW,
      );

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        action: AuditableAction.LESSON_ASSIGNMENT_CANCELLED,
        actorId: ACTOR_ID,
        targetType: "lesson_assignment",
        targetId: CONFIRMED_ID,
        before: { status: AssignmentStatus.CONFIRMED },
        after: {
          status: AssignmentStatus.CANCELLED,
          cancelledAt: NOW,
          lessonId: LESSON_ID,
          personId: PERSON_ID,
          role: AssignmentRole.TEACHER,
          statusReason: AssignmentStatusReason.LESSON_CANCELLED,
        },
        occurredAt: NOW,
      });
      expect(events[1]).toMatchObject({
        action: AuditableAction.LESSON_ASSIGNMENT_EXPIRED,
        actorId: ACTOR_ID,
        targetId: APPLICATION_ID,
        before: { status: AssignmentStatus.PENDING },
        after: {
          status: AssignmentStatus.EXPIRED,
          lessonId: LESSON_ID,
          personId: PERSON_ID,
          role: AssignmentRole.MONITOR,
          statusReason: AssignmentStatusReason.LESSON_CANCELLED,
        },
      });
      expect(events[1].after).not.toHaveProperty("cancelledAt");
      expect(JSON.stringify(events)).not.toContain("internada");
    });

    it("writes nothing and answers no event when the lesson has no active assignment", async () => {
      manager.find.mockResolvedValue([]);

      await expect(
        service.endAssignments(manager as unknown as EntityManager, LESSON_ID, ACTOR_ID, NOW),
      ).resolves.toEqual([]);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it("updates only the kind there is: no expiry without a pending application", async () => {
      manager.find.mockResolvedValue([
        assignment(CONFIRMED_ID, AssignmentStatus.CONFIRMED, AssignmentSource.DIRECT),
      ]);

      await service.endAssignments(manager as unknown as EntityManager, LESSON_ID, ACTOR_ID, NOW);

      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(manager.update.mock.calls[0][2]).toMatchObject({ status: AssignmentStatus.CANCELLED });
    });
  });
});
