import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, In } from "typeorm";
import {
  AssignmentRole,
  ConfirmedAssignment,
  ConfirmedStaffService,
} from "@modules/assignments/services/confirmed-staff.service";
import { ClassesService } from "@modules/classes/services/classes.service";
import {
  EnrollmentRosterService,
  EnrollmentStatus,
  RosterEnrollment,
} from "@modules/classes/services/enrollment-roster.service";
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
import { StudentRollCallGuard } from "../services/student-roll-call.guard";
import { StudentRollCallService } from "../services/student-roll-call.service";

/** 22:30 of 2026-03-10 in America/Sao_Paulo, when the UTC date is already 2026-03-11. */
const NOW = new Date("2026-03-11T01:30:00.000Z");
const EARLIER = new Date("2026-03-10T14:05:00.000Z");

const PRESENT = StudentAttendanceStatus.PRESENT;
const ABSENT = StudentAttendanceStatus.ABSENT;

function actorOf(id: string, role: Role): AuthUser {
  return { id, role, accessEnabled: true, departmentIds: [] };
}

const TEACHER = actorOf("01999a3e-0000-7000-8000-0000000000b1", Role.MEMBER);
const MONITOR = actorOf("01999a3e-0000-7000-8000-0000000000b2", Role.MEMBER);
const OUTSIDER = actorOf("01999a3e-0000-7000-8000-0000000000b3", Role.MEMBER);
const DIRECTOR = actorOf("01999a3e-0000-7000-8000-0000000000b4", Role.DIRECTOR);
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
    id: "01999a3e-7c1b-7000-8000-0000000000a1",
    personId: TEACHER.id,
    role: AssignmentRole.TEACHER,
  },
  {
    id: "01999a3e-7c1b-7000-8000-0000000000a2",
    personId: MONITOR.id,
    role: AssignmentRole.MONITOR,
  },
];

const ANA = { id: "01999a3e-0000-7000-8000-000000000001", name: "Ana Souza" };
const BRUNO = { id: "01999a3e-0000-7000-8000-000000000002", name: "Bruno Lima" };
const CARLA = { id: "01999a3e-0000-7000-8000-000000000003", name: "Carla Dias" };

function rosterOf(student: { id: string }, n: number, status = EnrollmentStatus.ACTIVE) {
  const enrollment: RosterEnrollment = {
    id: `01999a3e-7c1b-7000-8000-000000000e0${n}`,
    studentId: student.id,
    status,
    statusChangedAt: "2026-03-03",
  };
  return enrollment;
}

const ANA_ENROLLMENT = rosterOf(ANA, 1);
const BRUNO_ENROLLMENT = rosterOf(BRUNO, 2);
const CARLA_ENROLLMENT = rosterOf(CARLA, 3, EnrollmentStatus.DROPPED);
const ELSEWHERE = "01999a3e-7c1b-7000-8000-000000000e09";

function signedRow(
  enrollment: RosterEnrollment,
  status: StudentAttendanceStatus,
  values: Partial<StudentAttendance> = {},
): StudentAttendance {
  return Object.assign(new StudentAttendance(), {
    id: `01999a3e-7c1b-7000-8000-00000000${enrollment.id.slice(-4)}`,
    lessonId: LESSON.id,
    enrollmentId: enrollment.id,
    status,
    signedById: MONITOR.id,
    signedAt: EARLIER,
    justificationReason: null,
    justificationNote: null,
    justifiedById: null,
    justifiedAt: null,
    createdAt: EARLIER,
    updatedAt: EARLIER,
    deletedAt: null,
    ...values,
  });
}

