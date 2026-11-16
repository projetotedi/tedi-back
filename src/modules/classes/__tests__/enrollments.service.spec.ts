import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, QueryFailedError } from "typeorm";
import { CourseRef, CoursesService } from "@modules/catalog/services/courses.service";
import { StudentsService, StudentSummary } from "@modules/people/services/students.service";
import { Clock } from "@shared/dates/clock";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { SchoolClass } from "../entities/class.entity";
import { Enrollment } from "../entities/enrollment.entity";
import { ClassStatus } from "../enums/class-status.enum";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import { EnrollmentCountsService } from "../services/enrollment-counts.service";
import { EnrollmentsService } from "../services/enrollments.service";

// 22:30 in São Paulo on 2026-10-01 is already 2026-10-02 in UTC: "today" is 2026-10-01.
const NOW = new Date("2026-10-02T01:30:00.000Z");
const TODAY = "2026-10-01";
// 23:00 in São Paulo on 2026-03-02 is 2026-03-03 in UTC: the day of the enrollment is 2026-03-02.
const ENROLLED_AT = new Date("2026-03-03T02:00:00.000Z");

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const COURSE_ID = "01999a3e-7c1b-7000-8000-0000000000b9";
const ENROLLMENT_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const ANA = "01999a3e-7c1b-7000-8000-000000000001";
const BRUNO = "01999a3e-7c1b-7000-8000-000000000002";
const CARLA = "01999a3e-7c1b-7000-8000-000000000003";
const BASIC: CourseRef = { id: "01999a3e-7c1b-7000-8000-0000000000b1", name: "Informática Básica" };
const REASON = "Mudou de cidade por causa da saúde.";

type ClassOverrides = Partial<Omit<SchoolClass, "archive">> & {
  archive?: Partial<ArchivableColumns>;
};

function buildClass(overrides: ClassOverrides = {}): SchoolClass {
  const { archive, ...rest } = overrides;
  return Object.assign(new SchoolClass(), {
    id: CLASS_ID,
    code: "INFO-A",
    name: null,
    courseId: COURSE_ID,
    editionId: "01999a3e-7c1b-7000-8000-0000000000e1",
    startDate: "2026-03-03",
    endDate: "2026-06-27",
    location: null,
    capacity: 15,
    status: ClassStatus.PLANNED,
    createdById: ACTOR_ID,
    archive: Object.assign(new ArchivableColumns(), {
      archivedAt: null,
      archivedById: null,
      archiveReason: null,
      ...archive,
    }),
    ...rest,
  });
}

function buildEnrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return Object.assign(new Enrollment(), {
    id: ENROLLMENT_ID,
    classId: CLASS_ID,
    studentId: ANA,
    status: EnrollmentStatus.ACTIVE,
    enrolledAt: ENROLLED_AT,
    statusChangedAt: "2026-03-02",
    statusReason: null,
    createdById: ACTOR_ID,
    createdAt: ENROLLED_AT,
    updatedAt: ENROLLED_AT,
    deletedAt: null,
    ...overrides,
  });
}

function summary(id: string, name: string, archivedAt: Date | null = null): StudentSummary {
  return { id, name, archivedAt };
}

function driverFailure(code: string, constraint: string): QueryFailedError {
  const driverError = Object.assign(new Error("constraint violated"), { code, constraint });
  return new QueryFailedError("INSERT INTO enrollments", [], driverError);
}

async function httpFailure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error("Expected the promise to reject with an HttpException");
}

