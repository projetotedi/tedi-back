import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { DataSource, QueryFailedError } from "typeorm";
import { ConfirmedStaffCount } from "@modules/lessons/services/lesson-coverage";
import {
  LessonAgendaRef,
  LessonListingService,
} from "@modules/lessons/services/lesson-listing.service";
import {
  LessonsService,
  LessonStatus,
  LessonSummary,
} from "@modules/lessons/services/lessons.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { MembersService, MemberSummary } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { ApplyToLessonDto } from "../dto/apply-to-lesson.dto";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { ApplicationsService, lessonStaffLockKey } from "../services/applications.service";
import { LessonStaffCounterService } from "../services/lesson-staff-counter.service";

/** 12:00 in São Paulo: today is 2026-03-09 there. */
const NOW = new Date("2026-03-09T15:00:00.000Z");
const CREATED_AT = new Date("2026-03-05T12:00:00.000Z");

const REVIEWED_AT = new Date("2026-03-06T12:00:00.000Z");

const REVIEWER_ID = "01999a3e-0000-7000-8000-0000000000d0";
const PERSON_ID = "01999a3e-0000-7000-8000-0000000000b1";
const OTHER_PERSON_ID = "01999a3e-0000-7000-8000-0000000000b2";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const OTHER_LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f2";
const APPLICATION_ID = "01999a3e-7c1b-7000-8000-0000000000a1";
const DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000001";

const NOTE = "Posso chegar 15 min antes para ligar os computadores.";

const MEMBER: AuthUser = {
  id: PERSON_ID,
  role: Role.MEMBER,
  accessEnabled: true,
  departmentIds: [DEPARTMENT_ID],
};

const COORDINATOR: AuthUser = {
  id: REVIEWER_ID,
  role: Role.COORDINATOR,
  accessEnabled: true,
  departmentIds: [],
};

function buildApplication(overrides: Partial<LessonAssignment> = {}): LessonAssignment {
  return Object.assign(new LessonAssignment(), {
    id: APPLICATION_ID,
    lessonId: LESSON_ID,
    personId: PERSON_ID,
    role: AssignmentRole.MONITOR,
    status: AssignmentStatus.PENDING,
    source: AssignmentSource.APPLICATION,
    note: NOTE,
    createdById: PERSON_ID,
    reviewedById: null,
    reviewedAt: null,
    cancelledById: null,
    cancelledAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  });
}

function buildAgendaRef(overrides: Partial<LessonAgendaRef> = {}): LessonAgendaRef {
  return {
    id: LESSON_ID,
    title: "Arquivos e pastas",
    sequenceOrder: 3,
    date: "2026-03-10",
    startTime: "14:00",
    endTime: "15:30",
    location: "Laboratório 2",
    status: LessonStatus.PLANNED,
    expectedMonitors: 3,
    class: { id: CLASS_ID, code: "INFO-A", name: "Informática Básica, turma A" },
    ...overrides,
  };
}

function buildLesson(overrides: Partial<LessonSummary> = {}): LessonSummary {
  return {
    id: LESSON_ID,
    classId: CLASS_ID,
    title: "Arquivos e pastas",
    date: "2026-03-10",
    startTime: "14:00",
    endTime: "15:30",
    status: LessonStatus.PLANNED,
    expectedMonitors: 2,
    ...overrides,
  };
}

function buildMember(overrides: Partial<MemberSummary> = {}): MemberSummary {
  return {
    id: PERSON_ID,
    name: "Ana Torres",
    active: true,
    departmentIds: [DEPARTMENT_ID],
    ...overrides,
  };
}

function violation(code: string, constraint: string): QueryFailedError {
  const driverError = Object.assign(new Error(`violates constraint ${constraint}`), {
    code,
    constraint,
  });
  return new QueryFailedError("INSERT INTO lesson_assignments", [], driverError);
}

