import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import {
  AssignmentRole,
  ConfirmedAssignment,
  ConfirmedStaffService,
} from "@modules/assignments/services/confirmed-staff.service";
import { ClassesService } from "@modules/classes/services/classes.service";
import {
  LessonsService,
  LessonStatus,
  LessonSummary,
} from "@modules/lessons/services/lessons.service";
import { PeopleService } from "@modules/people/services/people.service";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { AttendanceCorrection } from "../entities/attendance-correction.entity";
import { StudentAttendance } from "../entities/student-attendance.entity";
import { AbsenceJustificationReason } from "../enums/absence-justification-reason.enum";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";
import { StudentAttendanceRecordsService } from "../services/student-attendance-records.service";
import { StudentRollCallAccess } from "../services/student-roll-call-access";

const NOW = new Date("2026-03-10T18:00:00.000Z");
const SIGNED_AT = new Date("2026-03-10T14:05:00.000Z");
const EARLIER = new Date("2026-03-10T15:00:00.000Z");

const PRESENT = StudentAttendanceStatus.PRESENT;
const ABSENT = StudentAttendanceStatus.ABSENT;
const HEALTH = AbsenceJustificationReason.HEALTH;
const OTHER = AbsenceJustificationReason.OTHER;

function actorOf(id: string, role: Role): AuthUser {
  return { id, role, accessEnabled: true, departmentIds: [] };
}

const MONITOR = actorOf("01999a3e-0000-7000-8000-0000000000b2", Role.MEMBER);
const OUTSIDER = actorOf("01999a3e-0000-7000-8000-0000000000b3", Role.MEMBER);
const COORDINATOR = actorOf("01999a3e-0000-7000-8000-0000000000b5", Role.COORDINATOR);

const LESSON: LessonSummary = {
  id: "01999a3e-7c1b-7000-8000-0000000000f1",
  classId: "01999a3e-7c1b-7000-8000-0000000000c1",
  title: "Teclado, mouse e janelas",
  date: "2026-03-10",
  startTime: "09:00",
  endTime: "11:00",
  status: LessonStatus.PLANNED,
  expectedMonitors: 1,
};

const STAFF: ConfirmedAssignment[] = [
  {
    id: "01999a3e-7c1b-7000-8000-0000000000a2",
    personId: MONITOR.id,
    role: AssignmentRole.MONITOR,
  },
];

const ROW_ID = "01999a3e-7c1b-7000-8000-000000000a01";
const CORRECTION_ID = "01999a3e-7c1b-7000-8000-000000000c01";

function rowOf(values: Partial<StudentAttendance> = {}): StudentAttendance {
  return Object.assign(new StudentAttendance(), {
    id: ROW_ID,
    lessonId: LESSON.id,
    enrollmentId: "01999a3e-7c1b-7000-8000-000000000e01",
    status: ABSENT,
    signedById: MONITOR.id,
    signedAt: SIGNED_AT,
    justificationReason: null,
    justificationNote: null,
    justifiedById: null,
    justifiedAt: null,
    createdAt: SIGNED_AT,
    updatedAt: SIGNED_AT,
    deletedAt: null,
    ...values,
  });
}

const JUSTIFIED = {
  justificationReason: HEALTH,
  justificationNote: "Consulta médica.",
  justifiedById: MONITOR.id,
  justifiedAt: EARLIER,
};

async function httpFailure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error("Expected the promise to reject with an HttpException");
}

function codeOf(failure: HttpException): unknown {
  const body = failure.getResponse();
  return typeof body === "object" && body !== null && "error" in body ? body.error : body;
}