describe("EnrollmentsService", () => {
  let service: EnrollmentsService;
  let order: string[];
  let state: {
    schoolClass: SchoolClass | null;
    peek: Enrollment | null;
    locked: Enrollment | null;
    students: StudentSummary[];
    live: Array<{ id: string; studentId: string; status: EnrollmentStatus }>;
    completed: Array<{ studentId: string; courseId: string }>;
    prerequisites: CourseRef[];
    active: number;
  };

  const manager = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    query: jest.fn(),
  };
  const dataSource = { transaction: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  const students = { findStudentSummaries: jest.fn() };
  const courses = { findPrerequisiteRefs: jest.fn() };
  const counts = { countActive: jest.fn() };

  function emittedEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls.map((call) => call[1] as AuditableActionEvent);
  }

  function savedEnrollments(): Enrollment[] {
    return manager.save.mock.calls.flatMap((call) => call[0] as Enrollment | Enrollment[]);
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];
    state = {
      schoolClass: buildClass(),
      peek: buildEnrollment(),
      locked: buildEnrollment(),
      students: [summary(ANA, "Ana Souza"), summary(BRUNO, "Bruno Lima"), summary(CARLA, "Carla")],
      live: [],
      completed: [],
      prerequisites: [],
      active: 0,
    };

    manager.findOne.mockImplementation(
      async (target: unknown, options: { lock?: { mode: string } }) => {
        if (target === SchoolClass) {
          order.push(`lock-class:${String(options.lock?.mode)}`);
          return state.schoolClass;
        }
        if (target === Enrollment && options.lock !== undefined) {
          order.push(`lock-enrollment:${options.lock.mode}`);
          return state.locked;
        }
        order.push("peek-enrollment");
        return state.peek;
      },
    );
    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), data),
    );
    manager.save.mockImplementation(async (entity: Enrollment | Enrollment[]) => {
      order.push("save");
      if (Array.isArray(entity)) {
        entity.forEach((enrollment, index) => {
          enrollment.id = `01999a3e-7c1b-7000-8000-00000000010${String(index)}`;
        });
      }
      return entity;
    });
    manager.update.mockImplementation(async () => {
      order.push("update");
      return { affected: 1 };
    });
    manager.query.mockImplementation(async (sql: string) => {
      if (sql.includes("JOIN classes")) {
        order.push("read-completed");
        return state.completed;
      }
      order.push("read-live");
      return state.live;
    });
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => Promise<unknown>) => {
        order.push("begin");
        const result = await callback(manager);
        order.push("commit");
        return result;
      },
    );
    eventEmitter.emit.mockImplementation(() => {
      order.push("emit");
      return true;
    });
    clock.now.mockReturnValue(NOW);
    students.findStudentSummaries.mockImplementation(
      async (ids: string[], _manager: unknown, options: { forShare?: boolean } = {}) => {
        order.push(`read-students:${options.forShare === true ? "share" : "plain"}`);
        return state.students.filter((student) => ids.includes(student.id));
      },
    );
    courses.findPrerequisiteRefs.mockImplementation(async () => {
      order.push("read-prerequisites");
      return state.prerequisites;
    });
    counts.countActive.mockImplementation(async () => {
      order.push("count-active");
      return state.active;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: StudentsService, useValue: students },
        { provide: CoursesService, useValue: courses },
        { provide: EnrollmentCountsService, useValue: counts },
      ],
    }).compile();

    service = moduleRef.get(EnrollmentsService);
  });

  describe("enroll()", () => {
    it("refuses a repeated student id in any letter case with 400 DUPLICATE_STUDENT and the positions, before opening a transaction", async () => {
      const failure = await httpFailure(
        service.enroll(CLASS_ID, { studentIds: [ANA, BRUNO, ANA.toUpperCase(), BRUNO] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({
        error: "DUPLICATE_STUDENT",
        details: [
          { field: "studentIds.2", message: "student appears more than once" },
          { field: "studentIds.3", message: "student appears more than once" },
        ],
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("locks the class FOR UPDATE before it reads the students, the enrollments and the count", async () => {
      await service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID);

      expect(order).toEqual([
        "begin",
        "lock-class:pessimistic_write",
        "read-students:share",
        "read-live",
        "count-active",
        "read-prerequisites",
        "save",
        "commit",
        "emit",
      ]);
      expect(manager.findOne).toHaveBeenCalledWith(SchoolClass, {
        where: { id: CLASS_ID },
        lock: { mode: "pessimistic_write" },
      });
      expect(counts.countActive).toHaveBeenCalledWith(manager, CLASS_ID);
    });

    it("answers 404 CLASS_NOT_FOUND for a class that is not there", async () => {
      state.schoolClass = null;

      const failure = await httpFailure(service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "CLASS_NOT_FOUND",
        message: "Class not found.",
      });
      expect(students.findStudentSummaries).not.toHaveBeenCalled();
    });

    it("answers 409 CLASS_ARCHIVED before CLASS_CLOSED for an archived completed class", async () => {
      state.schoolClass = buildClass({
        status: ClassStatus.COMPLETED,
        archive: { archivedAt: NOW, archivedById: ACTOR_ID },
      });

      const failure = await httpFailure(service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toMatchObject({ error: "CLASS_ARCHIVED" });
    });

    it.each(["completed", "cancelled"])(
      "answers 409 CLASS_CLOSED for a %s class",
      async (status) => {
        state.schoolClass = buildClass({ status: status as ClassStatus });

        const failure = await httpFailure(
          service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID),
        );

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "CLASS_CLOSED",
          message: "A completed or cancelled class takes no new enrollments.",
        });
        expect(students.findStudentSummaries).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
      },
    );

    it.each(["planned", "in_progress"])("enrolls in a %s class", async (status) => {
      state.schoolClass = buildClass({ status: status as ClassStatus });

      const result = await service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID);

      expect(result.enrolled.map((enrollment) => enrollment.student.id)).toEqual([ANA]);
    });

    it("reads the students FOR SHARE with the manager of the transaction", async () => {
      await service.enroll(CLASS_ID, { studentIds: [ANA.toUpperCase(), BRUNO] }, ACTOR_ID);

      expect(students.findStudentSummaries).toHaveBeenCalledWith([ANA, BRUNO], manager, {
        forShare: true,
      });
    });

    it("answers 400 STUDENT_NOT_FOUND with studentIds.<i> for each id that is not a student", async () => {
      state.students = [summary(BRUNO, "Bruno Lima")];

      const failure = await httpFailure(
        service.enroll(CLASS_ID, { studentIds: [ANA, BRUNO, CARLA] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({
        error: "STUDENT_NOT_FOUND",
        details: [
          { field: "studentIds.0", message: "student not found" },
          { field: "studentIds.2", message: "student not found" },
        ],
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("answers 409 STUDENT_ARCHIVED with studentIds.<i> for each archived student, and writes nothing", async () => {
      state.students = [
        summary(ANA, "Ana Souza"),
        summary(BRUNO, "Bruno Lima", new Date("2026-09-01T12:00:00.000Z")),
      ];

      const failure = await httpFailure(
        service.enroll(CLASS_ID, { studentIds: [ANA, BRUNO] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toMatchObject({
        error: "STUDENT_ARCHIVED",
        details: [{ field: "studentIds.1", message: "student is archived" }],
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("skips a student who has an enrollment in the class in any status, with its id and status, and enrolls the others", async () => {
      state.live = [
        {
          id: "01999a3e-7c1b-7000-8000-0000000000a1",
          studentId: BRUNO,
          status: EnrollmentStatus.DROPPED,
        },
        {
          id: "01999a3e-7c1b-7000-8000-0000000000a2",
          studentId: CARLA,
          status: EnrollmentStatus.ACTIVE,
        },
      ];

      const result = await service.enroll(CLASS_ID, { studentIds: [CARLA, ANA, BRUNO] }, ACTOR_ID);

      expect(result.skipped).toEqual([
        {
          studentId: CARLA,
          reason: "ALREADY_ENROLLED",
          enrollmentId: "01999a3e-7c1b-7000-8000-0000000000a2",
          status: EnrollmentStatus.ACTIVE,
        },
        {
          studentId: BRUNO,
          reason: "ALREADY_ENROLLED",
          enrollmentId: "01999a3e-7c1b-7000-8000-0000000000a1",
          status: EnrollmentStatus.DROPPED,
        },
      ]);
      expect(result.enrolled.map((enrollment) => enrollment.student.id)).toEqual([ANA]);
      const [sql, parameters] = manager.query.mock.calls[0];
      expect(sql).toContain("deleted_at IS NULL");
      expect(sql).not.toContain("status =");
      expect(parameters).toEqual([CLASS_ID, [CARLA, ANA, BRUNO]]);
    });

    it("answers 409 CLASS_FULL with the seats left and writes nothing when the new ones pass the seats", async () => {
      state.schoolClass = buildClass({ capacity: 15 });
      state.active = 13;

      const failure = await httpFailure(
        service.enroll(CLASS_ID, { studentIds: [ANA, BRUNO, CARLA] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "CLASS_FULL",
        message: "The class has 2 seats left and 3 students were asked.",
        details: [{ field: "studentIds", message: "2" }],
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(courses.findPrerequisiteRefs).not.toHaveBeenCalled();
    });

    it("does not count the skipped students against the seats", async () => {
      state.schoolClass = buildClass({ capacity: 15 });
      state.active = 14;
      state.live = [
        {
          id: "01999a3e-7c1b-7000-8000-0000000000a1",
          studentId: BRUNO,
          status: EnrollmentStatus.ACTIVE,
        },
      ];

      const result = await service.enroll(CLASS_ID, { studentIds: [ANA, BRUNO] }, ACTOR_ID);

      expect(result.enrolled).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
    });

    it("fills the class up to the last seat", async () => {
      state.schoolClass = buildClass({ capacity: 15 });
      state.active = 12;

      const result = await service.enroll(CLASS_ID, { studentIds: [ANA, BRUNO, CARLA] }, ACTOR_ID);
      expect(result.enrolled).toHaveLength(3);

      // A class over its capacity (forced by SQL) has 0 seats left, never a negative number.
      state.active = 16;
      const failure = await httpFailure(service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID));
      expect(failure.getResponse()).toMatchObject({
        details: [{ field: "studentIds", message: "0" }],
      });
    });

    it("warns PREREQUISITE_NOT_COMPLETED per student and missing prerequisite, and enrolls all the same", async () => {
      state.prerequisites = [BASIC];
      state.completed = [{ studentId: BRUNO, courseId: BASIC.id }];

      const result = await service.enroll(CLASS_ID, { studentIds: [ANA, BRUNO] }, ACTOR_ID);

      expect(result.warnings).toEqual([
        {
          studentId: ANA,
          code: "PREREQUISITE_NOT_COMPLETED",
          courseId: BASIC.id,
          courseName: "Informática Básica",
        },
      ]);
      expect(result.enrolled.map((enrollment) => enrollment.student.id)).toEqual([ANA, BRUNO]);
      expect(courses.findPrerequisiteRefs).toHaveBeenCalledWith(COURSE_ID, manager);
      const [sql, parameters] = manager.query.mock.calls[1];
      expect(sql).toContain("e.status = $3");
      expect(sql).not.toMatch(/FOR (UPDATE|SHARE)/);
      expect(parameters).toEqual([[ANA, BRUNO], [BASIC.id], EnrollmentStatus.COMPLETED]);
    });

    it("does not read completions when the course has no prerequisite", async () => {
      await service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID);

      expect(order).not.toContain("read-completed");
    });

    it("writes every enrollment active, with one instant for enrolledAt, createdAt and updatedAt, statusChangedAt = today in America/Sao_Paulo and the actor as createdById", async () => {
      const result = await service.enroll(CLASS_ID, { studentIds: [BRUNO, ANA] }, ACTOR_ID);

      expect(clock.now).toHaveBeenCalledTimes(1);
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(savedEnrollments()).toEqual([
        expect.objectContaining({
          classId: CLASS_ID,
          studentId: BRUNO,
          status: EnrollmentStatus.ACTIVE,
          enrolledAt: NOW,
          createdAt: NOW,
          updatedAt: NOW,
          statusChangedAt: TODAY,
          statusReason: null,
          createdById: ACTOR_ID,
        }),
        expect.objectContaining({ studentId: ANA, enrolledAt: NOW, statusChangedAt: TODAY }),
      ]);
      // In the order of the body, with the names read in the transaction.
      expect(result.enrolled).toEqual([
        {
          id: "01999a3e-7c1b-7000-8000-000000000100",
          classId: CLASS_ID,
          student: { id: BRUNO, name: "Bruno Lima" },
          status: EnrollmentStatus.ACTIVE,
          enrolledAt: NOW,
          statusChangedAt: TODAY,
          statusReason: null,
        },
        expect.objectContaining({ student: { id: ANA, name: "Ana Souza" } }),
      ]);
    });

    it("answers 201 with enrolled [] and no event when every student was skipped", async () => {
      state.live = [
        {
          id: "01999a3e-7c1b-7000-8000-0000000000a1",
          studentId: ANA,
          status: EnrollmentStatus.COMPLETED,
        },
      ];

      const result = await service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID);

      expect(result).toEqual({
        enrolled: [],
        skipped: [
          {
            studentId: ANA,
            reason: "ALREADY_ENROLLED",
            enrollmentId: "01999a3e-7c1b-7000-8000-0000000000a1",
            status: EnrollmentStatus.COMPLETED,
          },
        ],
        warnings: [],
      });
      expect(counts.countActive).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits ENROLLMENT_CREATED per enrollment after the commit, with ids, status, dates and missingPrerequisiteIds only", async () => {
      state.prerequisites = [BASIC];
      state.completed = [{ studentId: BRUNO, courseId: BASIC.id }];

      await service.enroll(CLASS_ID, { studentIds: [ANA, BRUNO] }, ACTOR_ID);

      expect(order.slice(-3)).toEqual(["commit", "emit", "emit"]);
      const events = emittedEvents();
      expect(eventEmitter.emit.mock.calls.map((call) => call[0])).toEqual([
        AUDITABLE_ACTION_EVENT,
        AUDITABLE_ACTION_EVENT,
      ]);
      expect(events.map((event) => [event.action, event.targetType, event.actorId])).toEqual([
        [AuditableAction.ENROLLMENT_CREATED, "enrollment", ACTOR_ID],
        [AuditableAction.ENROLLMENT_CREATED, "enrollment", ACTOR_ID],
      ]);
      expect(events[0].targetId).toBe("01999a3e-7c1b-7000-8000-000000000100");
      expect(events[0].before).toBeNull();
      expect(events[0].after).toEqual({
        classId: CLASS_ID,
        studentId: ANA,
        status: EnrollmentStatus.ACTIVE,
        enrolledAt: NOW,
        statusChangedAt: TODAY,
        missingPrerequisiteIds: [BASIC.id],
      });
      expect(events[1].after).toMatchObject({ studentId: BRUNO, missingPrerequisiteIds: [] });
      expect(events[0].occurredAt).toBe(NOW);
      expect(JSON.stringify(events)).not.toContain("Ana Souza");
    });

    it("emits nothing when the enrollment is refused", async () => {
      state.active = 15;

      await httpFailure(service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID));

      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(order).not.toContain("commit");
    });

    it("maps a 23505 on uq_enrollments_class_id_student_id to 409 ALREADY_ENROLLED and rethrows any other error", async () => {
      dataSource.transaction.mockRejectedValueOnce(
        driverFailure("23505", "uq_enrollments_class_id_student_id"),
      );
      const failure = await httpFailure(service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID));
      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "ALREADY_ENROLLED",
        message: "The student is already enrolled in this class.",
      });

      const other = driverFailure("23505", "uq_people_email");
      dataSource.transaction.mockRejectedValueOnce(other);
      await expect(service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID)).rejects.toBe(other);

      const plain = new Error("connection lost");
      dataSource.transaction.mockRejectedValueOnce(plain);
      await expect(service.enroll(CLASS_ID, { studentIds: [ANA] }, ACTOR_ID)).rejects.toBe(plain);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("updateStatus()", () => {
    const dropped = {
      status: EnrollmentStatus.DROPPED,
      effectiveDate: "2026-04-10",
      reason: REASON,
    };

    it("refuses an effectiveDate after today in America/Sao_Paulo with 400 EFFECTIVE_DATE_IN_FUTURE before the transaction", async () => {
      // 2026-10-02 is today in UTC but tomorrow in São Paulo.
      const failure = await httpFailure(
        service.updateStatus(ENROLLMENT_ID, { ...dropped, effectiveDate: "2026-10-02" }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({
        error: "EFFECTIVE_DATE_IN_FUTURE",
        details: [{ field: "effectiveDate", message: "must not be after today" }],
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();

      // Today itself is fine.
      await service.updateStatus(ENROLLMENT_ID, { ...dropped, effectiveDate: TODAY }, ACTOR_ID);
    });

    it("answers 404 ENROLLMENT_NOT_FOUND for an unknown or removed enrollment", async () => {
      state.peek = null;
      const unknown = await httpFailure(service.updateStatus(ENROLLMENT_ID, dropped, ACTOR_ID));
      expect(unknown.getStatus()).toBe(404);
      expect(unknown.getResponse()).toEqual({
        error: "ENROLLMENT_NOT_FOUND",
        message: "Enrollment not found.",
      });
      expect(order).not.toContain("lock-class:pessimistic_write");

      // Removed between the peek and the lock.
      state.peek = buildEnrollment();
      state.locked = null;
      const removed = await httpFailure(service.updateStatus(ENROLLMENT_ID, dropped, ACTOR_ID));
      expect(removed.getStatus()).toBe(404);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("locks the class FOR UPDATE, then the enrollment FOR UPDATE", async () => {
      await service.updateStatus(ENROLLMENT_ID.toUpperCase(), dropped, ACTOR_ID);

      expect(order).toEqual([
        "begin",
        "peek-enrollment",
        "lock-class:pessimistic_write",
        "read-students:plain",
        "lock-enrollment:pessimistic_write",
        "save",
        "commit",
        "emit",
      ]);
      // The class comes from the enrollment; everything after the peek uses the id of the database.
      expect(manager.findOne).toHaveBeenNthCalledWith(2, SchoolClass, {
        where: { id: CLASS_ID },
        lock: { mode: "pessimistic_write" },
      });
      expect(manager.findOne).toHaveBeenNthCalledWith(3, Enrollment, {
        where: { id: ENROLLMENT_ID },
        lock: { mode: "pessimistic_write" },
      });
    });

    it("locks the student profile FOR SHARE before the enrollment only when the status goes to active", async () => {
      state.peek = buildEnrollment({ status: EnrollmentStatus.DROPPED });
      state.locked = buildEnrollment({ status: EnrollmentStatus.DROPPED });

      await service.updateStatus(
        ENROLLMENT_ID,
        { status: EnrollmentStatus.ACTIVE, effectiveDate: "2026-05-02" },
        ACTOR_ID,
      );

      expect(order.slice(0, 6)).toEqual([
        "begin",
        "peek-enrollment",
        "lock-class:pessimistic_write",
        "read-students:share",
        "lock-enrollment:pessimistic_write",
        "count-active",
      ]);
      expect(students.findStudentSummaries).toHaveBeenCalledWith([ANA], manager, {
        forShare: true,
      });
    });

    it("is a no-op for the same status: no write, no event, the date and the reason ignored", async () => {
      state.locked = buildEnrollment({
        status: EnrollmentStatus.DROPPED,
        statusChangedAt: "2026-04-01",
      });

      const result = await service.updateStatus(
        ENROLLMENT_ID,
        { status: EnrollmentStatus.DROPPED, effectiveDate: "2026-09-30", reason: "other" },
        ACTOR_ID,
      );

      expect(result).toMatchObject({
        status: EnrollmentStatus.DROPPED,
        statusChangedAt: "2026-04-01",
      });
      expect(result.statusReason).toBeNull();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("answers 409 CLASS_ARCHIVED for an enrollment of an archived class", async () => {
      state.schoolClass = buildClass({ archive: { archivedAt: NOW, archivedById: ACTOR_ID } });

      const failure = await httpFailure(service.updateStatus(ENROLLMENT_ID, dropped, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toMatchObject({ error: "CLASS_ARCHIVED" });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("refuses an effectiveDate before the day of the enrollment in America/Sao_Paulo with 400 EFFECTIVE_DATE_BEFORE_ENROLLMENT", async () => {
      // ENROLLED_AT is 2026-03-03 in UTC but 2026-03-02 in São Paulo: 2026-03-02 is accepted.
      const failure = await httpFailure(
        service.updateStatus(ENROLLMENT_ID, { ...dropped, effectiveDate: "2026-03-01" }, ACTOR_ID),
      );
      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({
        error: "EFFECTIVE_DATE_BEFORE_ENROLLMENT",
        details: [
          { field: "effectiveDate", message: "must not be before the day of the enrollment" },
        ],
      });

      const sameDay = await service.updateStatus(
        ENROLLMENT_ID,
        { ...dropped, effectiveDate: "2026-03-02" },
        ACTOR_ID,
      );
      expect(sameDay.statusChangedAt).toBe("2026-03-02");

      // The CHECK of the table is the safety net, mapped to the same error.
      dataSource.transaction.mockRejectedValueOnce(
        driverFailure("23514", "ck_enrollments_status_changed_at"),
      );
      const net = await httpFailure(service.updateStatus(ENROLLMENT_ID, dropped, ACTOR_ID));
      expect(net.getResponse()).toMatchObject({ error: "EFFECTIVE_DATE_BEFORE_ENROLLMENT" });
    });

    it.each([
      ["active", "dropped"],
      ["active", "completed"],
      ["dropped", "completed"],
      ["completed", "dropped"],
    ])("moves %s to %s with the date and the reason", async (from, to) => {
      state.peek = buildEnrollment({ status: from as EnrollmentStatus });
      state.locked = buildEnrollment({ status: from as EnrollmentStatus });

      const result = await service.updateStatus(
        ENROLLMENT_ID,
        { status: to as EnrollmentStatus, effectiveDate: "2026-04-10", reason: REASON },
        ACTOR_ID,
      );

      expect(result).toEqual({
        id: ENROLLMENT_ID,
        classId: CLASS_ID,
        student: { id: ANA, name: "Ana Souza" },
        status: to,
        enrolledAt: ENROLLED_AT,
        statusChangedAt: "2026-04-10",
        statusReason: REASON,
      });
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: to, statusChangedAt: "2026-04-10", updatedAt: NOW }),
      );
      // Leaving active never asks for a seat.
      expect(counts.countActive).not.toHaveBeenCalled();
    });

    it("reactivates a dropped enrollment when there is a seat", async () => {
      state.peek = buildEnrollment({ status: EnrollmentStatus.DROPPED });
      state.locked = buildEnrollment({ status: EnrollmentStatus.DROPPED });
      state.active = 14;

      const result = await service.updateStatus(
        ENROLLMENT_ID,
        { status: EnrollmentStatus.ACTIVE, effectiveDate: "2026-05-02" },
        ACTOR_ID,
      );

      expect(result.status).toBe(EnrollmentStatus.ACTIVE);
      expect(counts.countActive).toHaveBeenCalledWith(manager, CLASS_ID);
    });

    it("answers 409 CLASS_FULL with details on status when the reactivation has no seat", async () => {
      state.peek = buildEnrollment({ status: EnrollmentStatus.DROPPED });
      state.locked = buildEnrollment({ status: EnrollmentStatus.DROPPED });
      state.active = 15;

      const failure = await httpFailure(
        service.updateStatus(
          ENROLLMENT_ID,
          { status: EnrollmentStatus.ACTIVE, effectiveDate: "2026-05-02" },
          ACTOR_ID,
        ),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "CLASS_FULL",
        message: "The class has 0 seats left and 1 students were asked.",
        details: [{ field: "status", message: "0" }],
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it.each(["completed", "cancelled"])(
      "answers 409 CLASS_CLOSED when reactivating in a %s class",
      async (status) => {
        state.schoolClass = buildClass({ status: status as ClassStatus });
        state.peek = buildEnrollment({ status: EnrollmentStatus.COMPLETED });
        state.locked = buildEnrollment({ status: EnrollmentStatus.COMPLETED });

        const failure = await httpFailure(
          service.updateStatus(
            ENROLLMENT_ID,
            { status: EnrollmentStatus.ACTIVE, effectiveDate: "2026-05-02" },
            ACTOR_ID,
          ),
        );

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toMatchObject({ error: "CLASS_CLOSED" });
      },
    );

    it("answers 409 STUDENT_ARCHIVED when reactivating the enrollment of an archived student", async () => {
      state.students = [summary(ANA, "Ana Souza", new Date("2026-09-01T12:00:00.000Z"))];
      state.peek = buildEnrollment({ status: EnrollmentStatus.DROPPED });
      state.locked = buildEnrollment({ status: EnrollmentStatus.DROPPED });

      const failure = await httpFailure(
        service.updateStatus(
          ENROLLMENT_ID,
          { status: EnrollmentStatus.ACTIVE, effectiveDate: "2026-05-02" },
          ACTOR_ID,
        ),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_ARCHIVED",
        message: "Archived students cannot be enrolled.",
      });
      expect(counts.countActive).not.toHaveBeenCalled();
    });

    it("lets a completed class close out its enrollments: active to completed", async () => {
      state.schoolClass = buildClass({ status: ClassStatus.COMPLETED });

      const result = await service.updateStatus(
        ENROLLMENT_ID,
        { status: EnrollmentStatus.COMPLETED, effectiveDate: "2026-06-27" },
        ACTOR_ID,
      );

      expect(result.status).toBe(EnrollmentStatus.COMPLETED);
      expect(result.statusChangedAt).toBe("2026-06-27");
    });

    it("clears the reason when the change comes without one", async () => {
      state.peek = buildEnrollment({ status: EnrollmentStatus.DROPPED, statusReason: REASON });
      state.locked = buildEnrollment({ status: EnrollmentStatus.DROPPED, statusReason: REASON });

      const result = await service.updateStatus(
        ENROLLMENT_ID,
        { status: EnrollmentStatus.COMPLETED, effectiveDate: "2026-06-27" },
        ACTOR_ID,
      );

      expect(result.statusReason).toBeNull();
      expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ statusReason: null }));
    });

    it("emits ENROLLMENT_STATUS_CHANGED with status and statusChangedAt before and after and changedFields, never the reason", async () => {
      await service.updateStatus(ENROLLMENT_ID, dropped, ACTOR_ID);

      expect(order.slice(-2)).toEqual(["commit", "emit"]);
      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.ENROLLMENT_STATUS_CHANGED);
      expect(event.targetType).toBe("enrollment");
      expect(event.targetId).toBe(ENROLLMENT_ID);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.occurredAt).toBe(NOW);
      expect(event.before).toEqual({ status: "active", statusChangedAt: "2026-03-02" });
      expect(event.after).toEqual({
        status: "dropped",
        statusChangedAt: "2026-04-10",
        changedFields: ["status", "statusChangedAt", "statusReason"],
      });
      expect(JSON.stringify(event)).not.toContain(REASON);

      // Same date and same (empty) reason: only the status changed.
      eventEmitter.emit.mockClear();
      state.peek = buildEnrollment({
        status: EnrollmentStatus.DROPPED,
        statusChangedAt: "2026-04-10",
      });
      state.locked = buildEnrollment({
        status: EnrollmentStatus.DROPPED,
        statusChangedAt: "2026-04-10",
      });
      await service.updateStatus(
        ENROLLMENT_ID,
        { status: EnrollmentStatus.COMPLETED, effectiveDate: "2026-04-10" },
        ACTOR_ID,
      );
      expect(emittedEvents()[0].after).toMatchObject({ changedFields: ["status"] });
    });

    it("throws when the student of the enrollment cannot be read, a broken invariant", async () => {
      state.students = [];

      await expect(service.updateStatus(ENROLLMENT_ID, dropped, ACTOR_ID)).rejects.toThrow(
        `The student ${ANA} of the enrollment ${ENROLLMENT_ID} is gone.`,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe("remove()", () => {
    it("answers 404 ENROLLMENT_NOT_FOUND for an unknown or removed enrollment", async () => {
      state.peek = null;
      const unknown = await httpFailure(service.remove(ENROLLMENT_ID, ACTOR_ID));
      expect(unknown.getStatus()).toBe(404);
      expect(unknown.getResponse()).toMatchObject({ error: "ENROLLMENT_NOT_FOUND" });

      state.peek = buildEnrollment();
      state.locked = null;
      const removed = await httpFailure(service.remove(ENROLLMENT_ID, ACTOR_ID));
      expect(removed.getStatus()).toBe(404);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it("answers 409 CLASS_ARCHIVED before ENROLLMENT_NOT_REMOVABLE", async () => {
      state.schoolClass = buildClass({ archive: { archivedAt: NOW, archivedById: ACTOR_ID } });
      state.locked = buildEnrollment({ status: EnrollmentStatus.DROPPED });

      const failure = await httpFailure(service.remove(ENROLLMENT_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toMatchObject({ error: "CLASS_ARCHIVED" });
      expect(manager.update).not.toHaveBeenCalled();
    });

    it.each(["dropped", "completed"])(
      "refuses to remove a %s enrollment with 409 ENROLLMENT_NOT_REMOVABLE",
      async (status) => {
        state.locked = buildEnrollment({ status: status as EnrollmentStatus });

        const failure = await httpFailure(service.remove(ENROLLMENT_ID, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "ENROLLMENT_NOT_REMOVABLE",
          message:
            "Only an active enrollment can be removed; use the status change for the others.",
        });
        expect(manager.update).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      },
    );

    it("soft-deletes an active enrollment with one instant in deletedAt and updatedAt and emits ENROLLMENT_REMOVED", async () => {
      await service.remove(ENROLLMENT_ID.toUpperCase(), ACTOR_ID);

      expect(order).toEqual([
        "begin",
        "peek-enrollment",
        "lock-class:pessimistic_write",
        "lock-enrollment:pessimistic_write",
        "update",
        "commit",
        "emit",
      ]);
      expect(manager.update).toHaveBeenCalledWith(
        Enrollment,
        { id: ENROLLMENT_ID },
        { deletedAt: NOW, updatedAt: NOW },
      );
      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.ENROLLMENT_REMOVED);
      expect(event.targetType).toBe("enrollment");
      expect(event.targetId).toBe(ENROLLMENT_ID);
      expect(event.before).toEqual({ classId: CLASS_ID, studentId: ANA, status: "active" });
      expect(event.after).toEqual({ deletedAt: NOW });
      expect(event.occurredAt).toBe(NOW);
    });
  });
});