function entry(enrollment: { id: string }, status: StudentAttendanceStatus) {
  return { enrollmentId: enrollment.id, status };
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

describe("StudentRollCallService", () => {
  let service: StudentRollCallService;
  let order: string[];
  let state: {
    lesson: LessonSummary | null;
    archivedAt: Date | null;
    staff: ConfirmedAssignment[];
    roster: RosterEnrollment[];
    signed: StudentAttendance[];
    corrections: AttendanceCorrection[];
  };

  const manager = { query: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn() };
  const attendanceRepository = { find: jest.fn() };
  const correctionRepository = { find: jest.fn() };
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  const lessons = { getLessonSummary: jest.fn() };
  const classes = { getClassSummary: jest.fn() };
  const confirmedStaff = { findConfirmedAssignments: jest.fn() };
  const roster = { findRoster: jest.fn() };
  const people = { findRefsByIds: jest.fn() };

  function emitted(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls
      .filter((call) => call[0] === AUDITABLE_ACTION_EVENT)
      .map((call) => call[1] as AuditableActionEvent);
  }

  function insertedRows(): StudentAttendance[] {
    return manager.save.mock.calls.flatMap((call) => call[1] as StudentAttendance[]);
  }

  function nothingWritten(): void {
    expect(manager.save).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];
    state = {
      lesson: LESSON,
      archivedAt: null,
      staff: STAFF,
      roster: [ANA_ENROLLMENT, BRUNO_ENROLLMENT],
      signed: [],
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
    attendanceRepository.find.mockImplementation(async () => {
      order.push("reread-signatures");
      return state.signed;
    });
    correctionRepository.find.mockImplementation(async () => {
      order.push("read-corrections");
      return state.corrections;
    });
    lessons.getLessonSummary.mockImplementation(async (id: string, transaction?: unknown) => {
      order.push(transaction === undefined ? "read-lesson" : "lock-lesson");
      return state.lesson !== null && id.toLowerCase() === state.lesson.id ? state.lesson : null;
    });
    classes.getClassSummary.mockImplementation(async () => {
      order.push("lock-class");
      return { id: LESSON.classId, archivedAt: state.archivedAt };
    });
    manager.query.mockImplementation(async () => {
      order.push("advisory-lock");
      return [];
    });
    confirmedStaff.findConfirmedAssignments.mockImplementation(
      async (_lessonId: string, transaction?: unknown) => {
        order.push(transaction === undefined ? "read-staff" : "lock-staff");
        return state.staff;
      },
    );
    manager.find.mockImplementation(async () => {
      order.push("read-signatures");
      return state.signed;
    });
    roster.findRoster.mockImplementation(
      async (_classId: string, _date: string, _options: unknown, transaction?: unknown) => {
        order.push(transaction === undefined ? "reread-roster" : "read-roster");
        return state.roster;
      },
    );
    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), data),
    );
    manager.save.mockImplementation(async (_target: unknown, rows: StudentAttendance[]) => {
      order.push("insert");
      return rows.map((row, index) =>
        Object.assign(row, { id: `01999a3e-7c1b-7000-8000-00000000a00${index}` }),
      );
    });
    people.findRefsByIds.mockImplementation(async () =>
      [ANA, BRUNO, CARLA, TEACHER, MONITOR, COORDINATOR].map((person) => ({
        id: person.id,
        name: "name" in person ? person.name : `Person ${person.id.slice(-2)}`,
      })),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentRollCallService,
        // The real guard and the real policy: the locks and the scope are what is under test.
        StudentRollCallGuard,
        PermissionPolicy,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: LessonsService, useValue: lessons },
        { provide: ClassesService, useValue: classes },
        { provide: ConfirmedStaffService, useValue: confirmedStaff },
        { provide: EnrollmentRosterService, useValue: roster },
        { provide: PeopleService, useValue: people },
      ],
    }).compile();

    service = moduleRef.get(StudentRollCallService);
  });

  describe("list()", () => {
    it("answers 404 LESSON_NOT_FOUND for an unknown lesson", async () => {
      state.lesson = null;

      const failure = await httpFailure(service.list(LESSON.id, COORDINATOR));

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("LESSON_NOT_FOUND");
      expect(roster.findRoster).not.toHaveBeenCalled();
    });

    it("reads the roster of the day of the lesson with the enrollments of its signatures included", async () => {
      state.signed = [signedRow(CARLA_ENROLLMENT, ABSENT)];
      state.roster = [ANA_ENROLLMENT, CARLA_ENROLLMENT];

      const list = await service.list(LESSON.id.toUpperCase(), COORDINATOR);

      expect(roster.findRoster).toHaveBeenCalledWith(LESSON.classId, LESSON.date, {
        includeIds: [CARLA_ENROLLMENT.id],
      });
      expect(attendanceRepository.find).toHaveBeenCalledWith({ where: { lessonId: LESSON.id } });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(list.map((item) => [item.enrollment, item.attendance?.status ?? null])).toEqual([
        [{ id: ANA_ENROLLMENT.id, status: "active", statusChangedAt: "2026-03-03" }, null],
        [{ id: CARLA_ENROLLMENT.id, status: "dropped", statusChangedAt: "2026-03-03" }, ABSENT],
      ]);
    });

    it("asks people once for the students, the signers, the justifiers and the correctors", async () => {
      state.signed = [
        signedRow(ANA_ENROLLMENT, ABSENT, {
          signedById: MONITOR.id,
          justificationReason: AbsenceJustificationReason.HEALTH,
          justifiedById: TEACHER.id,
          justifiedAt: EARLIER,
        }),
      ];
      state.corrections = [
        Object.assign(new AttendanceCorrection(), {
          id: "01999a3e-7c1b-7000-8000-000000000c01",
          studentAttendanceId: state.signed[0].id,
          fromStatus: PRESENT,
          toStatus: ABSENT,
          reason: "Saiu antes.",
          correctedById: COORDINATOR.id,
          createdAt: EARLIER,
        }),
      ];

      await service.list(LESSON.id, COORDINATOR);

      expect(people.findRefsByIds).toHaveBeenCalledTimes(1);
      expect([...people.findRefsByIds.mock.calls[0][0]].sort()).toEqual(
        [ANA.id, BRUNO.id, MONITOR.id, TEACHER.id, COORDINATOR.id].sort(),
      );
      expect(correctionRepository.find).toHaveBeenCalledWith({
        where: { studentAttendanceId: In([state.signed[0].id]) },
        order: { createdAt: "ASC", id: "ASC" },
      });
    });

    it("hands each signature its own corrections, in the order they were read", async () => {
      state.signed = [signedRow(ANA_ENROLLMENT, PRESENT), signedRow(BRUNO_ENROLLMENT, ABSENT)];
      const correctionOf = (id: string, rowId: string, reason: string) =>
        Object.assign(new AttendanceCorrection(), {
          id,
          studentAttendanceId: rowId,
          fromStatus: ABSENT,
          toStatus: PRESENT,
          reason,
          correctedById: COORDINATOR.id,
          createdAt: EARLIER,
        });
      state.corrections = [
        correctionOf("01999a3e-7c1b-7000-8000-000000000c01", state.signed[0].id, "Primeira."),
        correctionOf("01999a3e-7c1b-7000-8000-000000000c02", state.signed[1].id, "Do Bruno."),
        correctionOf("01999a3e-7c1b-7000-8000-000000000c03", state.signed[0].id, "Segunda."),
      ];

      const [ana, bruno] = await service.list(LESSON.id, COORDINATOR);

      expect(ana.attendance?.corrections.map((correction) => correction.reason)).toEqual([
        "Primeira.",
        "Segunda.",
      ]);
      expect(bruno.attendance?.corrections.map((correction) => correction.reason)).toEqual([
        "Do Bruno.",
      ]);
    });

    it("does not query the corrections of a lesson without signatures", async () => {
      await service.list(LESSON.id, COORDINATOR);

      expect(correctionRepository.find).not.toHaveBeenCalled();
    });

    it("shows the justification and the reasons of the corrections only when the policy says the actor takes the roll call of the lesson, and keeps justified for everybody", async () => {
      state.signed = [
        signedRow(ANA_ENROLLMENT, ABSENT, {
          justificationReason: AbsenceJustificationReason.HEALTH,
          justificationNote: "Consulta médica.",
          justifiedById: MONITOR.id,
          justifiedAt: EARLIER,
        }),
      ];
      state.corrections = [
        Object.assign(new AttendanceCorrection(), {
          id: "01999a3e-7c1b-7000-8000-000000000c01",
          studentAttendanceId: state.signed[0].id,
          fromStatus: PRESENT,
          toStatus: ABSENT,
          reason: "Saiu antes.",
          correctedById: COORDINATOR.id,
          createdAt: EARLIER,
        }),
      ];

      for (const [actor, sees] of [
        [MONITOR, true],
        [TEACHER, true],
        [COORDINATOR, true],
        [DIRECTOR, true],
        [OUTSIDER, false],
      ] as const) {
        const [ana] = await service.list(LESSON.id, actor);

        expect(ana.attendance?.justified).toBe(true);
        expect(ana.attendance?.justification?.note ?? null).toBe(sees ? "Consulta médica." : null);
        expect(ana.attendance?.corrections[0].reason).toBe(sees ? "Saiu antes." : null);
      }
      // One read of the staff per request, without a lock.
      expect(confirmedStaff.findConfirmedAssignments).toHaveBeenCalledTimes(5);
      expect(confirmedStaff.findConfirmedAssignments).toHaveBeenCalledWith(LESSON.id);
    });

    it("orders by the name of the student, then by id, a removed person last", async () => {
      const gone = rosterOf({ id: "01999a3e-0000-7000-8000-0000000000ee" }, 7);
      state.roster = [gone, CARLA_ENROLLMENT, BRUNO_ENROLLMENT, ANA_ENROLLMENT];

      const list = await service.list(LESSON.id, COORDINATOR);

      expect(list.map((item) => item.student?.name ?? null)).toEqual([
        "Ana Souza",
        "Bruno Lima",
        "Carla Dias",
        null,
      ]);
    });

    it("throws instead of answering when a signature points to an enrollment the roster did not bring", async () => {
      state.signed = [signedRow(CARLA_ENROLLMENT, ABSENT)];
      state.roster = [ANA_ENROLLMENT];

      await expect(service.list(LESSON.id, COORDINATOR)).rejects.toThrow(
        "which the roll call did not bring",
      );
      expect(people.findRefsByIds).not.toHaveBeenCalled();
    });
  });

  describe("sign()", () => {
    it("refuses a repeated enrollment in any letter case with 400 DUPLICATE_ENROLLMENT and the positions, before opening a transaction", async () => {
      const failure = await httpFailure(
        service.sign(
          LESSON.id,
          {
            entries: [
              entry(ANA_ENROLLMENT, PRESENT),
              entry(BRUNO_ENROLLMENT, PRESENT),
              { enrollmentId: ANA_ENROLLMENT.id.toUpperCase(), status: ABSENT },
            ],
          },
          MONITOR,
        ),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "DUPLICATE_ENROLLMENT",
        message: "The same enrollment appears more than once.",
        details: [
          { field: "entries.2.enrollmentId", message: "enrollment appears more than once" },
        ],
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("locks the lesson FOR SHARE, then the class FOR SHARE, then the advisory lock of the roll call, then the confirmed assignments FOR SHARE", async () => {
      await service.sign(LESSON.id, { entries: [entry(ANA_ENROLLMENT, PRESENT)] }, MONITOR);

      expect(order).toEqual([
        "lock-lesson",
        "lock-class",
        "advisory-lock",
        "lock-staff",
        "read-signatures",
        "read-roster",
        "insert",
        "commit",
        // The answer is read after the commit; no signature read back, so no corrections asked.
        "reread-signatures",
        "reread-roster",
      ]);
      expect(lessons.getLessonSummary).toHaveBeenCalledWith(LESSON.id, manager, { forShare: true });
      expect(classes.getClassSummary).toHaveBeenCalledWith(LESSON.classId, manager, {
        forShare: true,
      });
      expect(manager.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `attendance.students:${LESSON.id}`,
      ]);
      expect(confirmedStaff.findConfirmedAssignments).toHaveBeenCalledWith(LESSON.id, manager, {
        forShare: true,
      });
      expect(manager.find).toHaveBeenCalledWith(StudentAttendance, {
        where: { lessonId: LESSON.id },
      });
      expect(roster.findRoster).toHaveBeenCalledWith(
        LESSON.classId,
        LESSON.date,
        { includeIds: [] },
        manager,
      );
    });

    it("answers 404 LESSON_NOT_FOUND, 409 LESSON_CANCELLED and 409 LESSON_IN_FUTURE in that order, and signs a lesson of today", async () => {
      const body = { entries: [entry(ANA_ENROLLMENT, PRESENT)] };

      state.lesson = null;
      expect(codeOf(await httpFailure(service.sign(LESSON.id, body, MONITOR)))).toBe(
        "LESSON_NOT_FOUND",
      );

      state.lesson = { ...LESSON, status: LessonStatus.CANCELLED, date: "2026-03-17" };
      const cancelled = await httpFailure(service.sign(LESSON.id, body, MONITOR));
      expect([cancelled.getStatus(), codeOf(cancelled)]).toEqual([409, "LESSON_CANCELLED"]);

      // The day after today in São Paulo (NOW is 22:30 of 2026-03-10 there).
      state.lesson = { ...LESSON, date: "2026-03-11" };
      const future = await httpFailure(service.sign(LESSON.id, body, MONITOR));
      expect([future.getStatus(), codeOf(future)]).toEqual([409, "LESSON_IN_FUTURE"]);
      expect(classes.getClassSummary).not.toHaveBeenCalled();
      nothingWritten();

      state.lesson = LESSON;
      await service.sign(LESSON.id, body, MONITOR);
      expect(insertedRows()).toHaveLength(1);
    });

    it("answers 409 CLASS_ARCHIVED for a lesson of an archived class", async () => {
      state.archivedAt = new Date("2026-03-09T12:00:00.000Z");

      const failure = await httpFailure(
        service.sign(LESSON.id, { entries: [entry(ANA_ENROLLMENT, PRESENT)] }, COORDINATOR),
      );

      expect([failure.getStatus(), codeOf(failure)]).toEqual([409, "CLASS_ARCHIVED"]);
      expect(confirmedStaff.findConfirmedAssignments).not.toHaveBeenCalled();
      nothingWritten();
    });

    it("answers 403 FORBIDDEN_SCOPE to a member who is not the confirmed teacher or a confirmed monitor, and lets a confirmed monitor sign", async () => {
      const body = { entries: [entry(ANA_ENROLLMENT, PRESENT)] };

      const failure = await httpFailure(service.sign(LESSON.id, body, OUTSIDER));
      expect([failure.getStatus(), codeOf(failure)]).toEqual([403, "FORBIDDEN_SCOPE"]);
      expect(failure.getResponse()).not.toHaveProperty("details");
      expect(manager.find).not.toHaveBeenCalled();
      nothingWritten();

      await service.sign(LESSON.id, body, MONITOR);
      await service.sign(LESSON.id, { entries: [entry(BRUNO_ENROLLMENT, ABSENT)] }, TEACHER);
      expect(insertedRows().map((row) => row.signedById)).toEqual([MONITOR.id, TEACHER.id]);
    });

    it("lets a director and a coordinator sign any lesson", async () => {
      state.staff = [];

      await service.sign(LESSON.id, { entries: [entry(ANA_ENROLLMENT, PRESENT)] }, DIRECTOR);
      await service.sign(LESSON.id, { entries: [entry(BRUNO_ENROLLMENT, PRESENT)] }, COORDINATOR);

      expect(insertedRows().map((row) => row.signedById)).toEqual([DIRECTOR.id, COORDINATOR.id]);
    });

    it("answers 400 ENROLLMENT_NOT_IN_ROLL_CALL with the positions outside the roll call, and writes nothing", async () => {
      const failure = await httpFailure(
        service.sign(
          LESSON.id,
          {
            entries: [
              entry(ANA_ENROLLMENT, PRESENT),
              { enrollmentId: ELSEWHERE, status: PRESENT },
              entry(BRUNO_ENROLLMENT, ABSENT),
              entry(CARLA_ENROLLMENT, ABSENT),
            ],
          },
          MONITOR,
        ),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "ENROLLMENT_NOT_IN_ROLL_CALL",
        message: "One or more enrollments are not in the roll call of this lesson.",
        details: [
          {
            field: "entries.1.enrollmentId",
            message: "enrollment is not in the roll call of this lesson",
          },
          {
            field: "entries.3.enrollmentId",
            message: "enrollment is not in the roll call of this lesson",
          },
        ],
      });
      nothingWritten();
    });

    it("is a no-op for the same status: no write and no event", async () => {
      state.signed = [signedRow(ANA_ENROLLMENT, PRESENT)];

      const list = await service.sign(
        LESSON.id,
        { entries: [entry(ANA_ENROLLMENT, PRESENT)] },
        MONITOR,
      );

      nothingWritten();
      expect(
        list.find((item) => item.enrollment.id === ANA_ENROLLMENT.id)?.attendance?.status,
      ).toBe(PRESENT);
    });

    it("answers 409 STUDENT_ATTENDANCE_ALREADY_SIGNED with the positions for another status, and writes nothing", async () => {
      state.signed = [signedRow(ANA_ENROLLMENT, PRESENT), signedRow(BRUNO_ENROLLMENT, ABSENT)];

      const failure = await httpFailure(
        service.sign(
          LESSON.id,
          { entries: [entry(BRUNO_ENROLLMENT, ABSENT), entry(ANA_ENROLLMENT, ABSENT)] },
          COORDINATOR,
        ),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_ATTENDANCE_ALREADY_SIGNED",
        message:
          "One or more attendances are already signed with another status; use the correction.",
        details: [
          {
            field: "entries.1.enrollmentId",
            message: "attendance already signed with another status",
          },
        ],
      });
      nothingWritten();
    });

    it("writes the first signatures in ONE save after every check, with the actor and one instant in signedAt, createdAt and updatedAt", async () => {
      state.signed = [signedRow(CARLA_ENROLLMENT, ABSENT)];
      state.roster = [ANA_ENROLLMENT, BRUNO_ENROLLMENT, CARLA_ENROLLMENT];

      await service.sign(
        LESSON.id,
        {
          entries: [
            entry(BRUNO_ENROLLMENT, ABSENT),
            entry(CARLA_ENROLLMENT, ABSENT),
            entry(ANA_ENROLLMENT, PRESENT),
          ],
        },
        MONITOR,
      );

      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.save.mock.calls[0][0]).toBe(StudentAttendance);
      expect(roster.findRoster).toHaveBeenCalledWith(
        LESSON.classId,
        LESSON.date,
        { includeIds: [CARLA_ENROLLMENT.id] },
        manager,
      );
      expect(
        insertedRows().map((row) => ({
          lessonId: row.lessonId,
          enrollmentId: row.enrollmentId,
          status: row.status,
          signedById: row.signedById,
          signedAt: row.signedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      ).toEqual(
        [
          [BRUNO_ENROLLMENT, ABSENT],
          [ANA_ENROLLMENT, PRESENT],
        ].map(([enrollment, status]) => ({
          lessonId: LESSON.id,
          enrollmentId: (enrollment as RosterEnrollment).id,
          status,
          signedById: MONITOR.id,
          signedAt: NOW,
          createdAt: NOW,
          updatedAt: NOW,
        })),
      );
      expect(clock.now).toHaveBeenCalledTimes(1);
    });

    it("records no hour entry", async () => {
      await service.sign(
        LESSON.id,
        { entries: [entry(ANA_ENROLLMENT, PRESENT), entry(BRUNO_ENROLLMENT, PRESENT)] },
        MONITOR,
      );

      // The only write is the attendance; the only raw query is the advisory lock.
      expect(manager.save.mock.calls.map((call) => call[0])).toEqual([StudentAttendance]);
      expect(manager.query.mock.calls.map((call) => call[0])).toEqual([
        "SELECT pg_advisory_xact_lock(hashtext($1))",
      ]);
      expect(emitted().map((event) => event.action)).not.toContain(
        AuditableAction.HOUR_ENTRY_CREATED,
      );
    });

    it("emits STUDENT_ATTENDANCE_SIGNED per new signature after the commit, in the order of the body, with ids, status and instant only", async () => {
      state.signed = [signedRow(ANA_ENROLLMENT, PRESENT)];
      eventEmitter.emit.mockImplementation(() => {
        order.push("emit");
        return true;
      });

      await service.sign(
        LESSON.id,
        { entries: [entry(BRUNO_ENROLLMENT, ABSENT), entry(ANA_ENROLLMENT, PRESENT)] },
        MONITOR,
      );

      expect(order.indexOf("emit")).toBeGreaterThan(order.indexOf("commit"));
      const events = emitted();
      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event.action).toBe(AuditableAction.STUDENT_ATTENDANCE_SIGNED);
      expect(event.actorId).toBe(MONITOR.id);
      expect(event.targetType).toBe("student_attendance");
      expect(event.targetId).toBe(insertedRows()[0].id);
      expect(event.before).toBeNull();
      expect(event.after).toEqual({
        lessonId: LESSON.id,
        enrollmentId: BRUNO_ENROLLMENT.id,
        status: ABSENT,
        signedById: MONITOR.id,
        signedAt: NOW,
      });
      expect(event.occurredAt).toBe(NOW);
    });

    it("emits nothing when the batch is refused", async () => {
      state.signed = [signedRow(ANA_ENROLLMENT, PRESENT)];

      await httpFailure(
        service.sign(
          LESSON.id,
          { entries: [entry(BRUNO_ENROLLMENT, ABSENT), entry(ANA_ENROLLMENT, ABSENT)] },
          MONITOR,
        ),
      );

      nothingWritten();
    });

    it("answers the roll call read after the commit", async () => {
      attendanceRepository.find.mockImplementation(async () => {
        order.push("reread-signatures");
        return [signedRow(ANA_ENROLLMENT, PRESENT, { signedAt: NOW, signedById: MONITOR.id })];
      });

      const list = await service.sign(
        LESSON.id,
        { entries: [entry(ANA_ENROLLMENT, PRESENT)] },
        MONITOR,
      );

      expect(order.indexOf("reread-signatures")).toBeGreaterThan(order.indexOf("commit"));
      expect(list).toEqual([
        {
          enrollment: { id: ANA_ENROLLMENT.id, status: "active", statusChangedAt: "2026-03-03" },
          student: ANA,
          attendance: expect.objectContaining({
            enrollmentId: ANA_ENROLLMENT.id,
            status: PRESENT,
            signedAt: NOW,
            justified: false,
            justification: null,
            corrections: [],
          }),
        },
        {
          enrollment: { id: BRUNO_ENROLLMENT.id, status: "active", statusChangedAt: "2026-03-03" },
          student: BRUNO,
          attendance: null,
        },
      ]);
    });
  });
});
