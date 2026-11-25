import { Test } from "@nestjs/testing";
import { EntityManager, In } from "typeorm";
import { AuditableAction, AuditableActionEvent } from "@shared/events/auditable-action.event";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { HoursService } from "../services/hours.service";
import {
  LESSON_HOURS_INITIAL_STATUS,
  LessonHoursInitialStatus,
  LessonHoursService,
  LessonPresence,
} from "../services/lesson-hours.service";

const NOW = new Date("2026-03-10T18:30:00.000Z");

const MONITOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const TEACHER_ID = "01999a3e-0000-7000-8000-0000000000bb";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const ENTRY_A = "01999a3e-7c1b-7000-8000-000000000a01";
const ENTRY_B = "01999a3e-7c1b-7000-8000-000000000a02";
const ENTRY_C = "01999a3e-7c1b-7000-8000-000000000a03";
const ENTRY_D = "01999a3e-7c1b-7000-8000-000000000a04";

/** The monitor signed present by the teacher in the lesson of the card, 14:00 to 15:30. */
const PRESENCE: LessonPresence = {
  personId: MONITOR_ID,
  confirmedById: TEACHER_ID,
  lesson: {
    id: LESSON_ID,
    classId: CLASS_ID,
    title: "Teclado, mouse e janelas",
    date: "2026-03-10",
    startTime: "14:00",
    endTime: "15:30",
  },
};

function entryOf(id: string, values: Partial<HourEntry> = {}): HourEntry {
  return Object.assign(new HourEntry(), {
    id,
    personId: MONITOR_ID,
    lessonId: LESSON_ID,
    origin: HourEntryOrigin.ATTENDANCE,
    status: HourEntryStatus.APPROVED,
    declaredMinutes: 90,
    validatedMinutes: 90,
    activity: "Teclado, mouse e janelas",
    notes: null,
    ...values,
  });
}

