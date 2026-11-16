import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, In } from "typeorm";
import {
  AssignmentRole,
  ConfirmedAssignment,
  ConfirmedStaffService,
} from "@modules/assignments/services/confirmed-staff.service";
import { LessonHoursService } from "@modules/hours/services/lesson-hours.service";
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
import { MemberAttendance } from "../entities/member-attendance.entity";
import { MemberAttendanceStatus } from "../enums/member-attendance-status.enum";
import { MemberAttendanceService } from "../services/member-attendance.service";

/** 22:30 of 2026-03-10 in America/Sao_Paulo, when the UTC date is already 2026-03-11. */
const NOW = new Date("2026-03-11T01:30:00.000Z");
const EARLIER = new Date("2026-03-10T18:30:00.000Z");

const PRESENT = MemberAttendanceStatus.PRESENT;
const ABSENT = MemberAttendanceStatus.ABSENT;

function member(id: string, role: Role): AuthUser {
  return { id, role, accessEnabled: true, departmentIds: [] };
}

const TEACHER = member("01999a3e-0000-7000-8000-0000000000b1", Role.MEMBER);
const MONITOR = member("01999a3e-0000-7000-8000-0000000000b2", Role.MEMBER);
const OTHER_MONITOR = member("01999a3e-0000-7000-8000-0000000000b3", Role.MEMBER);
const DIRECTOR = member("01999a3e-0000-7000-8000-0000000000b4", Role.DIRECTOR);
const COORDINATOR = member("01999a3e-0000-7000-8000-0000000000b5", Role.COORDINATOR);
const SUPERADMIN = member("01999a3e-0000-7000-8000-0000000000b6", Role.SUPERADMIN);

const LESSON: LessonSummary = {
  id: "01999a3e-7c1b-7000-8000-0000000000f1",
  classId: "01999a3e-7c1b-7000-8000-0000000000c1",
  title: "Teclado, mouse e janelas",
  date: "2026-03-10",
  startTime: "14:00",
  endTime: "15:30",
  status: LessonStatus.PLANNED,
  expectedMonitors: 2,
};

function assignmentOf(id: string, person: AuthUser, role: AssignmentRole): ConfirmedAssignment {
  return { id, personId: person.id, role };
}

const TEACHER_ASSIGNMENT = assignmentOf(
  "01999a3e-7c1b-7000-8000-0000000000a1",
  TEACHER,
  AssignmentRole.TEACHER,
);
const MONITOR_ASSIGNMENT = assignmentOf(
  "01999a3e-7c1b-7000-8000-0000000000a2",
  MONITOR,
  AssignmentRole.MONITOR,
);
const OTHER_MONITOR_ASSIGNMENT = assignmentOf(
  "01999a3e-7c1b-7000-8000-0000000000a3",
  OTHER_MONITOR,
  AssignmentRole.MONITOR,
);
const STAFF = [TEACHER_ASSIGNMENT, MONITOR_ASSIGNMENT, OTHER_MONITOR_ASSIGNMENT];

const OLD_ENTRY = "01999a3e-7c1b-7000-8000-000000000e01";
const NEW_ENTRY = "01999a3e-7c1b-7000-8000-000000000e02";

function signedRow(person: AuthUser, values: Partial<MemberAttendance> = {}): MemberAttendance {
  return Object.assign(new MemberAttendance(), {
    id: `01999a3e-7c1b-7000-8000-0000000d${person.id.slice(-4)}`,
    assignmentId: MONITOR_ASSIGNMENT.id,
    lessonId: LESSON.id,
    personId: person.id,
    status: PRESENT,
    confirmedById: TEACHER.id,
    confirmedAt: EARLIER,
    hourEntryId: OLD_ENTRY,
    ...values,
  });
}

function entry(assignment: ConfirmedAssignment, status: MemberAttendanceStatus) {
  return { assignmentId: assignment.id, status };
}

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

