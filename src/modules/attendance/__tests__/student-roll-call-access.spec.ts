import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  AssignmentRole,
  ConfirmedStaffService,
} from "@modules/assignments/services/confirmed-staff.service";
import { ClassesService } from "@modules/classes/services/classes.service";
import { LessonStatus, LessonSummary } from "@modules/lessons/services/lessons.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import {
  rollCallTargetOf,
  studentRollCallLockKey,
  StudentRollCallAccess,
} from "../services/student-roll-call-access";

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

const TEACHER_ID = "01999a3e-0000-7000-8000-0000000000b1";
const MONITOR_ID = "01999a3e-0000-7000-8000-0000000000b2";
const OTHER_MONITOR_ID = "01999a3e-0000-7000-8000-0000000000b3";

const STAFF = [
  { id: "a1", personId: TEACHER_ID, role: AssignmentRole.TEACHER },
  { id: "a2", personId: MONITOR_ID, role: AssignmentRole.MONITOR },
  { id: "a3", personId: OTHER_MONITOR_ID, role: AssignmentRole.MONITOR },
];

const MEMBER: AuthUser = { id: MONITOR_ID, role: Role.MEMBER, accessEnabled: true };

describe("StudentRollCallAccess", () => {
  let access: StudentRollCallAccess;
  let order: string[];

  const manager = { query: jest.fn() };
  const classes = { getClassSummary: jest.fn() };
  const confirmedStaff = { findConfirmedAssignments: jest.fn() };
  const policy = { assertCan: jest.fn(), can: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];
    classes.getClassSummary.mockImplementation(async () => {
      order.push("lock-class");
      return { id: LESSON.classId, archivedAt: null };
    });
    manager.query.mockImplementation(async () => {
      order.push("advisory-lock");
      return [];
    });
    confirmedStaff.findConfirmedAssignments.mockResolvedValue(STAFF);
    policy.can.mockReturnValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentRollCallAccess,
        { provide: ClassesService, useValue: classes },
        { provide: ConfirmedStaffService, useValue: confirmedStaff },
        { provide: PermissionPolicy, useValue: policy },
      ],
    }).compile();

    access = moduleRef.get(StudentRollCallAccess);
  });

  it("locks the class FOR SHARE, answers 409 CLASS_ARCHIVED, then takes the advisory lock attendance.students:<lesson>", async () => {
    await access.lockClassAndRollCall(manager as never, LESSON);

    expect(classes.getClassSummary).toHaveBeenCalledWith(LESSON.classId, manager, {
      forShare: true,
    });
    expect(manager.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `attendance.students:${LESSON.id}`,
    ]);
    expect(order).toEqual(["lock-class", "advisory-lock"]);
    expect(studentRollCallLockKey(LESSON.id)).toBe(`attendance.students:${LESSON.id}`);

    classes.getClassSummary.mockResolvedValue({ id: LESSON.classId, archivedAt: new Date() });
    manager.query.mockClear();
    const failure = await access.lockClassAndRollCall(manager as never, LESSON).catch((e) => e);
    expect(failure).toBeInstanceOf(HttpException);
    expect(failure.getStatus()).toBe(409);
    expect(failure.getResponse()).toEqual({
      error: "CLASS_ARCHIVED",
      message: "Archived classes are read-only.",
    });
    expect(manager.query).not.toHaveBeenCalled();
  });

  it("throws when the class of a lesson is missing", async () => {
    classes.getClassSummary.mockResolvedValue(null);

    await expect(access.lockClassAndRollCall(manager as never, LESSON)).rejects.toThrow(
      "the foreign key requires it",
    );
    expect(manager.query).not.toHaveBeenCalled();
  });

  it("builds lessonTeacherIds and lessonMonitorIds from the confirmed assignments", () => {
    expect(rollCallTargetOf(STAFF)).toEqual({
      lessonTeacherIds: [TEACHER_ID],
      lessonMonitorIds: [MONITOR_ID, OTHER_MONITOR_ID],
    });
    expect(rollCallTargetOf([])).toEqual({ lessonTeacherIds: [], lessonMonitorIds: [] });
    expect(() =>
      rollCallTargetOf([{ id: "a4", personId: TEACHER_ID, role: "director" as AssignmentRole }]),
    ).toThrow("Unknown assignment role");
  });

  it("reads the assignments FOR SHARE with the manager in assertCanTake and without a lock in canTake", async () => {
    const target = {
      lessonTeacherIds: [TEACHER_ID],
      lessonMonitorIds: [MONITOR_ID, OTHER_MONITOR_ID],
    };

    await access.assertCanTake(MEMBER, LESSON.id, manager as never);
    expect(confirmedStaff.findConfirmedAssignments).toHaveBeenCalledWith(LESSON.id, manager, {
      forShare: true,
    });
    expect(policy.assertCan).toHaveBeenCalledWith(
      MEMBER,
      Permission.ATTENDANCE_TAKE_STUDENTS,
      target,
    );

    confirmedStaff.findConfirmedAssignments.mockClear();
    policy.can.mockReturnValue(false);
    await expect(access.canTake(MEMBER, LESSON.id)).resolves.toBe(false);
    expect(confirmedStaff.findConfirmedAssignments).toHaveBeenCalledWith(LESSON.id);
    expect(policy.can).toHaveBeenCalledWith(MEMBER, Permission.ATTENDANCE_TAKE_STUDENTS, target);
  });
});