describe("LessonHoursService", () => {
  const manager = { find: jest.fn(), update: jest.fn(), save: jest.fn(), create: jest.fn() };
  const entityManager = manager as unknown as EntityManager;
  const hours = { createEntry: jest.fn() };
  const createdAudit = new AuditableActionEvent();

  async function serviceWith(initialStatus: LessonHoursInitialStatus): Promise<LessonHoursService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LessonHoursService,
        { provide: HoursService, useValue: hours },
        { provide: LESSON_HOURS_INITIAL_STATUS, useValue: initialStatus },
      ],
    }).compile();
    return moduleRef.get(LessonHoursService);
  }

  /** The rows of history given to the one save of a reversal. */
  function savedRows(): HourEntryEvent[] {
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(manager.save.mock.calls[0][0]).toBe(HourEntryEvent);
    return manager.save.mock.calls[0][1] as HourEntryEvent[];
  }

  beforeEach(() => {
    jest.resetAllMocks();
    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), data),
    );
    hours.createEntry.mockResolvedValue({
      entry: entryOf(ENTRY_A),
      auditEvents: [createdAudit],
    });
  });

  describe("recordPresence", () => {
    it("records a presence as attendance lesson hours: the person, the lesson and its class, its day, its title as the activity, its duration in minutes, authored by who confirmed", async () => {
      const service = await serviceWith(HourEntryStatus.APPROVED);

      const recorded = await service.recordPresence(entityManager, PRESENCE, NOW);

      expect(hours.createEntry).toHaveBeenCalledTimes(1);
      expect(hours.createEntry).toHaveBeenCalledWith(
        entityManager,
        {
          personId: MONITOR_ID,
          createdById: TEACHER_ID,
          origin: HourEntryOrigin.ATTENDANCE,
          activity: "Teclado, mouse e janelas",
          category: HourEntryCategory.LESSON,
          date: "2026-03-10",
          declaredMinutes: 90,
          notes: null,
          classId: CLASS_ID,
          lessonId: LESSON_ID,
          approvedById: TEACHER_ID,
        },
        NOW,
      );
      expect(recorded).toEqual({ hourEntryId: ENTRY_A, auditEvents: [createdAudit] });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("approves the hours on creation by who confirmed when LESSON_HOURS_INITIAL_STATUS is approved", async () => {
      const service = await serviceWith(HourEntryStatus.APPROVED);

      await service.recordPresence(entityManager, PRESENCE, NOW);

      expect(hours.createEntry.mock.calls[0][1]).toMatchObject({ approvedById: TEACHER_ID });
    });

    it("leaves the hours pending when LESSON_HOURS_INITIAL_STATUS is pending", async () => {
      const service = await serviceWith(HourEntryStatus.PENDING);

      await service.recordPresence(entityManager, PRESENCE, NOW);

      expect(hours.createEntry.mock.calls[0][1]).toMatchObject({ approvedById: null });
    });
  });

  describe("reverseEntries", () => {
    it("reverses the entries locked FOR UPDATE in the order of their ids, with one UPDATE of deleted_at and updated_at and one reversed row each", async () => {
      const service = await serviceWith(HourEntryStatus.APPROVED);
      manager.find.mockResolvedValue([entryOf(ENTRY_A), entryOf(ENTRY_B)]);

      await service.reverseEntries(entityManager, [ENTRY_B, ENTRY_A], TEACHER_ID, NOW);

      expect(manager.find).toHaveBeenCalledWith(HourEntry, {
        where: { id: In([ENTRY_B, ENTRY_A]) },
        order: { id: "ASC" },
        lock: { mode: "pessimistic_write" },
      });
      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(
        HourEntry,
        { id: In([ENTRY_A, ENTRY_B]) },
        { deletedAt: NOW, updatedAt: NOW },
      );
      expect(savedRows().map((row) => row.hourEntryId)).toEqual([ENTRY_A, ENTRY_B]);
      expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(
        manager.save.mock.invocationCallOrder[0],
      );
    });

    it("records the reversed row from the status and the minutes the entry was worth: validated for approved, adjusted and rejected (0), declared for pending", async () => {
      const service = await serviceWith(HourEntryStatus.APPROVED);
      manager.find.mockResolvedValue([
        entryOf(ENTRY_A, { status: HourEntryStatus.APPROVED, validatedMinutes: 90 }),
        entryOf(ENTRY_B, { status: HourEntryStatus.ADJUSTED, validatedMinutes: 60 }),
        entryOf(ENTRY_C, { status: HourEntryStatus.REJECTED, validatedMinutes: 0 }),
        entryOf(ENTRY_D, { status: HourEntryStatus.PENDING, validatedMinutes: null }),
      ]);

      await service.reverseEntries(
        entityManager,
        [ENTRY_A, ENTRY_B, ENTRY_C, ENTRY_D],
        TEACHER_ID,
        NOW,
      );

      expect(savedRows()).toEqual(
        [
          [ENTRY_A, HourEntryStatus.APPROVED, 90],
          [ENTRY_B, HourEntryStatus.ADJUSTED, 60],
          [ENTRY_C, HourEntryStatus.REJECTED, 0],
          [ENTRY_D, HourEntryStatus.PENDING, 90],
        ].map(([hourEntryId, fromStatus, fromMinutes]) =>
          expect.objectContaining({
            hourEntryId,
            type: HourEntryEventType.REVERSED,
            actorId: TEACHER_ID,
            fromStatus,
            toStatus: null,
            fromMinutes,
            toMinutes: null,
            note: null,
            createdAt: NOW,
            updatedAt: NOW,
          }),
        ),
      );
    });

    it("skips an entry that is already removed or reversed, with no row and no audit event for it", async () => {
      const service = await serviceWith(HourEntryStatus.APPROVED);
      // The find leaves soft-deleted rows out (no withDeleted): only the active one comes back.
      manager.find.mockResolvedValue([entryOf(ENTRY_B)]);

      const audits = await service.reverseEntries(
        entityManager,
        [ENTRY_A, ENTRY_B],
        TEACHER_ID,
        NOW,
      );

      expect(manager.find.mock.calls[0][1]).not.toHaveProperty("withDeleted");
      expect(savedRows().map((row) => row.hourEntryId)).toEqual([ENTRY_B]);
      expect(audits.map((audit) => audit.targetId)).toEqual([ENTRY_B]);

      jest.clearAllMocks();
      manager.find.mockResolvedValue([]);
      expect(await service.reverseEntries(entityManager, [ENTRY_A], TEACHER_ID, NOW)).toEqual([]);
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("does not query for an empty list of entries", async () => {
      const service = await serviceWith(HourEntryStatus.APPROVED);

      expect(await service.reverseEntries(entityManager, [], TEACHER_ID, NOW)).toEqual([]);
      expect(manager.find).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("builds one HOUR_ENTRY_REVERSED per entry, without free text, with the instant it is given", async () => {
      const service = await serviceWith(HourEntryStatus.APPROVED);
      manager.find.mockResolvedValue([
        entryOf(ENTRY_A),
        entryOf(ENTRY_B, { status: HourEntryStatus.PENDING, validatedMinutes: null }),
      ]);

      const audits = await service.reverseEntries(
        entityManager,
        [ENTRY_A, ENTRY_B],
        TEACHER_ID,
        NOW,
      );

      expect(audits).toHaveLength(2);
      expect(audits[0]).toBeInstanceOf(AuditableActionEvent);
      expect(audits[0]).toEqual(
        Object.assign(new AuditableActionEvent(), {
          actorId: TEACHER_ID,
          action: AuditableAction.HOUR_ENTRY_REVERSED,
          targetType: "hour_entry",
          targetId: ENTRY_A,
          before: {
            personId: MONITOR_ID,
            lessonId: LESSON_ID,
            status: HourEntryStatus.APPROVED,
            declaredMinutes: 90,
            validatedMinutes: 90,
          },
          after: { deletedAt: NOW },
          occurredAt: NOW,
        }),
      );
      expect(audits[1].before).toMatchObject({
        status: HourEntryStatus.PENDING,
        validatedMinutes: null,
      });
      expect(JSON.stringify(audits)).not.toContain("Teclado");
    });
  });

  describe("reverseLessonEntries", () => {
    it("reverses every active entry of a lesson, whatever its origin, and writes nothing when there is none", async () => {
      const service = await serviceWith(HourEntryStatus.APPROVED);
      manager.find.mockResolvedValue([entryOf(ENTRY_A), entryOf(ENTRY_B)]);

      const audits = await service.reverseLessonEntries(entityManager, LESSON_ID, TEACHER_ID, NOW);

      expect(manager.find).toHaveBeenCalledWith(HourEntry, {
        where: { lessonId: LESSON_ID },
        order: { id: "ASC" },
        lock: { mode: "pessimistic_write" },
      });
      expect(manager.update).toHaveBeenCalledWith(
        HourEntry,
        { id: In([ENTRY_A, ENTRY_B]) },
        { deletedAt: NOW, updatedAt: NOW },
      );
      expect(savedRows()).toHaveLength(2);
      expect(audits.map((audit) => audit.action)).toEqual([
        AuditableAction.HOUR_ENTRY_REVERSED,
        AuditableAction.HOUR_ENTRY_REVERSED,
      ]);

      jest.clearAllMocks();
      manager.find.mockResolvedValue([]);
      expect(await service.reverseLessonEntries(entityManager, LESSON_ID, TEACHER_ID, NOW)).toEqual(
        [],
      );
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });
  });
});