describe("StudentAttendanceRecordsService", () => {
  let service: StudentAttendanceRecordsService;
  let order: string[];
  let state: {
    peek: StudentAttendance | null;
    locked: StudentAttendance | null;
    after: StudentAttendance | null;
    lesson: LessonSummary | null;
    archivedAt: Date | null;
    corrections: AttendanceCorrection[];
  };

  const manager = {
    findOne: jest.fn(),
    query: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const attendanceRepository = { findOne: jest.fn() };
  const correctionRepository = { find: jest.fn() };
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  const lessons = { getLessonSummary: jest.fn() };
  const classes = { getClassSummary: jest.fn() };
  const confirmedStaff = { findConfirmedAssignments: jest.fn() };
  const people = { findRefsByIds: jest.fn() };
  const policy = new PermissionPolicy();

  function emitted(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls
      .filter((call) => call[0] === AUDITABLE_ACTION_EVENT)
      .map((call) => call[1] as AuditableActionEvent);
  }

  function nothingWritten(): void {
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.restoreAllMocks();
    order = [];
    state = {
      peek: rowOf(),
      locked: rowOf(),
      after: rowOf(),
      lesson: LESSON,
      archivedAt: null,
      corrections: [],
    };

    clock.now.mockReturnValue(NOW);
    dataSource.transaction.mockImplementation(async (work: (m: unknown) => Promise<unknown>) => {
      const result = await work(manager);
      order.push("commit");
      return result;
    });
    dataSource.getRepository.mockImplementation((target: unknown) => {
      if (target === StudentAttendance) return attendanceRepository;
      if (target === AttendanceCorrection) return correctionRepository;
      return undefined;
    });
    manager.findOne.mockImplementation(
      async (_target: unknown, options: { lock?: { mode: string } }) => {
        if (options.lock !== undefined) {
          order.push(`lock-row:${options.lock.mode}`);
          return state.locked;
        }
        order.push("peek-row");
        return state.peek;
      },
    );
    lessons.getLessonSummary.mockImplementation(async () => {
      order.push("lock-lesson");
      return state.lesson;
    });
    classes.getClassSummary.mockImplementation(async () => {
      order.push("lock-class");
      return { id: LESSON.classId, archivedAt: state.archivedAt };
    });
    manager.query.mockImplementation(async () => {
      order.push("advisory-lock");
      return [];
    });
    confirmedStaff.findConfirmedAssignments.mockImplementation(async () => {
      order.push("lock-staff");
      return STAFF;
    });
    manager.update.mockImplementation(async () => {
      order.push("update-row");
    });
    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), data),
    );
    manager.save.mockImplementation(async (_target: unknown, correction: AttendanceCorrection) => {
      order.push("insert-correction");
      return Object.assign(correction, { id: CORRECTION_ID });
    });
    attendanceRepository.findOne.mockImplementation(async () => {
      order.push("reread-row");
      return state.after;
    });
    correctionRepository.find.mockImplementation(async () => state.corrections);
    people.findRefsByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, name: `Person ${id.slice(-2)}` })),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentAttendanceRecordsService,
        StudentRollCallAccess,
        { provide: PermissionPolicy, useValue: policy },
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: LessonsService, useValue: lessons },
        { provide: ClassesService, useValue: classes },
        { provide: ConfirmedStaffService, useValue: confirmedStaff },
        { provide: PeopleService, useValue: people },
      ],
    }).compile();

    service = moduleRef.get(StudentAttendanceRecordsService);
  });

  describe("justify()", () => {
    it("answers 404 STUDENT_ATTENDANCE_NOT_FOUND for an unknown id", async () => {
      state.peek = null;

      const failure = await httpFailure(service.justify(ROW_ID, { reason: HEALTH }, MONITOR));

      expect([failure.getStatus(), codeOf(failure)]).toEqual([404, "STUDENT_ATTENDANCE_NOT_FOUND"]);
      expect(lessons.getLessonSummary).not.toHaveBeenCalled();
      nothingWritten();
    });

    it("answers 409 LESSON_CANCELLED and then 409 CLASS_ARCHIVED", async () => {
      state.lesson = { ...LESSON, status: LessonStatus.CANCELLED };
      state.archivedAt = NOW;
      const cancelled = await httpFailure(service.justify(ROW_ID, { reason: HEALTH }, MONITOR));
      expect([cancelled.getStatus(), codeOf(cancelled)]).toEqual([409, "LESSON_CANCELLED"]);
      expect(classes.getClassSummary).not.toHaveBeenCalled();

      state.lesson = LESSON;
      const archived = await httpFailure(service.justify(ROW_ID, { reason: HEALTH }, MONITOR));
      expect([archived.getStatus(), codeOf(archived)]).toEqual([409, "CLASS_ARCHIVED"]);
      expect(confirmedStaff.findConfirmedAssignments).not.toHaveBeenCalled();
      nothingWritten();
    });

    it("throws for an attendance whose lesson is gone, a broken foreign key", async () => {
      state.lesson = null;

      await expect(service.justify(ROW_ID, { reason: HEALTH }, MONITOR)).rejects.toThrow(
        "the foreign key requires it",
      );
    });

    it("answers 403 FORBIDDEN_SCOPE to a member not allocated in the lesson", async () => {
      const failure = await httpFailure(service.justify(ROW_ID, { reason: HEALTH }, OUTSIDER));

      expect([failure.getStatus(), codeOf(failure)]).toEqual([403, "FORBIDDEN_SCOPE"]);
      expect(order).not.toContain("lock-row:pessimistic_write");
      nothingWritten();
    });

    it("answers 409 STUDENT_ATTENDANCE_NOT_ABSENT for a presence", async () => {
      state.locked = rowOf({ status: PRESENT });

      const failure = await httpFailure(service.justify(ROW_ID, { reason: HEALTH }, MONITOR));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_ATTENDANCE_NOT_ABSENT",
        message: "Only an absence can be justified.",
      });
      nothingWritten();
    });

    it("locks the record FOR UPDATE after the advisory lock of the roll call", async () => {
      await service.justify(ROW_ID.toUpperCase(), { reason: HEALTH }, MONITOR);

      expect(order).toEqual([
        "peek-row",
        "lock-lesson",
        "lock-class",
        "advisory-lock",
        "lock-staff",
        "lock-row:pessimistic_write",
        "update-row",
        "commit",
        "reread-row",
      ]);
      expect(lessons.getLessonSummary).toHaveBeenCalledWith(LESSON.id, manager, {
        forShare: true,
      });
      expect(manager.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `attendance.students:${LESSON.id}`,
      ]);
      expect(confirmedStaff.findConfirmedAssignments).toHaveBeenCalledWith(LESSON.id, manager, {
        forShare: true,
      });
      // Looked up by the id of the database, not by the one of the URL.
      expect(manager.findOne).toHaveBeenLastCalledWith(StudentAttendance, {
        where: { id: ROW_ID },
        lock: { mode: "pessimistic_write" },
      });
    });

    it("writes reason, note, who and when, keeps the absence and emits STUDENT_ABSENCE_JUSTIFIED with changedFields and no text", async () => {
      state.after = rowOf({
        justificationReason: HEALTH,
        justificationNote: "Consulta médica.",
        justifiedById: MONITOR.id,
        justifiedAt: NOW,
        updatedAt: NOW,
      });

      const response = await service.justify(
        ROW_ID,
        { reason: HEALTH, note: "Consulta médica." },
        MONITOR,
      );

      expect(manager.update).toHaveBeenCalledWith(
        StudentAttendance,
        { id: ROW_ID },
        {
          justificationReason: HEALTH,
          justificationNote: "Consulta médica.",
          justifiedById: MONITOR.id,
          justifiedAt: NOW,
          updatedAt: NOW,
        },
      );
      expect(JSON.stringify(manager.update.mock.calls[0][2])).not.toContain("status");
      const [event] = emitted();
      expect(event.action).toBe(AuditableAction.STUDENT_ABSENCE_JUSTIFIED);
      expect(event.targetType).toBe("student_attendance");
      expect(event.targetId).toBe(ROW_ID);
      expect(event.actorId).toBe(MONITOR.id);
      expect(event.before).toEqual({ justified: false });
      expect(event.after).toEqual({
        justified: true,
        justifiedAt: NOW,
        changedFields: ["justificationReason", "justificationNote"],
      });
      expect(event.occurredAt).toBe(NOW);
      expect(JSON.stringify(event)).not.toMatch(/health|Consulta/);
      expect(response).toMatchObject({
        id: ROW_ID,
        status: ABSENT,
        justified: true,
        justification: { reason: HEALTH, note: "Consulta médica.", justifiedAt: NOW },
      });
    });

    it("replaces a previous justification", async () => {
      state.locked = rowOf(JUSTIFIED);

      await service.justify(ROW_ID, { reason: OTHER, note: "Consulta médica." }, COORDINATOR);

      expect(manager.update).toHaveBeenCalledWith(
        StudentAttendance,
        { id: ROW_ID },
        expect.objectContaining({
          justificationReason: OTHER,
          justificationNote: "Consulta médica.",
          justifiedById: COORDINATOR.id,
          justifiedAt: NOW,
        }),
      );
      const [event] = emitted();
      expect(event.before).toEqual({ justified: true });
      expect(event.after.changedFields).toEqual(["justificationReason"]);

      manager.update.mockClear();
      eventEmitter.emit.mockClear();
      await service.justify(ROW_ID, { reason: HEALTH }, COORDINATOR);
      expect(manager.update).toHaveBeenCalledWith(
        StudentAttendance,
        { id: ROW_ID },
        expect.objectContaining({ justificationReason: HEALTH, justificationNote: null }),
      );
      expect(emitted()[0].after.changedFields).toEqual(["justificationNote"]);
    });

    it("is a no-op for the same reason and note", async () => {
      state.locked = rowOf(JUSTIFIED);
      state.after = rowOf(JUSTIFIED);

      const response = await service.justify(
        ROW_ID,
        { reason: HEALTH, note: "Consulta médica." },
        COORDINATOR,
      );

      nothingWritten();
      expect(response.justification?.justifiedAt).toEqual(EARLIER);

      state.locked = rowOf({ ...JUSTIFIED, justificationNote: null });
      await service.justify(ROW_ID, { reason: HEALTH }, COORDINATOR);
      nothingWritten();
    });
  });

  describe("correct()", () => {
    it("answers 404, then 409 LESSON_CANCELLED, then 409 CLASS_ARCHIVED", async () => {
      state.peek = null;
      const missing = await httpFailure(
        service.correct(ROW_ID, { status: PRESENT, reason: "Engano." }, COORDINATOR),
      );
      expect([missing.getStatus(), codeOf(missing)]).toEqual([404, "STUDENT_ATTENDANCE_NOT_FOUND"]);

      state.peek = rowOf();
      state.lesson = { ...LESSON, status: LessonStatus.CANCELLED };
      state.archivedAt = NOW;
      const cancelled = await httpFailure(
        service.correct(ROW_ID, { status: PRESENT, reason: "Engano." }, COORDINATOR),
      );
      expect([cancelled.getStatus(), codeOf(cancelled)]).toEqual([409, "LESSON_CANCELLED"]);

      state.lesson = LESSON;
      const archived = await httpFailure(
        service.correct(ROW_ID, { status: PRESENT, reason: "Engano." }, COORDINATOR),
      );
      expect([archived.getStatus(), codeOf(archived)]).toEqual([409, "CLASS_ARCHIVED"]);
      nothingWritten();
    });

    it("answers 400 STUDENT_ATTENDANCE_STATUS_UNCHANGED with details on status for the status the record already has, and writes nothing", async () => {
      const failure = await httpFailure(
        service.correct(ROW_ID, { status: ABSENT, reason: "Engano." }, COORDINATOR),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_ATTENDANCE_STATUS_UNCHANGED",
        message: "The attendance already has this status.",
        details: [{ field: "status", message: "must differ from the current status" }],
      });
      expect(order).toContain("lock-row:pessimistic_write");
      nothingWritten();
    });

    it("writes one correction with from, to, reason, who and the instant, and updates the status", async () => {
      state.locked = rowOf({ status: PRESENT });
      state.after = rowOf({ status: ABSENT, updatedAt: NOW });
      state.corrections = [
        Object.assign(new AttendanceCorrection(), {
          id: CORRECTION_ID,
          studentAttendanceId: ROW_ID,
          fromStatus: PRESENT,
          toStatus: ABSENT,
          reason: "Saiu antes do início.",
          correctedById: COORDINATOR.id,
          createdAt: NOW,
        }),
      ];

      const response = await service.correct(
        ROW_ID,
        { status: ABSENT, reason: "Saiu antes do início." },
        COORDINATOR,
      );

      expect(order).toEqual([
        "peek-row",
        "lock-lesson",
        "lock-class",
        "advisory-lock",
        "lock-row:pessimistic_write",
        "insert-correction",
        "update-row",
        "commit",
        "reread-row",
      ]);
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.save.mock.calls[0][0]).toBe(AttendanceCorrection);
      expect(manager.save.mock.calls[0][1]).toMatchObject({
        studentAttendanceId: ROW_ID,
        fromStatus: PRESENT,
        toStatus: ABSENT,
        reason: "Saiu antes do início.",
        correctedById: COORDINATOR.id,
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(manager.update).toHaveBeenCalledWith(
        StudentAttendance,
        { id: ROW_ID },
        { status: ABSENT, updatedAt: NOW },
      );
      expect(correctionRepository.find).toHaveBeenCalledWith({
        where: { studentAttendanceId: ROW_ID },
        order: { createdAt: "ASC", id: "ASC" },
      });
      expect(response.corrections).toEqual([
        {
          id: CORRECTION_ID,
          fromStatus: PRESENT,
          toStatus: ABSENT,
          reason: "Saiu antes do início.",
          correctedBy: { id: COORDINATOR.id, name: `Person ${COORDINATOR.id.slice(-2)}` },
          correctedAt: NOW,
        },
      ]);
    });

    it("clears the justification when an absence is corrected to present, and says so in the event without the text", async () => {
      state.locked = rowOf(JUSTIFIED);

      await service.correct(ROW_ID, { status: PRESENT, reason: "Chegou atrasado." }, COORDINATOR);

      expect(manager.update).toHaveBeenCalledWith(
        StudentAttendance,
        { id: ROW_ID },
        {
          status: PRESENT,
          updatedAt: NOW,
          justificationReason: null,
          justificationNote: null,
          justifiedById: null,
          justifiedAt: null,
        },
      );
      const [event] = emitted();
      expect(event.before).toEqual({ status: ABSENT, justified: true });
      expect(event.after).toEqual({
        status: PRESENT,
        justified: false,
        correctionId: CORRECTION_ID,
        correctedAt: NOW,
      });
      expect(JSON.stringify(event)).not.toMatch(/health|Consulta|atrasado/);
    });

    it("keeps signedBy and signedAt of the original signature", async () => {
      state.locked = rowOf({ status: PRESENT });

      await service.correct(ROW_ID, { status: ABSENT, reason: "Engano." }, COORDINATOR);

      const values = manager.update.mock.calls[0][2] as Record<string, unknown>;
      expect(values).not.toHaveProperty("signedById");
      expect(values).not.toHaveProperty("signedAt");
    });

    it("emits STUDENT_ATTENDANCE_CORRECTED without the reason", async () => {
      eventEmitter.emit.mockImplementation(() => {
        order.push("emit");
        return true;
      });
      state.locked = rowOf({ status: PRESENT });

      await service.correct(ROW_ID, { status: ABSENT, reason: "Problema de saúde." }, COORDINATOR);

      expect(order.indexOf("emit")).toBeGreaterThan(order.indexOf("commit"));
      const [event] = emitted();
      expect(event.action).toBe(AuditableAction.STUDENT_ATTENDANCE_CORRECTED);
      expect(event.actorId).toBe(COORDINATOR.id);
      expect(event.before).toEqual({ status: PRESENT, justified: false });
      expect(event.after).toEqual({
        status: ABSENT,
        justified: false,
        correctionId: CORRECTION_ID,
        correctedAt: NOW,
      });
      expect(JSON.stringify(event)).not.toContain("saúde");
    });

    it("does not ask the policy: attendance.correct is all or none", async () => {
      const assertCan = jest.spyOn(policy, "assertCan");
      const can = jest.spyOn(policy, "can");
      state.locked = rowOf({ status: PRESENT });

      await service.correct(ROW_ID, { status: ABSENT, reason: "Engano." }, COORDINATOR);

      expect(assertCan).not.toHaveBeenCalled();
      expect(can).not.toHaveBeenCalled();
      expect(confirmedStaff.findConfirmedAssignments).not.toHaveBeenCalled();
    });

    it("throws when the attendance is gone under the lock, instead of answering", async () => {
      state.locked = null;

      await expect(
        service.correct(ROW_ID, { status: PRESENT, reason: "Engano." }, COORDINATOR),
      ).rejects.toThrow("is gone under the lock");
      state.locked = rowOf({ status: PRESENT });
      state.after = null;
      await expect(
        service.correct(ROW_ID, { status: ABSENT, reason: "Engano." }, COORDINATOR),
      ).rejects.toThrow("was written and is not there");
    });
  });
});