/** The body as the ValidationPipe hands it over: the note already trimmed by the DTO. */
function applyBody(body: Record<string, unknown>): ApplyToLessonDto {
  return plainToInstance(ApplyToLessonDto, body);
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

function codeOf(failure: HttpException): string {
  return (failure.getResponse() as { error: string }).error;
}

describe("ApplicationsService", () => {
  let service: ApplicationsService;
  let policy: PermissionPolicy;
  let order: string[];
  let state: {
    lesson: LessonSummary | null;
    member: MemberSummary | null;
    hasActiveAssignment: boolean;
    staff: Map<string, ConfirmedStaffCount>;
    application: LessonAssignment | null;
    applications: LessonAssignment[];
    agenda: LessonAgendaRef[];
    people: PersonRefDto[];
  };

  const manager = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    exists: jest.fn(),
    query: jest.fn(),
  };
  const applicationRepository = { find: jest.fn() };
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  const lessons = { getLessonSummary: jest.fn() };
  const members = { getMemberSummary: jest.fn() };
  const staffCounter = { countConfirmedStaff: jest.fn() };
  const listing = { findAgendaByIds: jest.fn() };
  const people = { findRefsByIds: jest.fn() };

  function auditEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls
      .filter((call) => call[0] === AUDITABLE_ACTION_EVENT)
      .map((call) => call[1] as AuditableActionEvent);
  }

  /** The applications that were written one by one (an approval, a decline). */
  function savedApplications(): LessonAssignment[] {
    return manager.save.mock.calls
      .filter((call) => call[0] instanceof LessonAssignment)
      .map((call) => call[0] as LessonAssignment);
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];
    state = {
      lesson: buildLesson(),
      member: buildMember(),
      hasActiveAssignment: false,
      staff: new Map(),
      application: buildApplication(),
      applications: [],
      agenda: [],
      people: [{ id: PERSON_ID, name: "Ana Torres" }],
    };

    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), {
        id: APPLICATION_ID,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        deletedAt: null,
        ...data,
      }),
    );
    manager.save.mockImplementation(async (entity: unknown) => {
      order.push("save");
      return entity;
    });
    manager.findOne.mockImplementation(async (target: unknown) => {
      if (target !== LessonAssignment) return null;
      order.push("load-application");
      return state.application;
    });
    manager.exists.mockImplementation(async () => {
      order.push("check-active");
      return state.hasActiveAssignment;
    });
    manager.query.mockImplementation(async () => {
      order.push("advisory-lock");
      return [];
    });
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => Promise<unknown>) => {
        const result = await callback(manager);
        order.push("commit");
        return result;
      },
    );
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === LessonAssignment ? applicationRepository : undefined,
    );
    applicationRepository.find.mockImplementation(async () => {
      order.push("find-applications");
      return state.applications;
    });
    eventEmitter.emit.mockImplementation(() => {
      order.push("emit-audit");
      return true;
    });
    clock.now.mockReturnValue(NOW);
    lessons.getLessonSummary.mockImplementation(async () => {
      order.push("get-lesson");
      return state.lesson;
    });
    members.getMemberSummary.mockImplementation(async () => {
      order.push("get-member");
      return state.member;
    });
    staffCounter.countConfirmedStaff.mockImplementation(async () => {
      order.push("count-staff");
      return state.staff;
    });
    listing.findAgendaByIds.mockImplementation(async () => {
      order.push("find-agenda");
      return state.agenda;
    });
    people.findRefsByIds.mockImplementation(async () => {
      order.push("find-people");
      return state.people;
    });

    // The real policy (pure): who reads the note of the queue is part of what it has to get right.
    policy = new PermissionPolicy();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApplicationsService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: LessonsService, useValue: lessons },
        { provide: MembersService, useValue: members },
        { provide: LessonStaffCounterService, useValue: staffCounter },
        { provide: LessonListingService, useValue: listing },
        { provide: PeopleService, useValue: people },
        { provide: PermissionPolicy, useValue: policy },
      ],
    }).compile();

    service = moduleRef.get(ApplicationsService);
  });

  describe("apply()", () => {
    const monitor = applyBody({ role: "monitor" });
    const teacher = applyBody({ role: "teacher" });

    it("creates a pending application of the actor: source application, createdById the member, reviewed and cancelled null", async () => {
      const result = await service.apply(LESSON_ID, monitor, MEMBER);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenCalledWith(LessonAssignment, {
        lessonId: LESSON_ID,
        personId: PERSON_ID,
        role: AssignmentRole.MONITOR,
        status: AssignmentStatus.PENDING,
        source: AssignmentSource.APPLICATION,
        note: null,
        createdById: PERSON_ID,
        reviewedById: null,
        reviewedAt: null,
        cancelledById: null,
        cancelledAt: null,
      });
      expect(result).toEqual({
        id: APPLICATION_ID,
        lessonId: LESSON_ID,
        person: { id: PERSON_ID, name: "Ana Torres" },
        role: AssignmentRole.MONITOR,
        status: AssignmentStatus.PENDING,
        source: AssignmentSource.APPLICATION,
        note: null,
        createdById: PERSON_ID,
        reviewedById: null,
        reviewedAt: null,
        cancelledById: null,
        cancelledAt: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      });
    });

    it("stores the note trimmed, and null when there is none", async () => {
      await service.apply(LESSON_ID, applyBody({ role: "monitor", note: `  ${NOTE}  ` }), MEMBER);
      await service.apply(LESSON_ID, applyBody({ role: "monitor", note: "   " }), MEMBER);
      await service.apply(LESSON_ID, applyBody({ role: "monitor" }), MEMBER);

      expect(manager.create.mock.calls.map((call) => call[1].note)).toEqual([NOTE, null, null]);
    });

    it("reads the lesson and the member FOR SHARE in the transaction, checks the place and the vacancy, then inserts, in this order, and takes no advisory lock", async () => {
      await service.apply(LESSON_ID, monitor, MEMBER);

      expect(order).toEqual([
        "get-lesson",
        "get-member",
        "check-active",
        "count-staff",
        "save",
        "commit",
        "emit-audit",
      ]);
      expect(lessons.getLessonSummary).toHaveBeenCalledWith(LESSON_ID, manager, { forShare: true });
      expect(members.getMemberSummary).toHaveBeenCalledWith(PERSON_ID, manager, {
        forShare: true,
      });
      expect(manager.exists).toHaveBeenCalledWith(LessonAssignment, {
        where: expect.objectContaining({ lessonId: LESSON_ID, personId: PERSON_ID }),
      });
      expect(manager.query).not.toHaveBeenCalled();
    });

    it("takes the applicant from the session, never from the body", async () => {
      const body = applyBody({
        role: "monitor",
        personId: "01999a3e-0000-7000-8000-0000000000ff",
        status: "confirmed",
        source: "direct",
      });

      await service.apply(LESSON_ID, body, MEMBER);

      expect(members.getMemberSummary).toHaveBeenCalledWith(PERSON_ID, manager, {
        forShare: true,
      });
      expect(manager.create).toHaveBeenCalledWith(
        LessonAssignment,
        expect.objectContaining({
          personId: PERSON_ID,
          createdById: PERSON_ID,
          status: AssignmentStatus.PENDING,
          source: AssignmentSource.APPLICATION,
        }),
      );
    });

    it("writes the ids of the database, not the spelling of the URL", async () => {
      state.lesson = buildLesson({ id: LESSON_ID });

      await service.apply(LESSON_ID.toUpperCase(), monitor, MEMBER);

      expect(manager.create).toHaveBeenCalledWith(
        LessonAssignment,
        expect.objectContaining({ lessonId: LESSON_ID }),
      );
    });

    it("counts the confirmed staff inside the transaction (passes the manager)", async () => {
      await service.apply(LESSON_ID, monitor, MEMBER);

      expect(staffCounter.countConfirmedStaff).toHaveBeenCalledTimes(1);
      expect(staffCounter.countConfirmedStaff).toHaveBeenCalledWith([LESSON_ID], manager);
    });

    it("throws 404 LESSON_NOT_FOUND when the lesson does not exist, and reads nothing else", async () => {
      state.lesson = null;

      const failure = await httpFailure(service.apply(LESSON_ID, monitor, MEMBER));

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("LESSON_NOT_FOUND");
      expect(order).toEqual(["get-lesson"]);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws 409 LESSON_CANCELLED before looking at the date or the member", async () => {
      state.lesson = buildLesson({ status: LessonStatus.CANCELLED, date: "2026-03-01" });

      const failure = await httpFailure(service.apply(LESSON_ID, monitor, MEMBER));

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("LESSON_CANCELLED");
      expect(order).toEqual(["get-lesson"]);
    });

    it("throws 409 LESSON_IN_PAST for a lesson before today in America/Sao_Paulo, and accepts today (clock at 02:00 UTC is still yesterday there)", async () => {
      // 2026-03-10 02:00 UTC is 2026-03-09 23:00 in São Paulo: today is still the 9th.
      clock.now.mockReturnValue(new Date("2026-03-10T02:00:00.000Z"));

      state.lesson = buildLesson({ date: "2026-03-08" });
      const failure = await httpFailure(service.apply(LESSON_ID, monitor, MEMBER));
      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("LESSON_IN_PAST");
      expect(members.getMemberSummary).not.toHaveBeenCalled();

      state.lesson = buildLesson({ date: "2026-03-09" });
      await expect(service.apply(LESSON_ID, monitor, MEMBER)).resolves.toMatchObject({
        status: AssignmentStatus.PENDING,
      });
      expect(clock.now).toHaveBeenCalledTimes(2);
    });

    it("throws 409 MEMBER_INACTIVE for a member that is not active and for a person that is no longer a member", async () => {
      state.member = buildMember({ active: false });
      const inactive = await httpFailure(service.apply(LESSON_ID, monitor, MEMBER));

      state.member = null;
      const gone = await httpFailure(service.apply(LESSON_ID, monitor, MEMBER));

      for (const failure of [inactive, gone]) {
        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("MEMBER_INACTIVE");
      }
      expect(manager.exists).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws 409 ALREADY_APPLIED when the member holds a place in the lesson", async () => {
      state.hasActiveAssignment = true;

      const failure = await httpFailure(service.apply(LESSON_ID, teacher, MEMBER));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "ALREADY_APPLIED",
        message: "The member already has an assignment or an application in this lesson.",
      });
      expect(staffCounter.countConfirmedStaff).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws 409 ROLE_FULL for a teacher when the lesson has a confirmed teacher, and for a monitor at or above expectedMonitors, null or 0", async () => {
      const failures: HttpException[] = [];

      state.staff = new Map([[LESSON_ID, { teachers: 1, monitors: 0 }]]);
      failures.push(await httpFailure(service.apply(LESSON_ID, teacher, MEMBER)));

      state.staff = new Map([[LESSON_ID, { teachers: 0, monitors: 2 }]]);
      failures.push(await httpFailure(service.apply(LESSON_ID, monitor, MEMBER)));

      state.staff = new Map([[LESSON_ID, { teachers: 0, monitors: 3 }]]);
      failures.push(await httpFailure(service.apply(LESSON_ID, monitor, MEMBER)));

      state.staff = new Map();
      state.lesson = buildLesson({ expectedMonitors: null });
      failures.push(await httpFailure(service.apply(LESSON_ID, monitor, MEMBER)));

      state.lesson = buildLesson({ expectedMonitors: 0 });
      failures.push(await httpFailure(service.apply(LESSON_ID, monitor, MEMBER)));

      expect(failures.map((failure) => [failure.getStatus(), codeOf(failure)])).toEqual(
        Array.from({ length: 5 }, () => [409, "ROLE_FULL"]),
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("accepts a monitor while the lesson has a confirmed teacher, and a teacher while the monitors are full", async () => {
      state.staff = new Map([[LESSON_ID, { teachers: 1, monitors: 1 }]]);
      await expect(service.apply(LESSON_ID, monitor, MEMBER)).resolves.toMatchObject({
        role: AssignmentRole.MONITOR,
      });

      state.staff = new Map([[LESSON_ID, { teachers: 0, monitors: 2 }]]);
      await expect(service.apply(LESSON_ID, teacher, MEMBER)).resolves.toMatchObject({
        role: AssignmentRole.TEACHER,
      });
    });

    it("does not count pending applications as places: applies to the last monitor place while others are pending", async () => {
      // The counter only counts confirmed assignments: 1 of 2, whatever is pending.
      state.staff = new Map([[LESSON_ID, { teachers: 0, monitors: 1 }]]);

      await expect(service.apply(LESSON_ID, monitor, MEMBER)).resolves.toMatchObject({
        status: AssignmentStatus.PENDING,
      });
      expect(staffCounter.countConfirmedStaff).toHaveBeenCalledTimes(1);
    });

    it("answers the errors in this order: lesson, cancelled, past, member, place, vacancy", async () => {
      state.lesson = null;
      state.member = null;
      state.hasActiveAssignment = true;
      state.staff = new Map([[LESSON_ID, { teachers: 0, monitors: 2 }]]);
      const codes: string[] = [];

      codes.push(codeOf(await httpFailure(service.apply(LESSON_ID, monitor, MEMBER))));
      state.lesson = buildLesson({ status: LessonStatus.CANCELLED, date: "2026-03-01" });
      codes.push(codeOf(await httpFailure(service.apply(LESSON_ID, monitor, MEMBER))));
      state.lesson = buildLesson({ date: "2026-03-01" });
      codes.push(codeOf(await httpFailure(service.apply(LESSON_ID, monitor, MEMBER))));
      state.lesson = buildLesson();
      codes.push(codeOf(await httpFailure(service.apply(LESSON_ID, monitor, MEMBER))));
      state.member = buildMember();
      codes.push(codeOf(await httpFailure(service.apply(LESSON_ID, monitor, MEMBER))));
      state.hasActiveAssignment = false;
      codes.push(codeOf(await httpFailure(service.apply(LESSON_ID, monitor, MEMBER))));

      expect(codes).toEqual([
        "LESSON_NOT_FOUND",
        "LESSON_CANCELLED",
        "LESSON_IN_PAST",
        "MEMBER_INACTIVE",
        "ALREADY_APPLIED",
        "ROLE_FULL",
      ]);
    });

    describe("constraint violations", () => {
      it("maps 23505 on the active index to ALREADY_APPLIED", async () => {
        manager.save.mockRejectedValue(
          violation("23505", "uq_lesson_assignments_lesson_id_person_id_active"),
        );

        const failure = await httpFailure(service.apply(LESSON_ID, monitor, MEMBER));

        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("ALREADY_APPLIED");
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it("maps 23505 on the confirmed teacher index to ROLE_FULL", async () => {
        manager.save.mockRejectedValue(
          violation("23505", "uq_lesson_assignments_lesson_id_confirmed_teacher"),
        );

        const failure = await httpFailure(service.apply(LESSON_ID, teacher, MEMBER));

        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("ROLE_FULL");
      });

      it("maps 23503 on fk_lesson_assignments_lesson_id to LESSON_NOT_FOUND", async () => {
        manager.save.mockRejectedValue(violation("23503", "fk_lesson_assignments_lesson_id"));

        const failure = await httpFailure(service.apply(LESSON_ID, monitor, MEMBER));

        expect(failure.getStatus()).toBe(404);
        expect(codeOf(failure)).toBe("LESSON_NOT_FOUND");
      });

      it("maps 23503 on fk_lesson_assignments_person_id to MEMBER_INACTIVE", async () => {
        manager.save.mockRejectedValue(violation("23503", "fk_lesson_assignments_person_id"));

        const failure = await httpFailure(service.apply(LESSON_ID, monitor, MEMBER));

        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("MEMBER_INACTIVE");
      });

      it("lets any other error through, as it came", async () => {
        const other = violation("23503", "fk_lesson_assignments_created_by_id");
        manager.save.mockRejectedValueOnce(other);
        await expect(service.apply(LESSON_ID, monitor, MEMBER)).rejects.toBe(other);

        const sameCodeOtherIndex = violation("23505", "uq_other_index");
        manager.save.mockRejectedValueOnce(sameCodeOtherIndex);
        await expect(service.apply(LESSON_ID, monitor, MEMBER)).rejects.toBe(sameCodeOtherIndex);

        const failure = new Error("connection lost");
        manager.save.mockRejectedValueOnce(failure);
        await expect(service.apply(LESSON_ID, monitor, MEMBER)).rejects.toBe(failure);
      });
    });

    describe("events", () => {
      it("emits LESSON_ASSIGNMENT_APPLIED once, after the commit, with the member as actor and without the note", async () => {
        await service.apply(LESSON_ID, applyBody({ role: "monitor", note: NOTE }), MEMBER);

        expect(order.indexOf("commit")).toBeLessThan(order.indexOf("emit-audit"));
        const events = auditEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual(
          Object.assign(new AuditableActionEvent(), {
            actorId: PERSON_ID,
            action: AuditableAction.LESSON_ASSIGNMENT_APPLIED,
            targetType: "lesson_assignment",
            targetId: APPLICATION_ID,
            before: null,
            after: {
              lessonId: LESSON_ID,
              personId: PERSON_ID,
              role: AssignmentRole.MONITOR,
              status: AssignmentStatus.PENDING,
              source: AssignmentSource.APPLICATION,
            },
            occurredAt: NOW,
          }),
        );
        expect(JSON.stringify(events[0])).not.toContain(NOTE);
        // One instant for the whole operation: today and the event read the clock once.
        expect(clock.now).toHaveBeenCalledTimes(1);
      });

      it("emits nothing when the transaction fails or the request is refused", async () => {
        state.hasActiveAssignment = true;
        await httpFailure(service.apply(LESSON_ID, monitor, MEMBER));

        dataSource.transaction.mockRejectedValue(new Error("boom"));
        await expect(service.apply(LESSON_ID, monitor, MEMBER)).rejects.toThrow("boom");

        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });
    });

    it("answers the note to its author", async () => {
      const result = await service.apply(
        LESSON_ID,
        applyBody({ role: "monitor", note: NOTE }),
        MEMBER,
      );

      expect(result.note).toBe(NOTE);
    });
  });

  describe("approve()", () => {
    it("approves a pending application: confirmed, reviewedById, reviewedAt and updatedAt at the same instant", async () => {
      const result = await service.approve(APPLICATION_ID, REVIEWER_ID);

      const [saved] = savedApplications();
      expect(saved).toMatchObject({
        id: APPLICATION_ID,
        status: AssignmentStatus.CONFIRMED,
        reviewedById: REVIEWER_ID,
        reviewedAt: NOW,
        updatedAt: NOW,
        source: AssignmentSource.APPLICATION,
      });
      expect(result).toEqual({
        id: APPLICATION_ID,
        lessonId: LESSON_ID,
        person: { id: PERSON_ID, name: "Ana Torres" },
        role: AssignmentRole.MONITOR,
        status: AssignmentStatus.CONFIRMED,
        source: AssignmentSource.APPLICATION,
        note: NOTE,
        createdById: PERSON_ID,
        reviewedById: REVIEWER_ID,
        reviewedAt: NOW,
        cancelledById: null,
        cancelledAt: null,
        createdAt: CREATED_AT,
        updatedAt: NOW,
      });
      expect(clock.now).toHaveBeenCalledTimes(1);
    });

    it("locks the application FOR UPDATE, the lesson and the member FOR SHARE, then the advisory lock of the lesson, then counts again, then saves, in this order", async () => {
      await service.approve(APPLICATION_ID, REVIEWER_ID);

      expect(order).toEqual([
        "load-application",
        "get-lesson",
        "get-member",
        "advisory-lock",
        "count-staff",
        "save",
        "commit",
        "emit-audit",
        "find-people",
      ]);
      expect(manager.findOne).toHaveBeenCalledWith(LessonAssignment, {
        where: { id: APPLICATION_ID, source: AssignmentSource.APPLICATION },
        lock: { mode: "pessimistic_write" },
      });
      expect(lessons.getLessonSummary).toHaveBeenCalledWith(LESSON_ID, manager, {
        forShare: true,
      });
      expect(members.getMemberSummary).toHaveBeenCalledWith(PERSON_ID, manager, {
        forShare: true,
      });
    });

    it("takes the advisory lock with the key assignments.lesson-staff:<lesson id of the database>", async () => {
      // The URL may spell the id in upper case; the lock is keyed by the id the database answers.
      state.lesson = buildLesson({ id: LESSON_ID });

      await service.approve(APPLICATION_ID.toUpperCase(), REVIEWER_ID);

      expect(lessonStaffLockKey(LESSON_ID)).toBe(`assignments.lesson-staff:${LESSON_ID}`);
      expect(manager.query).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `assignments.lesson-staff:${LESSON_ID}`,
      ]);
    });

    it("counts the staff after the advisory lock and inside the transaction", async () => {
      await service.approve(APPLICATION_ID, REVIEWER_ID);

      expect(order.indexOf("advisory-lock")).toBeLessThan(order.indexOf("count-staff"));
      expect(staffCounter.countConfirmedStaff).toHaveBeenCalledTimes(1);
      expect(staffCounter.countConfirmedStaff).toHaveBeenCalledWith([LESSON_ID], manager);
    });

    it("answers 200 without writing when it is already confirmed, and reads neither the lesson nor the member nor the lock", async () => {
      state.application = buildApplication({
        status: AssignmentStatus.CONFIRMED,
        reviewedById: REVIEWER_ID,
        reviewedAt: REVIEWED_AT,
      });

      const result = await service.approve(APPLICATION_ID, "01999a3e-0000-7000-8000-0000000000ee");

      expect(result).toMatchObject({
        status: AssignmentStatus.CONFIRMED,
        reviewedById: REVIEWER_ID,
        reviewedAt: REVIEWED_AT,
      });
      expect(order).toEqual(["load-application", "commit", "find-people"]);
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.query).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 404 APPLICATION_NOT_FOUND when there is no application with that id (asks for source application)", async () => {
      state.application = null;

      const failure = await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "APPLICATION_NOT_FOUND",
        message: "Application not found.",
      });
      expect(manager.findOne).toHaveBeenCalledWith(
        LessonAssignment,
        expect.objectContaining({
          where: { id: APPLICATION_ID, source: AssignmentSource.APPLICATION },
        }),
      );
      expect(order).toEqual(["load-application"]);
    });

    it("throws 409 APPLICATION_NOT_PENDING for a declined and for a cancelled application", async () => {
      for (const status of [AssignmentStatus.DECLINED, AssignmentStatus.CANCELLED]) {
        state.application = buildApplication({ status });

        const failure = await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID));

        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("APPLICATION_NOT_PENDING");
      }
      expect(lessons.getLessonSummary).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws 409 LESSON_CANCELLED, 409 MEMBER_INACTIVE and 409 ROLE_FULL (teacher confirmed; monitors at expected; expected null)", async () => {
      const codes: string[] = [];

      state.lesson = buildLesson({ status: LessonStatus.CANCELLED });
      codes.push(codeOf(await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID))));

      state.lesson = buildLesson();
      state.member = buildMember({ active: false });
      codes.push(codeOf(await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID))));
      state.member = null;
      codes.push(codeOf(await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID))));

      state.member = buildMember();
      state.application = buildApplication({ role: AssignmentRole.TEACHER });
      state.staff = new Map([[LESSON_ID, { teachers: 1, monitors: 0 }]]);
      codes.push(codeOf(await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID))));

      state.application = buildApplication({ role: AssignmentRole.MONITOR });
      state.staff = new Map([[LESSON_ID, { teachers: 0, monitors: 2 }]]);
      codes.push(codeOf(await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID))));

      state.staff = new Map();
      state.lesson = buildLesson({ expectedMonitors: null });
      codes.push(codeOf(await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID))));

      expect(codes).toEqual([
        "LESSON_CANCELLED",
        "MEMBER_INACTIVE",
        "MEMBER_INACTIVE",
        "ROLE_FULL",
        "ROLE_FULL",
        "ROLE_FULL",
      ]);
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("approves a monitor while the lesson has a confirmed teacher, and a teacher while monitors are full", async () => {
      state.staff = new Map([[LESSON_ID, { teachers: 1, monitors: 1 }]]);
      await expect(service.approve(APPLICATION_ID, REVIEWER_ID)).resolves.toMatchObject({
        status: AssignmentStatus.CONFIRMED,
      });

      state.application = buildApplication({ role: AssignmentRole.TEACHER });
      state.staff = new Map([[LESSON_ID, { teachers: 0, monitors: 2 }]]);
      await expect(service.approve(APPLICATION_ID, REVIEWER_ID)).resolves.toMatchObject({
        role: AssignmentRole.TEACHER,
        status: AssignmentStatus.CONFIRMED,
      });
    });

    it("approves an application of a lesson that already happened", async () => {
      state.lesson = buildLesson({ date: "2026-03-02", status: LessonStatus.DONE });

      await expect(service.approve(APPLICATION_ID, REVIEWER_ID)).resolves.toMatchObject({
        status: AssignmentStatus.CONFIRMED,
      });
    });

    it("answers the errors in this order: not pending, cancelled, member, role full", async () => {
      state.application = buildApplication({ status: AssignmentStatus.DECLINED });
      state.lesson = buildLesson({ status: LessonStatus.CANCELLED, expectedMonitors: null });
      state.member = null;
      const codes: string[] = [];

      codes.push(codeOf(await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID))));
      state.application = buildApplication();
      codes.push(codeOf(await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID))));
      state.lesson = buildLesson({ expectedMonitors: null });
      codes.push(codeOf(await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID))));
      state.member = buildMember();
      codes.push(codeOf(await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID))));

      expect(codes).toEqual([
        "APPLICATION_NOT_PENDING",
        "LESSON_CANCELLED",
        "MEMBER_INACTIVE",
        "ROLE_FULL",
      ]);
    });

    it("throws, as a broken invariant, when the lesson of the application is not found", async () => {
      state.lesson = null;

      await expect(service.approve(APPLICATION_ID, REVIEWER_ID)).rejects.toThrow(
        "the foreign key requires it",
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("maps 23505 on the confirmed teacher index to ROLE_FULL: two teachers approved at the same time", async () => {
      state.application = buildApplication({ role: AssignmentRole.TEACHER });
      manager.save.mockRejectedValue(
        violation("23505", "uq_lesson_assignments_lesson_id_confirmed_teacher"),
      );

      const failure = await httpFailure(service.approve(APPLICATION_ID, REVIEWER_ID));

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("ROLE_FULL");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits LESSON_ASSIGNMENT_APPROVED once, after the commit, without the note, and nothing for the no-op", async () => {
      await service.approve(APPLICATION_ID, REVIEWER_ID);

      expect(order.indexOf("commit")).toBeLessThan(order.indexOf("emit-audit"));
      const events = auditEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        Object.assign(new AuditableActionEvent(), {
          actorId: REVIEWER_ID,
          action: AuditableAction.LESSON_ASSIGNMENT_APPROVED,
          targetType: "lesson_assignment",
          targetId: APPLICATION_ID,
          before: { status: AssignmentStatus.PENDING },
          after: {
            status: AssignmentStatus.CONFIRMED,
            reviewedAt: NOW,
            lessonId: LESSON_ID,
            personId: PERSON_ID,
            role: AssignmentRole.MONITOR,
          },
          occurredAt: NOW,
        }),
      );
      expect(JSON.stringify(events[0])).not.toContain(NOTE);

      eventEmitter.emit.mockClear();
      state.application = buildApplication({
        status: AssignmentStatus.CONFIRMED,
        reviewedById: REVIEWER_ID,
        reviewedAt: REVIEWED_AT,
      });
      await service.approve(APPLICATION_ID, REVIEWER_ID);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("reads the name after the commit and answers the note (the route needs assignments.review)", async () => {
      const result = await service.approve(APPLICATION_ID, REVIEWER_ID);

      expect(order.indexOf("commit")).toBeLessThan(order.indexOf("find-people"));
      expect(people.findRefsByIds).toHaveBeenCalledWith([PERSON_ID]);
      expect(result.person).toEqual({ id: PERSON_ID, name: "Ana Torres" });
      expect(result.note).toBe(NOTE);

      state.people = [];
      expect((await service.approve(APPLICATION_ID, REVIEWER_ID)).person).toBeNull();
    });
  });

  describe("reject()", () => {
    it("declines a pending application: declined, reviewedById, reviewedAt and updatedAt", async () => {
      const result = await service.reject(APPLICATION_ID, REVIEWER_ID);

      expect(savedApplications()).toHaveLength(1);
      expect(savedApplications()[0]).toMatchObject({
        status: AssignmentStatus.DECLINED,
        reviewedById: REVIEWER_ID,
        reviewedAt: NOW,
        updatedAt: NOW,
        cancelledById: null,
        cancelledAt: null,
      });
      expect(result).toMatchObject({
        id: APPLICATION_ID,
        person: { id: PERSON_ID, name: "Ana Torres" },
        status: AssignmentStatus.DECLINED,
        reviewedById: REVIEWER_ID,
        reviewedAt: NOW,
        note: NOTE,
      });
      expect(clock.now).toHaveBeenCalledTimes(1);
    });

    it("locks only the application FOR UPDATE: reads neither the lesson nor the member, takes no advisory lock", async () => {
      await service.reject(APPLICATION_ID, REVIEWER_ID);

      expect(order).toEqual(["load-application", "save", "commit", "emit-audit", "find-people"]);
      expect(manager.findOne).toHaveBeenCalledWith(LessonAssignment, {
        where: { id: APPLICATION_ID, source: AssignmentSource.APPLICATION },
        lock: { mode: "pessimistic_write" },
      });
      expect(lessons.getLessonSummary).not.toHaveBeenCalled();
      expect(members.getMemberSummary).not.toHaveBeenCalled();
      expect(manager.query).not.toHaveBeenCalled();
      expect(staffCounter.countConfirmedStaff).not.toHaveBeenCalled();
    });

    it("answers 200 without writing when it is already declined", async () => {
      state.application = buildApplication({
        status: AssignmentStatus.DECLINED,
        reviewedById: REVIEWER_ID,
        reviewedAt: REVIEWED_AT,
      });

      const result = await service.reject(APPLICATION_ID, "01999a3e-0000-7000-8000-0000000000ee");

      expect(result).toMatchObject({
        status: AssignmentStatus.DECLINED,
        reviewedById: REVIEWER_ID,
        reviewedAt: REVIEWED_AT,
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 404 APPLICATION_NOT_FOUND and 409 APPLICATION_NOT_PENDING for a confirmed and for a cancelled one", async () => {
      state.application = null;
      const notFound = await httpFailure(service.reject(APPLICATION_ID, REVIEWER_ID));
      expect(notFound.getStatus()).toBe(404);
      expect(codeOf(notFound)).toBe("APPLICATION_NOT_FOUND");

      for (const status of [AssignmentStatus.CONFIRMED, AssignmentStatus.CANCELLED]) {
        state.application = buildApplication({
          status,
          reviewedById: REVIEWER_ID,
          reviewedAt: NOW,
        });

        const failure = await httpFailure(service.reject(APPLICATION_ID, REVIEWER_ID));

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "APPLICATION_NOT_PENDING",
          message: "Only a pending application can be approved or declined.",
        });
      }
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("emits LESSON_ASSIGNMENT_DECLINED once, after the commit, without the note, and nothing for the no-op", async () => {
      await service.reject(APPLICATION_ID, REVIEWER_ID);

      expect(order.indexOf("commit")).toBeLessThan(order.indexOf("emit-audit"));
      const events = auditEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        Object.assign(new AuditableActionEvent(), {
          actorId: REVIEWER_ID,
          action: AuditableAction.LESSON_ASSIGNMENT_DECLINED,
          targetType: "lesson_assignment",
          targetId: APPLICATION_ID,
          before: { status: AssignmentStatus.PENDING },
          after: {
            status: AssignmentStatus.DECLINED,
            reviewedAt: NOW,
            lessonId: LESSON_ID,
            personId: PERSON_ID,
            role: AssignmentRole.MONITOR,
          },
          occurredAt: NOW,
        }),
      );
      expect(JSON.stringify(events[0])).not.toContain(NOTE);

      eventEmitter.emit.mockClear();
      state.application = buildApplication({
        status: AssignmentStatus.DECLINED,
        reviewedById: REVIEWER_ID,
        reviewedAt: REVIEWED_AT,
      });
      await service.reject(APPLICATION_ID, REVIEWER_ID);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits nothing when the transaction fails", async () => {
      dataSource.transaction.mockRejectedValue(new Error("boom"));

      await expect(service.reject(APPLICATION_ID, REVIEWER_ID)).rejects.toThrow("boom");
      await expect(service.approve(APPLICATION_ID, REVIEWER_ID)).rejects.toThrow("boom");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("listPending()", () => {
    const query = {};

    /** Three applications in two lessons: two in the lesson F1, one in F2. */
    function seedQueue(): void {
      state.applications = [
        buildApplication({ id: "01999a3e-7c1b-7000-8000-0000000000a1", note: NOTE }),
        buildApplication({
          id: "01999a3e-7c1b-7000-8000-0000000000a2",
          lessonId: OTHER_LESSON_ID,
          personId: OTHER_PERSON_ID,
          role: AssignmentRole.TEACHER,
          note: null,
        }),
        buildApplication({
          id: "01999a3e-7c1b-7000-8000-0000000000a3",
          personId: OTHER_PERSON_ID,
          note: "Chego às 14h.",
        }),
      ];
      // The agenda answers the soonest lesson first: F2 before F1.
      state.agenda = [
        buildAgendaRef({ id: OTHER_LESSON_ID, date: "2026-03-09", expectedMonitors: null }),
        buildAgendaRef({ id: LESSON_ID, date: "2026-03-10", expectedMonitors: 3 }),
      ];
      state.staff = new Map([[LESSON_ID, { teachers: 1, monitors: 2 }]]);
      state.people = [
        { id: PERSON_ID, name: "Ana Torres" },
        { id: OTHER_PERSON_ID, name: "Bruno Lima" },
      ];
    }

    it("reads the applications with source application and status pending, oldest first", async () => {
      await service.listPending(query, COORDINATOR);

      expect(dataSource.getRepository).toHaveBeenCalledWith(LessonAssignment);
      expect(applicationRepository.find).toHaveBeenCalledWith({
        where: { source: AssignmentSource.APPLICATION, status: AssignmentStatus.PENDING },
        order: { createdAt: "ASC", id: "ASC" },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("answers { total: 0, lessons: [] } and reads nothing else when there is none", async () => {
      await expect(service.listPending(query, COORDINATOR)).resolves.toEqual({
        total: 0,
        lessons: [],
      });

      expect(order).toEqual(["find-applications"]);
    });

    it("groups them by lesson in the order of the agenda, with the coverage counted over confirmed only", async () => {
      seedQueue();

      const result = await service.listPending(query, COORDINATOR);

      expect(result.lessons.map((group) => group.lesson.id)).toEqual([OTHER_LESSON_ID, LESSON_ID]);
      expect(result.lessons[0]).toEqual({
        lesson: {
          id: OTHER_LESSON_ID,
          title: "Arquivos e pastas",
          date: "2026-03-09",
          startTime: "14:00",
          endTime: "15:30",
          status: LessonStatus.PLANNED,
          sequenceOrder: 3,
          location: "Laboratório 2",
          class: { id: CLASS_ID, code: "INFO-A", name: "Informática Básica, turma A" },
        },
        coverage: {
          teacher: { confirmed: 0, expected: 1 },
          monitors: { confirmed: 0, expected: null },
        },
        applications: [
          expect.objectContaining({
            id: "01999a3e-7c1b-7000-8000-0000000000a2",
            person: { id: OTHER_PERSON_ID, name: "Bruno Lima" },
            role: AssignmentRole.TEACHER,
            note: null,
            createdAt: CREATED_AT,
          }),
        ],
      });
      expect(result.lessons[1].coverage).toEqual({
        teacher: { confirmed: 1, expected: 1 },
        monitors: { confirmed: 2, expected: 3 },
      });
      // Inside a lesson, in the order of the read: the oldest application first.
      expect(result.lessons[1].applications.map((application) => application.id)).toEqual([
        "01999a3e-7c1b-7000-8000-0000000000a1",
        "01999a3e-7c1b-7000-8000-0000000000a3",
      ]);
      expect(result.lessons[1].applications.map((application) => application.note)).toEqual([
        NOTE,
        "Chego às 14h.",
      ]);
    });

    it("asks the agenda, the staff and the names once each, whatever the number of applications", async () => {
      seedQueue();

      await service.listPending(query, COORDINATOR);

      expect(order).toEqual(["find-applications", "find-agenda", "count-staff", "find-people"]);
      expect(listing.findAgendaByIds).toHaveBeenCalledWith([LESSON_ID, OTHER_LESSON_ID]);
      expect(staffCounter.countConfirmedStaff).toHaveBeenCalledWith([LESSON_ID, OTHER_LESSON_ID]);
      expect(people.findRefsByIds).toHaveBeenCalledWith([PERSON_ID, OTHER_PERSON_ID]);
    });

    it("counts in total the applications it lists, and leaves out one whose lesson does not come back", async () => {
      seedQueue();
      // The lesson F1 does not come back (a soft-deleted lesson): its two applications are not listed.
      state.agenda = [buildAgendaRef({ id: OTHER_LESSON_ID })];

      const result = await service.listPending(query, COORDINATOR);

      expect(result.total).toBe(1);
      expect(result.lessons).toHaveLength(1);
      expect(result.lessons[0].applications).toHaveLength(1);

      state.agenda = [buildAgendaRef({ id: OTHER_LESSON_ID }), buildAgendaRef({ id: LESSON_ID })];
      expect((await service.listPending(query, COORDINATOR)).total).toBe(3);
    });

    it("throws, as a broken invariant, when the agenda answers a lesson that was not asked for", async () => {
      seedQueue();
      state.agenda = [
        ...state.agenda,
        buildAgendaRef({ id: "01999a3e-7c1b-7000-8000-0000000000f9" }),
      ];

      await expect(service.listPending(query, COORDINATOR)).rejects.toThrow("was not asked for");
    });

    it("answers person null for a person that is gone", async () => {
      seedQueue();
      state.people = [{ id: PERSON_ID, name: "Ana Torres" }];

      const result = await service.listPending(query, COORDINATOR);

      expect(result.lessons[0].applications[0].person).toBeNull();
    });

    it("asks the policy for assignments.review once, and answers note null when it denies", async () => {
      seedQueue();
      const can = jest.spyOn(policy, "can");

      const forCoordinator = await service.listPending(query, COORDINATOR);
      expect(can).toHaveBeenCalledTimes(1);
      expect(can).toHaveBeenCalledWith(COORDINATOR, Permission.ASSIGNMENTS_REVIEW);
      expect(forCoordinator.lessons[1].applications[0].note).toBe(NOTE);

      can.mockClear();
      const forMember = await service.listPending(query, MEMBER);
      expect(can).toHaveBeenCalledTimes(1);
      expect(
        forMember.lessons.flatMap((group) => group.applications.map((item) => item.note)),
      ).toEqual([null, null, null]);
    });
  });
});