describe("MemberAttendanceService", () => {
  let service: MemberAttendanceService;
  let order: string[];

  const manager = {
    query: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const attendanceRepository = { find: jest.fn() };
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  const lessons = { getLessonSummary: jest.fn() };
  const confirmedStaff = { findConfirmedAssignments: jest.fn() };
  const lessonHours = { recordPresence: jest.fn(), reverseEntries: jest.fn() };
  const people = { findRefsByIds: jest.fn() };

  const hoursAudit = (label: string): AuditableActionEvent =>
    Object.assign(new AuditableActionEvent(), { action: label });

  function emitted(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls
      .filter((call) => call[0] === AUDITABLE_ACTION_EVENT)
      .map((call) => call[1] as AuditableActionEvent);
  }

  function insertedRows(): MemberAttendance[] {
    return manager.save.mock.calls.flatMap((call) => call[1] as MemberAttendance[]);
  }

  function nothingWritten(): void {
    expect(lessonHours.reverseEntries).not.toHaveBeenCalled();
    expect(lessonHours.recordPresence).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];

    clock.now.mockReturnValue(NOW);
    dataSource.transaction.mockImplementation(async (work: (m: unknown) => Promise<unknown>) => {
      const result = await work(manager);
      order.push("commit");
      return result;
    });
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === MemberAttendance ? attendanceRepository : undefined,
    );
    lessons.getLessonSummary.mockImplementation(async (id: string, transaction?: unknown) => {
      order.push(transaction === undefined ? "read-lesson" : "lock-lesson");
      return id.toLowerCase() === LESSON.id ? LESSON : null;
    });
    manager.query.mockImplementation(async () => {
      order.push("advisory-lock");
      return [];
    });
    confirmedStaff.findConfirmedAssignments.mockImplementation(
      async (_lessonId: string, transaction?: unknown) => {
        order.push(transaction === undefined ? "read-staff" : "lock-staff");
        return STAFF;
      },
    );
    manager.find.mockImplementation(async () => {
      order.push("read-attendance");
      return [];
    });
    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), data),
    );
    manager.save.mockImplementation(async (_target: unknown, rows: MemberAttendance[]) => {
      order.push("insert-attendance");
      return rows.map((row, index) =>
        Object.assign(row, { id: `01999a3e-7c1b-7000-8000-00000000000${index}` }),
      );
    });
    manager.update.mockImplementation(async () => {
      order.push("update-attendance");
    });
    lessonHours.reverseEntries.mockImplementation(async (_m: unknown, ids: string[]) => {
      if (ids.length > 0) order.push("reverse");
      return ids.map(() => hoursAudit("HOUR_ENTRY_REVERSED"));
    });
    lessonHours.recordPresence.mockImplementation(async () => {
      order.push("record-hours");
      return { hourEntryId: NEW_ENTRY, auditEvents: [hoursAudit("HOUR_ENTRY_CREATED")] };
    });
    attendanceRepository.find.mockResolvedValue([]);
    people.findRefsByIds.mockImplementation(async (ids: string[]) =>
      [...new Set(ids)].map((id) => ({ id, name: `Person ${id.slice(-2)}` })),
    );
    eventEmitter.emit.mockImplementation(() => {
      order.push("emit-audit");
      return true;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        MemberAttendanceService,
        PermissionPolicy,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: LessonsService, useValue: lessons },
        { provide: ConfirmedStaffService, useValue: confirmedStaff },
        { provide: LessonHoursService, useValue: lessonHours },
        { provide: PeopleService, useValue: people },
      ],
    }).compile();
    service = moduleRef.get(MemberAttendanceService);
  });

  describe("confirm", () => {
    it("answers 400 DUPLICATE_ASSIGNMENT with the positions of the repeats, in any letter case, before opening the transaction", async () => {
      const failure = await httpFailure(
        service.confirm(
          LESSON.id,
          {
            entries: [
              entry(MONITOR_ASSIGNMENT, PRESENT),
              entry(TEACHER_ASSIGNMENT, PRESENT),
              { assignmentId: MONITOR_ASSIGNMENT.id.toUpperCase(), status: ABSENT },
            ],
          },
          COORDINATOR,
        ),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({
        error: "DUPLICATE_ASSIGNMENT",
        details: [{ field: "entries.2.assignmentId" }],
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("answers 404 LESSON_NOT_FOUND when the lesson does not exist", async () => {
      const failure = await httpFailure(
        service.confirm(
          "01999a3e-7c1b-7000-8000-0000000000ff",
          { entries: [entry(MONITOR_ASSIGNMENT, PRESENT)] },
          COORDINATOR,
        ),
      );

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("LESSON_NOT_FOUND");
      nothingWritten();
    });

    it("answers 409 LESSON_CANCELLED for a cancelled lesson, before the advisory lock and the assignments", async () => {
      lessons.getLessonSummary.mockResolvedValue({ ...LESSON, status: LessonStatus.CANCELLED });

      const failure = await httpFailure(
        service.confirm(LESSON.id, { entries: [entry(MONITOR_ASSIGNMENT, PRESENT)] }, COORDINATOR),
      );

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("LESSON_CANCELLED");
      expect(manager.query).not.toHaveBeenCalled();
      expect(confirmedStaff.findConfirmedAssignments).not.toHaveBeenCalled();
    });

    it("answers 409 LESSON_IN_FUTURE for a lesson after today in America/Sao_Paulo, and accepts a lesson of today", async () => {
      lessons.getLessonSummary.mockResolvedValue({ ...LESSON, date: "2026-03-11" });

      const failure = await httpFailure(
        service.confirm(LESSON.id, { entries: [entry(MONITOR_ASSIGNMENT, ABSENT)] }, COORDINATOR),
      );
      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("LESSON_IN_FUTURE");
      expect(manager.query).not.toHaveBeenCalled();
      nothingWritten();

      // 2026-03-10 is today in America/Sao_Paulo, although the UTC date is already 2026-03-11.
      lessons.getLessonSummary.mockResolvedValue(LESSON);
      await service.confirm(
        LESSON.id,
        { entries: [entry(MONITOR_ASSIGNMENT, ABSENT)] },
        COORDINATOR,
      );
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it("locks the lesson FOR SHARE, then the advisory lock of the lesson, then the confirmed assignments FOR SHARE", async () => {
      await service.confirm(
        LESSON.id.toUpperCase(),
        { entries: [entry(MONITOR_ASSIGNMENT, PRESENT)] },
        COORDINATOR,
      );

      expect(order.slice(0, 4)).toEqual([
        "lock-lesson",
        "advisory-lock",
        "lock-staff",
        "read-attendance",
      ]);
      expect(lessons.getLessonSummary).toHaveBeenNthCalledWith(
        1,
        LESSON.id.toUpperCase(),
        manager,
        {
          forShare: true,
        },
      );
      expect(manager.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `attendance.members:${LESSON.id}`,
      ]);
      expect(confirmedStaff.findConfirmedAssignments).toHaveBeenNthCalledWith(
        1,
        LESSON.id,
        manager,
        { forShare: true },
      );
    });

    it("answers 400 ASSIGNMENT_NOT_CONFIRMED with the positions of the assignments that are not confirmed in this lesson, and writes nothing", async () => {
      const failure = await httpFailure(
        service.confirm(
          LESSON.id,
          {
            entries: [
              { assignmentId: "01999a3e-7c1b-7000-8000-0000000000a9", status: PRESENT },
              entry(MONITOR_ASSIGNMENT, PRESENT),
              { assignmentId: "01999a3e-7c1b-7000-8000-0000000000a8", status: ABSENT },
            ],
          },
          COORDINATOR,
        ),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({
        error: "ASSIGNMENT_NOT_CONFIRMED",
        details: [{ field: "entries.0.assignmentId" }, { field: "entries.2.assignmentId" }],
      });
      nothingWritten();
    });

    it("answers 403 SELF_ATTENDANCE_NOT_ALLOWED when an entry is the actor's own presence, for a member teacher, a coordinator and the superadmin", async () => {
      for (const actor of [TEACHER, COORDINATOR, SUPERADMIN]) {
        const ownAssignment = assignmentOf(
          "01999a3e-7c1b-7000-8000-0000000000a7",
          actor,
          AssignmentRole.MONITOR,
        );
        confirmedStaff.findConfirmedAssignments.mockResolvedValue([
          TEACHER_ASSIGNMENT,
          MONITOR_ASSIGNMENT,
          ...(actor === TEACHER ? [] : [ownAssignment]),
        ]);
        const own = actor === TEACHER ? TEACHER_ASSIGNMENT : ownAssignment;

        const failure = await httpFailure(
          service.confirm(
            LESSON.id,
            { entries: [entry(MONITOR_ASSIGNMENT, PRESENT), entry(own, PRESENT)] },
            actor,
          ),
        );

        expect(failure.getStatus()).toBe(403);
        expect(codeOf(failure)).toBe("SELF_ATTENDANCE_NOT_ALLOWED");
        expect(failure.getResponse()).not.toHaveProperty("details");
      }
      nothingWritten();
    });

    it("lets the confirmed teacher, a member, sign the presence of a monitor, with lessonTeacherIds from the confirmed teacher", async () => {
      await service.confirm(LESSON.id, { entries: [entry(MONITOR_ASSIGNMENT, PRESENT)] }, TEACHER);

      expect(insertedRows()).toEqual([
        expect.objectContaining({ personId: MONITOR.id, confirmedById: TEACHER.id }),
      ]);
    });

    it("answers 403 FORBIDDEN_SCOPE to a member who is not the confirmed teacher of the lesson", async () => {
      const failure = await httpFailure(
        service.confirm(
          LESSON.id,
          { entries: [entry(OTHER_MONITOR_ASSIGNMENT, PRESENT)] },
          MONITOR,
        ),
      );

      expect(failure.getStatus()).toBe(403);
      expect(codeOf(failure)).toBe("FORBIDDEN_SCOPE");
      nothingWritten();
    });

    it("records the lesson hours of a first presence through LessonHoursService.recordPresence with the lesson, the actor and the instant, and links the entry to the row", async () => {
      await service.confirm(LESSON.id, { entries: [entry(MONITOR_ASSIGNMENT, PRESENT)] }, TEACHER);

      expect(lessonHours.recordPresence).toHaveBeenCalledWith(
        manager,
        { personId: MONITOR.id, confirmedById: TEACHER.id, lesson: LESSON },
        NOW,
      );
      expect(insertedRows()).toEqual([
        expect.objectContaining({
          assignmentId: MONITOR_ASSIGNMENT.id,
          lessonId: LESSON.id,
          personId: MONITOR.id,
          status: PRESENT,
          confirmedById: TEACHER.id,
          confirmedAt: NOW,
          hourEntryId: NEW_ENTRY,
        }),
      ]);
    });

    it("signs a first absence without hours", async () => {
      await service.confirm(LESSON.id, { entries: [entry(MONITOR_ASSIGNMENT, ABSENT)] }, TEACHER);

      expect(lessonHours.recordPresence).not.toHaveBeenCalled();
      expect(insertedRows()).toEqual([
        expect.objectContaining({ personId: MONITOR.id, status: ABSENT, hourEntryId: null }),
      ]);
    });

    it("is a no-op for an entry whose status is already the signed one: no write, no hours, no event", async () => {
      manager.find.mockResolvedValue([
        signedRow(MONITOR),
        signedRow(OTHER_MONITOR, { status: ABSENT, hourEntryId: null }),
      ]);

      await service.confirm(
        LESSON.id,
        {
          entries: [entry(MONITOR_ASSIGNMENT, PRESENT), entry(OTHER_MONITOR_ASSIGNMENT, ABSENT)],
        },
        TEACHER,
      );

      expect(lessonHours.reverseEntries).toHaveBeenCalledWith(manager, [], TEACHER.id, NOW);
      expect(lessonHours.recordPresence).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("answers 403 FORBIDDEN to a member who changes a signed presence, and writes nothing", async () => {
      manager.find.mockResolvedValue([signedRow(MONITOR)]);

      const failure = await httpFailure(
        service.confirm(LESSON.id, { entries: [entry(MONITOR_ASSIGNMENT, ABSENT)] }, TEACHER),
      );

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toEqual({
        error: "FORBIDDEN",
        message: "Only coordination and directors correct a signed attendance.",
      });
      nothingWritten();
    });

    it("corrects present to absent: reverses the hour entry, clears hourEntryId and stamps who corrected, when and through which assignment", async () => {
      manager.find.mockResolvedValue([
        signedRow(MONITOR, { assignmentId: "01999a3e-7c1b-7000-8000-0000000000a0" }),
      ]);

      await service.confirm(
        LESSON.id,
        { entries: [entry(MONITOR_ASSIGNMENT, ABSENT)] },
        COORDINATOR,
      );

      expect(lessonHours.reverseEntries).toHaveBeenCalledWith(
        manager,
        [OLD_ENTRY],
        COORDINATOR.id,
        NOW,
      );
      expect(lessonHours.recordPresence).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(
        MemberAttendance,
        { id: signedRow(MONITOR).id },
        {
          status: ABSENT,
          hourEntryId: null,
          confirmedById: COORDINATOR.id,
          confirmedAt: NOW,
          assignmentId: MONITOR_ASSIGNMENT.id,
          updatedAt: NOW,
        },
      );
    });

    it("corrects absent to present: records new lesson hours and links them", async () => {
      manager.find.mockResolvedValue([signedRow(MONITOR, { status: ABSENT, hourEntryId: null })]);

      await service.confirm(LESSON.id, { entries: [entry(MONITOR_ASSIGNMENT, PRESENT)] }, DIRECTOR);

      expect(lessonHours.reverseEntries).toHaveBeenCalledWith(manager, [], DIRECTOR.id, NOW);
      expect(lessonHours.recordPresence).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(
        MemberAttendance,
        { id: signedRow(MONITOR).id },
        expect.objectContaining({ status: PRESENT, hourEntryId: NEW_ENTRY }),
      );
    });

    it("finds the signed presence by the person, so a member assigned again is corrected and not signed twice", async () => {
      const previousAssignment = "01999a3e-7c1b-7000-8000-0000000000a0";
      manager.find.mockResolvedValue([signedRow(MONITOR, { assignmentId: previousAssignment })]);

      await service.confirm(
        LESSON.id,
        { entries: [entry(MONITOR_ASSIGNMENT, ABSENT)] },
        COORDINATOR,
      );

      expect(manager.find).toHaveBeenCalledWith(MemberAttendance, {
        where: { lessonId: LESSON.id, personId: In([MONITOR.id]) },
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(
        MemberAttendance,
        { id: signedRow(MONITOR).id },
        expect.objectContaining({ assignmentId: MONITOR_ASSIGNMENT.id }),
      );
    });

    it("reverses every corrected entry in one call, before recording the new hours", async () => {
      manager.find.mockResolvedValue([
        signedRow(MONITOR),
        signedRow(OTHER_MONITOR, { hourEntryId: "01999a3e-7c1b-7000-8000-000000000e03" }),
        signedRow(TEACHER, { status: ABSENT, hourEntryId: null }),
      ]);

      await service.confirm(
        LESSON.id,
        {
          entries: [
            entry(TEACHER_ASSIGNMENT, PRESENT),
            entry(MONITOR_ASSIGNMENT, ABSENT),
            entry(OTHER_MONITOR_ASSIGNMENT, ABSENT),
          ],
        },
        COORDINATOR,
      );

      expect(lessonHours.reverseEntries).toHaveBeenCalledTimes(1);
      expect(lessonHours.reverseEntries).toHaveBeenCalledWith(
        manager,
        [OLD_ENTRY, "01999a3e-7c1b-7000-8000-000000000e03"],
        COORDINATOR.id,
        NOW,
      );
      expect(order.indexOf("reverse")).toBeLessThan(order.indexOf("record-hours"));
      expect(manager.update).toHaveBeenCalledTimes(3);
    });

    it("writes nothing of the batch when one entry fails", async () => {
      const failure = await httpFailure(
        service.confirm(
          LESSON.id,
          {
            entries: [entry(MONITOR_ASSIGNMENT, PRESENT), entry(TEACHER_ASSIGNMENT, PRESENT)],
          },
          TEACHER,
        ),
      );

      expect(codeOf(failure)).toBe("SELF_ATTENDANCE_NOT_ALLOWED");
      nothingWritten();
    });

    it("emits the hours audit events, then MEMBER_ATTENDANCE_CONFIRMED and MEMBER_ATTENDANCE_CORRECTED, only after the commit, and nothing when the transaction fails", async () => {
      manager.find.mockResolvedValue([signedRow(OTHER_MONITOR)]);

      await service.confirm(
        LESSON.id,
        {
          entries: [entry(MONITOR_ASSIGNMENT, PRESENT), entry(OTHER_MONITOR_ASSIGNMENT, ABSENT)],
        },
        COORDINATOR,
      );

      const commitAt = order.indexOf("commit");
      expect(order.slice(commitAt + 1, commitAt + 5)).toEqual([
        "emit-audit",
        "emit-audit",
        "emit-audit",
        "emit-audit",
      ]);
      expect(emitted().map((event) => event.action)).toEqual([
        "HOUR_ENTRY_REVERSED",
        "HOUR_ENTRY_CREATED",
        AuditableAction.MEMBER_ATTENDANCE_CONFIRMED,
        AuditableAction.MEMBER_ATTENDANCE_CORRECTED,
      ]);
      expect(emitted()[2]).toMatchObject({
        actorId: COORDINATOR.id,
        targetType: "member_attendance",
        before: null,
        after: {
          lessonId: LESSON.id,
          personId: MONITOR.id,
          assignmentId: MONITOR_ASSIGNMENT.id,
          status: PRESENT,
          hourEntryId: NEW_ENTRY,
          confirmedAt: NOW,
        },
      });
      expect(emitted()[3]).toMatchObject({
        actorId: COORDINATOR.id,
        targetType: "member_attendance",
        targetId: signedRow(OTHER_MONITOR).id,
        before: {
          status: PRESENT,
          confirmedById: TEACHER.id,
          confirmedAt: EARLIER,
          hourEntryId: OLD_ENTRY,
        },
        after: {
          status: ABSENT,
          confirmedById: COORDINATOR.id,
          confirmedAt: NOW,
          hourEntryId: null,
          assignmentId: OTHER_MONITOR_ASSIGNMENT.id,
        },
      });

      eventEmitter.emit.mockClear();
      manager.save.mockRejectedValue(new Error("connection lost"));
      manager.find.mockResolvedValue([]);
      await expect(
        service.confirm(LESSON.id, { entries: [entry(MONITOR_ASSIGNMENT, PRESENT)] }, COORDINATOR),
      ).rejects.toThrow("connection lost");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("stamps the rows, the hours and the audit events of a call with one instant from the Clock", async () => {
      manager.find.mockResolvedValue([signedRow(OTHER_MONITOR)]);

      await service.confirm(
        LESSON.id,
        {
          entries: [entry(MONITOR_ASSIGNMENT, PRESENT), entry(OTHER_MONITOR_ASSIGNMENT, ABSENT)],
        },
        COORDINATOR,
      );

      expect(clock.now).toHaveBeenCalledTimes(1);
      expect(lessonHours.reverseEntries.mock.calls[0][3]).toBe(NOW);
      expect(lessonHours.recordPresence.mock.calls[0][2]).toBe(NOW);
      expect(insertedRows()[0]).toMatchObject({ confirmedAt: NOW, createdAt: NOW, updatedAt: NOW });
      expect(manager.update.mock.calls[0][2]).toMatchObject({ confirmedAt: NOW, updatedAt: NOW });
      for (const event of emitted().slice(2)) expect(event.occurredAt).toBe(NOW);
    });

    it("answers the attendance of the lesson read after the commit", async () => {
      attendanceRepository.find.mockImplementation(async () => {
        order.push("read-after");
        return [signedRow(MONITOR, { confirmedById: COORDINATOR.id, hourEntryId: NEW_ENTRY })];
      });

      const answer = await service.confirm(
        LESSON.id,
        { entries: [entry(MONITOR_ASSIGNMENT, PRESENT)] },
        COORDINATOR,
      );

      expect(order.indexOf("read-after")).toBeGreaterThan(order.indexOf("commit"));
      expect(confirmedStaff.findConfirmedAssignments).toHaveBeenLastCalledWith(LESSON.id);
      expect(answer.map((item) => item.assignmentId)).toEqual(STAFF.map((a) => a.id));
      expect(answer[1]).toMatchObject({ status: PRESENT, hourEntryId: NEW_ENTRY });
    });
  });

  describe("listByLesson", () => {
    it("answers 404 LESSON_NOT_FOUND for an unknown lesson", async () => {
      const failure = await httpFailure(
        service.listByLesson("01999a3e-7c1b-7000-8000-0000000000ff"),
      );

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("LESSON_NOT_FOUND");
      expect(confirmedStaff.findConfirmedAssignments).not.toHaveBeenCalled();
    });

    it("lists the confirmed assignments, the teacher first, each with its presence, who signed it and its hour entry; an unsigned one is null", async () => {
      attendanceRepository.find.mockResolvedValue([
        signedRow(MONITOR, { confirmedById: TEACHER.id, hourEntryId: OLD_ENTRY }),
      ]);

      const list = await service.listByLesson(LESSON.id.toUpperCase());

      expect(lessons.getLessonSummary).toHaveBeenCalledWith(LESSON.id.toUpperCase());
      expect(confirmedStaff.findConfirmedAssignments).toHaveBeenCalledWith(LESSON.id);
      expect(attendanceRepository.find).toHaveBeenCalledWith({
        where: { lessonId: LESSON.id, personId: In(STAFF.map((a) => a.personId)) },
      });
      expect(list).toEqual([
        {
          assignmentId: TEACHER_ASSIGNMENT.id,
          person: { id: TEACHER.id, name: `Person ${TEACHER.id.slice(-2)}` },
          role: AssignmentRole.TEACHER,
          status: null,
          confirmedBy: null,
          confirmedAt: null,
          hourEntryId: null,
        },
        {
          assignmentId: MONITOR_ASSIGNMENT.id,
          person: { id: MONITOR.id, name: `Person ${MONITOR.id.slice(-2)}` },
          role: AssignmentRole.MONITOR,
          status: PRESENT,
          confirmedBy: { id: TEACHER.id, name: `Person ${TEACHER.id.slice(-2)}` },
          confirmedAt: EARLIER,
          hourEntryId: OLD_ENTRY,
        },
        expect.objectContaining({ assignmentId: OTHER_MONITOR_ASSIGNMENT.id, status: null }),
      ]);
    });

    it("reads every name in one call to PeopleService.findRefsByIds, and answers [] without reading attendance for a lesson without confirmed staff", async () => {
      attendanceRepository.find.mockResolvedValue([
        signedRow(MONITOR, { confirmedById: COORDINATOR.id }),
      ]);

      await service.listByLesson(LESSON.id);
      expect(people.findRefsByIds).toHaveBeenCalledTimes(1);
      expect(people.findRefsByIds).toHaveBeenCalledWith([
        ...STAFF.map((a) => a.personId),
        COORDINATOR.id,
      ]);

      jest.clearAllMocks();
      confirmedStaff.findConfirmedAssignments.mockResolvedValue([]);
      expect(await service.listByLesson(LESSON.id)).toEqual([]);
      expect(attendanceRepository.find).not.toHaveBeenCalled();
      expect(people.findRefsByIds).not.toHaveBeenCalled();
    });
  });
});
