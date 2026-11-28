import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, QueryFailedError } from "typeorm";
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
import { CreateAssignmentDto } from "../dto/create-assignment.dto";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatusReason } from "../enums/assignment-status-reason.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { AssignmentsService } from "../services/assignments.service";

/** 09:00 in São Paulo: today is 2026-03-09 there. */
const NOW = new Date("2026-03-09T12:00:00.000Z");
/** A lesson day before today in São Paulo. */
const PAST_DAY = "2026-03-02";
const CREATED_AT = new Date("2026-03-01T12:00:00.000Z");
const REVIEWED_AT = new Date("2026-03-02T12:00:00.000Z");

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const OTHER_ACTOR_ID = "01999a3e-0000-7000-8000-0000000000ab";
const PERSON_ID = "01999a3e-0000-7000-8000-0000000000b1";
const OTHER_PERSON_ID = "01999a3e-0000-7000-8000-0000000000b2";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const OTHER_LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f2";
const THIRD_LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f3";
const ASSIGNMENT_ID = "01999a3e-7c1b-7000-8000-0000000000a1";
const DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000001";
const OTHER_DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000002";

const NOTE = "Cobre a segunda hora da aula.";

const COORDINATOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000c0",
  role: Role.COORDINATOR,
  accessEnabled: true,
  departmentIds: [],
};
const SUPERADMIN: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000c1",
  role: Role.SUPERADMIN,
  accessEnabled: true,
  departmentIds: [],
};
const DIRECTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000d0",
  role: Role.DIRECTOR,
  accessEnabled: true,
  departmentIds: [DEPARTMENT_ID],
};
const DIRECTOR_OF_OTHER_DEPARTMENT: AuthUser = {
  ...DIRECTOR,
  departmentIds: [OTHER_DEPARTMENT_ID],
};
const DIRECTOR_WITHOUT_DEPARTMENT: AuthUser = { ...DIRECTOR, departmentIds: [] };
const MEMBER: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000e0",
  role: Role.MEMBER,
  accessEnabled: true,
  departmentIds: [DEPARTMENT_ID],
};

function buildAssignment(overrides: Partial<LessonAssignment> = {}): LessonAssignment {
  return Object.assign(new LessonAssignment(), {
    id: ASSIGNMENT_ID,
    lessonId: LESSON_ID,
    personId: PERSON_ID,
    role: AssignmentRole.MONITOR,
    status: AssignmentStatus.PENDING,
    source: AssignmentSource.DIRECT,
    note: null,
    createdById: ACTOR_ID,
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

function confirmed(overrides: Partial<LessonAssignment> = {}): LessonAssignment {
  return buildAssignment({
    status: AssignmentStatus.CONFIRMED,
    reviewedById: OTHER_ACTOR_ID,
    reviewedAt: REVIEWED_AT,
    ...overrides,
  });
}

function buildLesson(overrides: Partial<LessonSummary> = {}): LessonSummary {
  return {
    id: LESSON_ID,
    classId: CLASS_ID,
    title: "Teclado, mouse e janelas",
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
    name: "Monitor Um",
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

describe("AssignmentsService", () => {
  let service: AssignmentsService;
  let policy: PermissionPolicy;
  let order: string[];
  let state: {
    lesson: LessonSummary | null;
    member: MemberSummary | null;
    assignment: LessonAssignment | null;
    hasActiveAssignment: boolean;
    hasConfirmedTeacher: boolean;
    people: PersonRefDto[];
    assignmentsFound: LessonAssignment[];
    lessonSummaries: LessonSummary[];
  };

  const manager = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    exists: jest.fn(),
    update: jest.fn(),
  };
  const assignmentRepository = { find: jest.fn() };
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  const lessons = { getLessonSummary: jest.fn(), findLessonSummaries: jest.fn() };
  const members = { getMemberSummary: jest.fn() };
  const people = { findRefsByIds: jest.fn() };

  function auditEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls
      .filter((call) => call[0] === AUDITABLE_ACTION_EVENT)
      .map((call) => call[1] as AuditableActionEvent);
  }

  /** The assignments that were written one by one (a confirmation, a cancellation). */
  function savedAssignments(): LessonAssignment[] {
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
      assignment: buildAssignment(),
      hasActiveAssignment: false,
      hasConfirmedTeacher: false,
      people: [{ id: PERSON_ID, name: "Monitor Um" }],
      assignmentsFound: [],
      lessonSummaries: [],
    };

    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), {
        id: ASSIGNMENT_ID,
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
      order.push("load-assignment");
      return state.assignment;
    });
    manager.update.mockImplementation(async () => {
      order.push("expire-application");
      return { affected: 1 };
    });
    manager.exists.mockImplementation(
      async (_target: unknown, options: { where: Record<string, unknown> }) => {
        // The check of the teacher is the one that names a role; the other one names the person.
        if (options.where.role !== undefined) {
          order.push("check-teacher");
          return state.hasConfirmedTeacher;
        }
        order.push("check-active");
        return state.hasActiveAssignment;
      },
    );
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => Promise<unknown>) => {
        const result = await callback(manager);
        order.push("commit");
        return result;
      },
    );
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === LessonAssignment ? assignmentRepository : undefined,
    );
    assignmentRepository.find.mockImplementation(async () => state.assignmentsFound);
    eventEmitter.emit.mockImplementation(() => {
      order.push("emit-audit");
      return true;
    });
    clock.now.mockReturnValue(NOW);
    lessons.getLessonSummary.mockImplementation(async () => {
      order.push("get-lesson");
      return state.lesson;
    });
    lessons.findLessonSummaries.mockImplementation(async () => {
      order.push("find-lessons");
      return state.lessonSummaries;
    });
    members.getMemberSummary.mockImplementation(async () => {
      order.push("get-member");
      return state.member;
    });
    people.findRefsByIds.mockImplementation(async () => {
      order.push("find-people");
      return state.people;
    });

    // The real policy (pure): the scope rules are part of what listByMember has to get right.
    policy = new PermissionPolicy();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: LessonsService, useValue: lessons },
        { provide: MembersService, useValue: members },
        { provide: PeopleService, useValue: people },
        { provide: PermissionPolicy, useValue: policy },
      ],
    }).compile();

    service = moduleRef.get(AssignmentsService);
  });

  describe("create()", () => {
    const dto: CreateAssignmentDto = {
      personId: PERSON_ID,
      role: AssignmentRole.MONITOR,
      status: AssignmentStatus.PENDING,
    };

    it("creates a direct assignment with createdById set to the actor", async () => {
      const result = await service.create(LESSON_ID, dto, ACTOR_ID);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenCalledWith(LessonAssignment, {
        lessonId: LESSON_ID,
        personId: PERSON_ID,
        role: AssignmentRole.MONITOR,
        status: AssignmentStatus.PENDING,
        source: AssignmentSource.DIRECT,
        note: null,
        createdById: ACTOR_ID,
        reviewedById: null,
        reviewedAt: null,
        cancelledById: null,
        cancelledAt: null,
      });
      expect(result).toEqual({
        id: ASSIGNMENT_ID,
        lessonId: LESSON_ID,
        person: { id: PERSON_ID, name: "Monitor Um" },
        role: AssignmentRole.MONITOR,
        status: AssignmentStatus.PENDING,
        statusReason: null,
        source: AssignmentSource.DIRECT,
        note: null,
        createdById: ACTOR_ID,
        reviewedById: null,
        reviewedAt: null,
        cancelledById: null,
        cancelledAt: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      });
    });

    it("creates a pending assignment with reviewedAt null", async () => {
      const result = await service.create(LESSON_ID, dto, ACTOR_ID);

      expect(result.status).toBe(AssignmentStatus.PENDING);
      expect(result.reviewedById).toBeNull();
      expect(result.reviewedAt).toBeNull();
    });

    it("creates a confirmed assignment with reviewedById the actor and reviewedAt now", async () => {
      const result = await service.create(
        LESSON_ID,
        { ...dto, status: AssignmentStatus.CONFIRMED },
        ACTOR_ID,
      );

      expect(manager.create).toHaveBeenCalledWith(
        LessonAssignment,
        expect.objectContaining({
          status: AssignmentStatus.CONFIRMED,
          reviewedById: ACTOR_ID,
          reviewedAt: NOW,
        }),
      );
      expect(result.status).toBe(AssignmentStatus.CONFIRMED);
      expect(result.reviewedById).toBe(ACTOR_ID);
      expect(result.reviewedAt).toEqual(NOW);
    });

    it("creates a teacher and a monitor with the role it was asked", async () => {
      for (const role of Object.values(AssignmentRole)) {
        const result = await service.create(LESSON_ID, { ...dto, role }, ACTOR_ID);

        expect(result.role).toBe(role);
      }
    });

    it("stores the note it receives, and null when there is none", async () => {
      const withNote = await service.create(LESSON_ID, { ...dto, note: NOTE }, ACTOR_ID);
      const withNull = await service.create(LESSON_ID, { ...dto, note: null }, ACTOR_ID);
      const without = await service.create(LESSON_ID, dto, ACTOR_ID);

      expect(withNote.note).toBe(NOTE);
      expect(withNull.note).toBeNull();
      expect(without.note).toBeNull();
    });

    it("reads the lesson and then the member, both FOR SHARE and in the transaction, before the checks and the insert", async () => {
      await service.create(LESSON_ID, dto, ACTOR_ID);

      expect(lessons.getLessonSummary).toHaveBeenCalledWith(LESSON_ID, manager, {
        forShare: true,
      });
      expect(members.getMemberSummary).toHaveBeenCalledWith(PERSON_ID, manager, {
        forShare: true,
      });
      expect(order).toEqual([
        "get-lesson",
        "get-member",
        "check-active",
        "save",
        "commit",
        "emit-audit",
      ]);
    });

    it("checks whether the lesson has a confirmed teacher only for a teacher asked confirmed", async () => {
      await service.create(
        LESSON_ID,
        { ...dto, role: AssignmentRole.TEACHER, status: AssignmentStatus.CONFIRMED },
        ACTOR_ID,
      );
      expect(order).toContain("check-teacher");

      for (const other of [
        { role: AssignmentRole.TEACHER, status: AssignmentStatus.PENDING },
        { role: AssignmentRole.MONITOR, status: AssignmentStatus.CONFIRMED },
        { role: AssignmentRole.MONITOR, status: AssignmentStatus.PENDING },
      ]) {
        order.length = 0;

        await service.create(LESSON_ID, { ...dto, ...other }, ACTOR_ID);

        expect(order).not.toContain("check-teacher");
      }
    });

    it("stores the ids of the database, not the way the request spells them", async () => {
      state.lesson = buildLesson({ id: LESSON_ID });
      state.member = buildMember({ id: PERSON_ID });

      await service.create(
        LESSON_ID.toUpperCase(),
        { ...dto, personId: PERSON_ID.toUpperCase() },
        ACTOR_ID,
      );

      expect(manager.create).toHaveBeenCalledWith(
        LessonAssignment,
        expect.objectContaining({ lessonId: LESSON_ID, personId: PERSON_ID }),
      );
    });

    describe("an application of a lesson before today (GUS-179)", () => {
      const overdue = () =>
        buildAssignment({
          id: "01999a3e-7c1b-7000-8000-0000000000a9",
          status: AssignmentStatus.PENDING,
          source: AssignmentSource.APPLICATION,
        });

      it("writes the pending application of the member expired, then checks the place and creates the assignment", async () => {
        state.lesson = buildLesson({ date: PAST_DAY });
        state.assignment = overdue();

        await service.create(LESSON_ID, dto, ACTOR_ID);

        expect(manager.findOne).toHaveBeenCalledWith(LessonAssignment, {
          where: {
            lessonId: LESSON_ID,
            personId: PERSON_ID,
            source: AssignmentSource.APPLICATION,
            status: AssignmentStatus.PENDING,
          },
        });
        expect(manager.update).toHaveBeenCalledWith(
          LessonAssignment,
          { id: "01999a3e-7c1b-7000-8000-0000000000a9", status: AssignmentStatus.PENDING },
          { status: AssignmentStatus.EXPIRED, updatedAt: NOW },
        );
        expect(order).toEqual([
          "get-lesson",
          "get-member",
          "load-assignment",
          "expire-application",
          "check-active",
          "save",
          "commit",
          "emit-audit",
          "emit-audit",
        ]);
      });

      it("emits LESSON_ASSIGNMENT_EXPIRED and then LESSON_ASSIGNMENT_CREATED, after the commit, with the actor", async () => {
        state.lesson = buildLesson({ date: PAST_DAY });
        state.assignment = overdue();

        await service.create(LESSON_ID, dto, ACTOR_ID);

        const [expired, created] = auditEvents();
        expect(expired).toEqual(
          Object.assign(new AuditableActionEvent(), {
            actorId: ACTOR_ID,
            action: AuditableAction.LESSON_ASSIGNMENT_EXPIRED,
            targetType: "lesson_assignment",
            targetId: "01999a3e-7c1b-7000-8000-0000000000a9",
            before: { status: AssignmentStatus.PENDING },
            after: {
              status: AssignmentStatus.EXPIRED,
              lessonId: LESSON_ID,
              personId: PERSON_ID,
              role: AssignmentRole.MONITOR,
              statusReason: null,
            },
            occurredAt: NOW,
          }),
        );
        expect(created.action).toBe(AuditableAction.LESSON_ASSIGNMENT_CREATED);
        expect(created.targetId).toBe(ASSIGNMENT_ID);
      });

      it("creates as before in a lesson before today where the member has no pending application", async () => {
        state.lesson = buildLesson({ date: PAST_DAY });
        state.assignment = null;

        await service.create(LESSON_ID, dto, ACTOR_ID);

        expect(manager.update).not.toHaveBeenCalled();
        expect(auditEvents().map((event) => event.action)).toEqual([
          AuditableAction.LESSON_ASSIGNMENT_CREATED,
        ]);
      });

      it("looks for no application in a lesson of today or later: a pending one still waits for its review", async () => {
        for (const date of ["2026-03-09", "2026-03-10"]) {
          state.lesson = buildLesson({ date });

          await service.create(LESSON_ID, dto, ACTOR_ID);
        }

        expect(manager.findOne).not.toHaveBeenCalled();
        expect(manager.update).not.toHaveBeenCalled();
      });

      it("emits nothing when the creation is refused after the application expired: the transaction is undone", async () => {
        state.lesson = buildLesson({ date: PAST_DAY });
        state.assignment = overdue();
        state.hasActiveAssignment = true;

        const failure = await httpFailure(service.create(LESSON_ID, dto, ACTOR_ID));

        expect(codeOf(failure)).toBe("DUPLICATE_ROLE_IN_LESSON");
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });
    });

    describe("errors", () => {
      it("throws 404 LESSON_NOT_FOUND when the lesson does not exist, and reads nothing else", async () => {
        state.lesson = null;

        const failure = await httpFailure(service.create(LESSON_ID, dto, ACTOR_ID));

        expect(failure.getStatus()).toBe(404);
        expect(failure.getResponse()).toEqual({
          error: "LESSON_NOT_FOUND",
          message: "Lesson not found.",
        });
        expect(members.getMemberSummary).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it("throws 409 LESSON_CANCELLED for a cancelled lesson, before looking at the member", async () => {
        state.lesson = buildLesson({ status: LessonStatus.CANCELLED });

        const failure = await httpFailure(service.create(LESSON_ID, dto, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "LESSON_CANCELLED",
          message: "Cancelled lessons cannot receive assignments.",
        });
        expect(members.getMemberSummary).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
      });

      it.each([LessonStatus.PLANNED, LessonStatus.CONFIRMED, LessonStatus.DONE])(
        "accepts an assignment in a %s lesson: only a cancelled one is refused",
        async (status) => {
          state.lesson = buildLesson({ status });

          const result = await service.create(LESSON_ID, dto, ACTOR_ID);

          expect(result.lessonId).toBe(LESSON_ID);
        },
      );

      it("throws 400 MEMBER_NOT_FOUND with details.field personId when the person is not a member", async () => {
        state.member = null;

        const failure = await httpFailure(service.create(LESSON_ID, dto, ACTOR_ID));

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toEqual({
          error: "MEMBER_NOT_FOUND",
          message: "Member not found.",
          details: [{ field: "personId", message: "personId does not match any member" }],
        });
        expect(manager.exists).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
      });

      it("throws 409 MEMBER_INACTIVE for a member that is not active, before the checks of the places", async () => {
        state.member = buildMember({ active: false });

        const failure = await httpFailure(service.create(LESSON_ID, dto, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "MEMBER_INACTIVE",
          message: "Inactive members cannot receive assignments.",
        });
        expect(manager.exists).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
      });

      it("throws 409 DUPLICATE_ROLE_IN_LESSON when the member already holds a place in the lesson, whatever the role", async () => {
        state.hasActiveAssignment = true;

        for (const role of Object.values(AssignmentRole)) {
          const failure = await httpFailure(service.create(LESSON_ID, { ...dto, role }, ACTOR_ID));

          expect(failure.getStatus()).toBe(409);
          expect(failure.getResponse()).toEqual({
            error: "DUPLICATE_ROLE_IN_LESSON",
            message: "The member already has an active assignment in this lesson.",
          });
        }
        expect(manager.save).not.toHaveBeenCalled();
      });

      it("asks for the active assignments of this member in this lesson, pending and confirmed only", async () => {
        await service.create(LESSON_ID, dto, ACTOR_ID);

        expect(manager.exists).toHaveBeenCalledWith(LessonAssignment, {
          where: {
            lessonId: LESSON_ID,
            personId: PERSON_ID,
            status: expect.objectContaining({
              _type: "in",
              _value: [AssignmentStatus.PENDING, AssignmentStatus.CONFIRMED],
            }),
          },
        });
      });

      it("throws 409 LESSON_TEACHER_TAKEN for a second confirmed teacher", async () => {
        state.hasConfirmedTeacher = true;

        const failure = await httpFailure(
          service.create(
            LESSON_ID,
            { ...dto, role: AssignmentRole.TEACHER, status: AssignmentStatus.CONFIRMED },
            ACTOR_ID,
          ),
        );

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "LESSON_TEACHER_TAKEN",
          message: "The lesson already has a confirmed teacher.",
        });
        expect(manager.save).not.toHaveBeenCalled();
        expect(manager.exists).toHaveBeenCalledWith(LessonAssignment, {
          where: {
            lessonId: LESSON_ID,
            role: AssignmentRole.TEACHER,
            status: AssignmentStatus.CONFIRMED,
          },
        });
      });

      it("accepts a second pending teacher and a confirmed monitor while the lesson has a confirmed teacher", async () => {
        state.hasConfirmedTeacher = true;

        const pendingTeacher = await service.create(
          LESSON_ID,
          { ...dto, role: AssignmentRole.TEACHER, status: AssignmentStatus.PENDING },
          ACTOR_ID,
        );
        const confirmedMonitor = await service.create(
          LESSON_ID,
          { ...dto, role: AssignmentRole.MONITOR, status: AssignmentStatus.CONFIRMED },
          ACTOR_ID,
        );

        expect(pendingTeacher.role).toBe(AssignmentRole.TEACHER);
        expect(confirmedMonitor.status).toBe(AssignmentStatus.CONFIRMED);
      });

      it("answers the errors in this order: the lesson, the member, the place, the teacher", async () => {
        const teacher = {
          ...dto,
          role: AssignmentRole.TEACHER,
          status: AssignmentStatus.CONFIRMED,
        };
        state.lesson = buildLesson({ status: LessonStatus.CANCELLED });
        state.member = buildMember({ active: false });
        state.hasActiveAssignment = true;
        state.hasConfirmedTeacher = true;

        expect(codeOf(await httpFailure(service.create(LESSON_ID, teacher, ACTOR_ID)))).toBe(
          "LESSON_CANCELLED",
        );
        state.lesson = null;
        expect(codeOf(await httpFailure(service.create(LESSON_ID, teacher, ACTOR_ID)))).toBe(
          "LESSON_NOT_FOUND",
        );
        state.lesson = buildLesson();
        state.member = null;
        expect(codeOf(await httpFailure(service.create(LESSON_ID, teacher, ACTOR_ID)))).toBe(
          "MEMBER_NOT_FOUND",
        );
        state.member = buildMember({ active: false });
        expect(codeOf(await httpFailure(service.create(LESSON_ID, teacher, ACTOR_ID)))).toBe(
          "MEMBER_INACTIVE",
        );
        state.member = buildMember();
        expect(codeOf(await httpFailure(service.create(LESSON_ID, teacher, ACTOR_ID)))).toBe(
          "DUPLICATE_ROLE_IN_LESSON",
        );
        state.hasActiveAssignment = false;
        expect(codeOf(await httpFailure(service.create(LESSON_ID, teacher, ACTOR_ID)))).toBe(
          "LESSON_TEACHER_TAKEN",
        );
      });
    });

    describe("constraint violations", () => {
      it("maps 23505 on uq_lesson_assignments_lesson_id_person_id_active to DUPLICATE_ROLE_IN_LESSON", async () => {
        manager.save.mockRejectedValue(
          violation("23505", "uq_lesson_assignments_lesson_id_person_id_active"),
        );

        const failure = await httpFailure(service.create(LESSON_ID, dto, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("DUPLICATE_ROLE_IN_LESSON");
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it("maps 23505 on uq_lesson_assignments_lesson_id_confirmed_teacher to LESSON_TEACHER_TAKEN", async () => {
        manager.save.mockRejectedValue(
          violation("23505", "uq_lesson_assignments_lesson_id_confirmed_teacher"),
        );

        const failure = await httpFailure(
          service.create(
            LESSON_ID,
            { ...dto, role: AssignmentRole.TEACHER, status: AssignmentStatus.CONFIRMED },
            ACTOR_ID,
          ),
        );

        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("LESSON_TEACHER_TAKEN");
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it("maps 23503 on fk_lesson_assignments_person_id to MEMBER_NOT_FOUND (400)", async () => {
        manager.save.mockRejectedValue(violation("23503", "fk_lesson_assignments_person_id"));

        const failure = await httpFailure(service.create(LESSON_ID, dto, ACTOR_ID));

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({
          error: "MEMBER_NOT_FOUND",
          details: [expect.objectContaining({ field: "personId" })],
        });
      });

      it("maps 23503 on fk_lesson_assignments_lesson_id to LESSON_NOT_FOUND (404)", async () => {
        manager.save.mockRejectedValue(violation("23503", "fk_lesson_assignments_lesson_id"));

        const failure = await httpFailure(service.create(LESSON_ID, dto, ACTOR_ID));

        expect(failure.getStatus()).toBe(404);
        expect(codeOf(failure)).toBe("LESSON_NOT_FOUND");
      });

      it("lets any other violation through, as it came", async () => {
        const other = violation("23503", "fk_lesson_assignments_created_by_id");
        manager.save.mockRejectedValue(other);

        await expect(service.create(LESSON_ID, dto, ACTOR_ID)).rejects.toBe(other);
      });

      it("lets an error that is not a database violation through, as it came", async () => {
        const failure = new Error("connection lost");
        manager.save.mockRejectedValue(failure);

        await expect(service.create(LESSON_ID, dto, ACTOR_ID)).rejects.toBe(failure);
      });
    });

    describe("events", () => {
      it("emits LESSON_ASSIGNMENT_CREATED once, after the commit, without the note", async () => {
        await service.create(LESSON_ID, { ...dto, note: NOTE }, ACTOR_ID);

        expect(order.indexOf("commit")).toBeLessThan(order.indexOf("emit-audit"));
        const events = auditEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          actorId: ACTOR_ID,
          action: AuditableAction.LESSON_ASSIGNMENT_CREATED,
          targetType: "lesson_assignment",
          targetId: ASSIGNMENT_ID,
          before: null,
          after: {
            lessonId: LESSON_ID,
            personId: PERSON_ID,
            role: AssignmentRole.MONITOR,
            status: AssignmentStatus.PENDING,
            source: AssignmentSource.DIRECT,
          },
          occurredAt: NOW,
        });
        expect(JSON.stringify(events[0])).not.toContain(NOTE);
        expect(Object.keys(events[0].after)).not.toContain("note");
      });

      it("emits nothing when the transaction fails", async () => {
        dataSource.transaction.mockRejectedValue(new Error("boom"));

        await expect(service.create(LESSON_ID, dto, ACTOR_ID)).rejects.toThrow("boom");

        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it("emits nothing for a request that is refused", async () => {
        state.hasActiveAssignment = true;

        await httpFailure(service.create(LESSON_ID, dto, ACTOR_ID));

        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });
    });
  });

  describe("listByLesson()", () => {
    it("throws 404 LESSON_NOT_FOUND when the lesson does not exist, and reads no assignment", async () => {
      state.lesson = null;

      const failure = await httpFailure(service.listByLesson(LESSON_ID, DIRECTOR));

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("LESSON_NOT_FOUND");
      expect(assignmentRepository.find).not.toHaveBeenCalled();
    });

    it("lists every status, ordered by role, status, when it was made and id", async () => {
      await service.listByLesson(LESSON_ID, DIRECTOR);

      expect(assignmentRepository.find).toHaveBeenCalledWith({
        where: { lessonId: LESSON_ID },
        order: { role: "ASC", status: "ASC", createdAt: "ASC", id: "ASC" },
      });
    });

    it("answers the assignments with the id and the name of each member, from one lookup of names", async () => {
      state.assignmentsFound = [
        confirmed({ id: "01999a3e-7c1b-7000-8000-0000000000a1", role: AssignmentRole.TEACHER }),
        buildAssignment({
          id: "01999a3e-7c1b-7000-8000-0000000000a2",
          personId: OTHER_PERSON_ID,
          note: NOTE,
        }),
      ];
      state.people = [
        { id: PERSON_ID, name: "Monitor Um" },
        { id: OTHER_PERSON_ID, name: "Monitor Dois" },
      ];

      const result = await service.listByLesson(LESSON_ID, COORDINATOR);

      expect(people.findRefsByIds).toHaveBeenCalledTimes(1);
      expect(people.findRefsByIds).toHaveBeenCalledWith([PERSON_ID, OTHER_PERSON_ID]);
      expect(result.map((item) => item.person)).toEqual([
        { id: PERSON_ID, name: "Monitor Um" },
        { id: OTHER_PERSON_ID, name: "Monitor Dois" },
      ]);
      expect(result[0]).toMatchObject({
        id: "01999a3e-7c1b-7000-8000-0000000000a1",
        lessonId: LESSON_ID,
        role: AssignmentRole.TEACHER,
        status: AssignmentStatus.CONFIRMED,
        reviewedById: OTHER_ACTOR_ID,
        reviewedAt: REVIEWED_AT,
      });
      expect(result[1].note).toBe(NOTE);
    });

    it("answers person null for a person that was removed", async () => {
      state.assignmentsFound = [buildAssignment()];
      state.people = [];

      const result = await service.listByLesson(LESSON_ID, DIRECTOR);

      expect(result).toHaveLength(1);
      expect(result[0].person).toBeNull();
    });

    it("answers an empty list for a lesson with nobody assigned, without asking for names", async () => {
      state.assignmentsFound = [];

      await expect(service.listByLesson(LESSON_ID, DIRECTOR)).resolves.toEqual([]);

      expect(people.findRefsByIds).not.toHaveBeenCalled();
    });

    it("shows the declined and the cancelled ones too", async () => {
      state.assignmentsFound = [
        buildAssignment({ status: AssignmentStatus.DECLINED }),
        buildAssignment({
          id: "01999a3e-7c1b-7000-8000-0000000000a2",
          status: AssignmentStatus.CANCELLED,
          cancelledAt: NOW,
          cancelledById: ACTOR_ID,
        }),
      ];

      const result = await service.listByLesson(LESSON_ID, DIRECTOR);

      expect(result.map((item) => item.status)).toEqual([
        AssignmentStatus.DECLINED,
        AssignmentStatus.CANCELLED,
      ]);
    });

    it("answers expired for a pending application of a lesson before today, and keeps a pending direct one pending (GUS-179)", async () => {
      state.lesson = buildLesson({ date: PAST_DAY });
      state.assignmentsFound = [
        buildAssignment({ source: AssignmentSource.APPLICATION }),
        buildAssignment({ id: "01999a3e-7c1b-7000-8000-0000000000a2" }),
      ];

      const result = await service.listByLesson(LESSON_ID, DIRECTOR);

      expect(result.map((item) => item.status)).toEqual([
        AssignmentStatus.EXPIRED,
        AssignmentStatus.PENDING,
      ]);
    });

    it("answers the assignments the cancellation of the lesson ended with their reason (GUS-179)", async () => {
      state.lesson = buildLesson({ status: LessonStatus.CANCELLED });
      state.assignmentsFound = [
        buildAssignment({
          status: AssignmentStatus.CANCELLED,
          cancelledAt: NOW,
          cancelledById: ACTOR_ID,
          statusReason: AssignmentStatusReason.LESSON_CANCELLED,
        }),
        buildAssignment({
          id: "01999a3e-7c1b-7000-8000-0000000000a2",
          source: AssignmentSource.APPLICATION,
          status: AssignmentStatus.EXPIRED,
          statusReason: AssignmentStatusReason.LESSON_CANCELLED,
        }),
      ];

      const result = await service.listByLesson(LESSON_ID, DIRECTOR);

      expect(result.map((item) => [item.status, item.statusReason])).toEqual([
        [AssignmentStatus.CANCELLED, AssignmentStatusReason.LESSON_CANCELLED],
        [AssignmentStatus.EXPIRED, AssignmentStatusReason.LESSON_CANCELLED],
      ]);
    });

    it("takes no transaction, no lock and emits no event", async () => {
      state.assignmentsFound = [buildAssignment()];

      await service.listByLesson(LESSON_ID, DIRECTOR);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      // The lesson is read plainly: no manager and no lock.
      expect(lessons.getLessonSummary).toHaveBeenCalledWith(LESSON_ID);
    });

    describe("the note (RNF-13)", () => {
      beforeEach(() => {
        // One assignment of every kind of status carries a note: whoever may not read it must not
        // see it in any of them.
        state.assignmentsFound = [
          confirmed({
            id: "01999a3e-7c1b-7000-8000-0000000000a1",
            role: AssignmentRole.TEACHER,
            note: NOTE,
          }),
          buildAssignment({
            id: "01999a3e-7c1b-7000-8000-0000000000a2",
            personId: OTHER_PERSON_ID,
            note: "Prefere a segunda hora.",
          }),
          buildAssignment({
            id: "01999a3e-7c1b-7000-8000-0000000000a3",
            status: AssignmentStatus.CANCELLED,
            cancelledAt: NOW,
            cancelledById: ACTOR_ID,
            note: "Cancelou por motivo de saúde.",
          }),
          buildAssignment({
            id: "01999a3e-7c1b-7000-8000-0000000000a4",
            status: AssignmentStatus.DECLINED,
            note: "Não pode nesse dia.",
          }),
          buildAssignment({ id: "01999a3e-7c1b-7000-8000-0000000000a5", note: null }),
        ];
        state.people = [
          { id: PERSON_ID, name: "Monitor Um" },
          { id: OTHER_PERSON_ID, name: "Monitor Dois" },
        ];
      });

      it.each([
        ["a director", DIRECTOR],
        ["a coordinator", COORDINATOR],
        ["a superadmin", SUPERADMIN],
      ])(
        "shows the note of every item to %s: assignments.create is hers",
        async (_label, actor) => {
          const result = await service.listByLesson(LESSON_ID, actor);

          expect(result.map((item) => item.note)).toEqual([
            NOTE,
            "Prefere a segunda hora.",
            "Cancelou por motivo de saúde.",
            "Não pode nesse dia.",
            null,
          ]);
        },
      );

      it("answers note null in every item to a profile without assignments.create, whatever the status", async () => {
        const result = await service.listByLesson(LESSON_ID, MEMBER);

        expect(result).toHaveLength(5);
        expect(result.map((item) => item.note)).toEqual([null, null, null, null, null]);
        // Not even as text somewhere else in the answer.
        const text = JSON.stringify(result);
        for (const note of [NOTE, "Prefere a segunda hora.", "Cancelou por motivo de saúde."]) {
          expect(text).not.toContain(note);
        }
      });

      it("keeps everything else of the item for a profile without the permission: only the note changes", async () => {
        const forManager = await service.listByLesson(LESSON_ID, DIRECTOR);
        const forMember = await service.listByLesson(LESSON_ID, MEMBER);

        expect(forMember).toEqual(forManager.map((item) => ({ ...item, note: null })));
        expect(forMember.map((item) => item.person)).toEqual(forManager.map((item) => item.person));
      });

      it("asks the policy for assignments.create, once for the whole list, and not the role", async () => {
        const can = jest.spyOn(policy, "can");

        await service.listByLesson(LESSON_ID, MEMBER);

        expect(can).toHaveBeenCalledTimes(1);
        expect(can).toHaveBeenCalledWith(MEMBER, Permission.ASSIGNMENTS_CREATE);
      });

      it("follows the answer of the policy, not the role: a director it denies does not read the note, a member it allows does", async () => {
        const can = jest.spyOn(policy, "can").mockReturnValue(false);
        const deniedDirector = await service.listByLesson(LESSON_ID, DIRECTOR);
        expect(deniedDirector.map((item) => item.note)).toEqual([null, null, null, null, null]);

        can.mockReturnValue(true);
        const allowedMember = await service.listByLesson(LESSON_ID, MEMBER);
        expect(allowedMember[0].note).toBe(NOTE);
      });

      it("does not ask the policy for a lesson that does not exist", async () => {
        state.lesson = null;
        const can = jest.spyOn(policy, "can");

        await httpFailure(service.listByLesson(LESSON_ID, MEMBER));

        expect(can).not.toHaveBeenCalled();
      });

      it("still reads the whole list for a member: the note is the only thing she is not given", async () => {
        const result = await service.listByLesson(LESSON_ID, MEMBER);

        expect(result.map((item) => item.person?.name)).toEqual([
          "Monitor Um",
          "Monitor Dois",
          "Monitor Um",
          "Monitor Um",
          "Monitor Um",
        ]);
        expect(result.map((item) => item.status)).toEqual([
          AssignmentStatus.CONFIRMED,
          AssignmentStatus.PENDING,
          AssignmentStatus.CANCELLED,
          AssignmentStatus.DECLINED,
          AssignmentStatus.PENDING,
        ]);
      });
    });
  });

  describe("confirm()", () => {
    it("confirms a pending assignment: status, who and when, with the instant of the update", async () => {
      const result = await service.confirm(ASSIGNMENT_ID, ACTOR_ID);

      const [saved] = savedAssignments();
      expect(savedAssignments()).toHaveLength(1);
      expect(saved).toMatchObject({
        id: ASSIGNMENT_ID,
        status: AssignmentStatus.CONFIRMED,
        reviewedById: ACTOR_ID,
        reviewedAt: NOW,
        updatedAt: NOW,
      });
      expect(result).toMatchObject({
        id: ASSIGNMENT_ID,
        status: AssignmentStatus.CONFIRMED,
        reviewedById: ACTOR_ID,
        reviewedAt: NOW,
        person: { id: PERSON_ID, name: "Monitor Um" },
      });
    });

    it("locks the assignment FOR UPDATE, then the lesson and the member FOR SHARE, in this order", async () => {
      await service.confirm(ASSIGNMENT_ID, ACTOR_ID);

      expect(manager.findOne).toHaveBeenCalledWith(LessonAssignment, {
        where: { id: ASSIGNMENT_ID },
        lock: { mode: "pessimistic_write" },
      });
      expect(lessons.getLessonSummary).toHaveBeenCalledWith(LESSON_ID, manager, {
        forShare: true,
      });
      expect(members.getMemberSummary).toHaveBeenCalledWith(PERSON_ID, manager, {
        forShare: true,
      });
      expect(order).toEqual([
        "load-assignment",
        "get-lesson",
        "get-member",
        "save",
        "commit",
        "emit-audit",
        "find-people",
      ]);
    });

    it("answers 200 without writing when the assignment is already confirmed, and looks at neither the lesson nor the member", async () => {
      state.assignment = confirmed();

      const result = await service.confirm(ASSIGNMENT_ID, ACTOR_ID);

      expect(result.status).toBe(AssignmentStatus.CONFIRMED);
      // Who confirmed it first stays: a repeated confirmation does not take it over.
      expect(result.reviewedById).toBe(OTHER_ACTOR_ID);
      expect(result.reviewedAt).toEqual(REVIEWED_AT);
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(lessons.getLessonSummary).not.toHaveBeenCalled();
      expect(members.getMemberSummary).not.toHaveBeenCalled();
    });

    it("throws 404 ASSIGNMENT_NOT_FOUND when the assignment does not exist", async () => {
      state.assignment = null;

      const failure = await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "ASSIGNMENT_NOT_FOUND",
        message: "Assignment not found.",
      });
      expect(lessons.getLessonSummary).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it.each([AssignmentStatus.DECLINED, AssignmentStatus.CANCELLED])(
      "throws 409 ASSIGNMENT_NOT_PENDING for a %s assignment, before looking at the lesson",
      async (status) => {
        state.assignment = buildAssignment({
          status,
          ...(status === AssignmentStatus.CANCELLED
            ? { cancelledAt: NOW, cancelledById: ACTOR_ID }
            : {}),
        });

        const failure = await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "ASSIGNMENT_NOT_PENDING",
          message: "Only a pending assignment can be confirmed.",
        });
        expect(lessons.getLessonSummary).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
      },
    );

    it("throws 409 LESSON_CANCELLED when the lesson was cancelled while the assignment waited", async () => {
      state.lesson = buildLesson({ status: LessonStatus.CANCELLED });

      const failure = await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("LESSON_CANCELLED");
      expect(members.getMemberSummary).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws 409 ASSIGNMENT_NOT_PENDING for an application of a lesson before today: it expired (GUS-179)", async () => {
      state.assignment = buildAssignment({ source: AssignmentSource.APPLICATION });
      state.lesson = buildLesson({ date: PAST_DAY });

      const failure = await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("ASSIGNMENT_NOT_PENDING");
      expect(members.getMemberSummary).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("confirms a pending direct assignment of a lesson before today: the record after the fact (A12)", async () => {
      state.lesson = buildLesson({ date: PAST_DAY });

      await expect(service.confirm(ASSIGNMENT_ID, ACTOR_ID)).resolves.toMatchObject({
        status: AssignmentStatus.CONFIRMED,
      });
    });

    it("throws 409 ASSIGNMENT_NOT_PENDING for an assignment stored as expired, before reading the lesson", async () => {
      state.assignment = buildAssignment({
        source: AssignmentSource.APPLICATION,
        status: AssignmentStatus.EXPIRED,
      });

      const failure = await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID));

      expect(codeOf(failure)).toBe("ASSIGNMENT_NOT_PENDING");
      expect(lessons.getLessonSummary).not.toHaveBeenCalled();
    });

    it("throws 409 MEMBER_INACTIVE when the member lost her access while the assignment waited", async () => {
      state.member = buildMember({ active: false });

      const failure = await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("MEMBER_INACTIVE");
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("throws 409 MEMBER_INACTIVE for a person that is no longer a member", async () => {
      state.member = null;

      const failure = await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID));

      expect(codeOf(failure)).toBe("MEMBER_INACTIVE");
    });

    it("throws 409 LESSON_TEACHER_TAKEN for a pending teacher while another one is confirmed", async () => {
      state.assignment = buildAssignment({ role: AssignmentRole.TEACHER });
      state.hasConfirmedTeacher = true;

      const failure = await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("LESSON_TEACHER_TAKEN");
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("confirms a pending teacher when the lesson has no confirmed one, and a pending monitor whatever the teacher", async () => {
      state.assignment = buildAssignment({ role: AssignmentRole.TEACHER });
      await service.confirm(ASSIGNMENT_ID, ACTOR_ID);
      expect(order).toContain("check-teacher");

      order.length = 0;
      state.assignment = buildAssignment({ role: AssignmentRole.MONITOR });
      state.hasConfirmedTeacher = true;
      await service.confirm(ASSIGNMENT_ID, ACTOR_ID);
      expect(order).not.toContain("check-teacher");
    });

    it("answers the errors in this order: not pending, lesson cancelled, member inactive, teacher taken", async () => {
      state.assignment = buildAssignment({
        role: AssignmentRole.TEACHER,
        status: AssignmentStatus.DECLINED,
      });
      state.lesson = buildLesson({ status: LessonStatus.CANCELLED });
      state.member = buildMember({ active: false });
      state.hasConfirmedTeacher = true;

      expect(codeOf(await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID)))).toBe(
        "ASSIGNMENT_NOT_PENDING",
      );
      state.assignment = buildAssignment({ role: AssignmentRole.TEACHER });
      expect(codeOf(await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID)))).toBe(
        "LESSON_CANCELLED",
      );
      state.lesson = buildLesson();
      expect(codeOf(await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID)))).toBe(
        "MEMBER_INACTIVE",
      );
      state.member = buildMember();
      expect(codeOf(await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID)))).toBe(
        "LESSON_TEACHER_TAKEN",
      );
    });

    it("maps 23505 on uq_lesson_assignments_lesson_id_confirmed_teacher to LESSON_TEACHER_TAKEN: two teachers confirmed at the same time", async () => {
      state.assignment = buildAssignment({ role: AssignmentRole.TEACHER });
      manager.save.mockRejectedValue(
        violation("23505", "uq_lesson_assignments_lesson_id_confirmed_teacher"),
      );

      const failure = await httpFailure(service.confirm(ASSIGNMENT_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(codeOf(failure)).toBe("LESSON_TEACHER_TAKEN");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits LESSON_ASSIGNMENT_CONFIRMED once, after the commit, and not for the no-op", async () => {
      await service.confirm(ASSIGNMENT_ID, ACTOR_ID);

      expect(order.indexOf("commit")).toBeLessThan(order.indexOf("emit-audit"));
      const events = auditEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: ACTOR_ID,
        action: AuditableAction.LESSON_ASSIGNMENT_CONFIRMED,
        targetType: "lesson_assignment",
        targetId: ASSIGNMENT_ID,
        before: { status: AssignmentStatus.PENDING },
        after: {
          status: AssignmentStatus.CONFIRMED,
          reviewedAt: NOW,
          lessonId: LESSON_ID,
          personId: PERSON_ID,
          role: AssignmentRole.MONITOR,
        },
      });

      eventEmitter.emit.mockClear();
      state.assignment = confirmed();
      await service.confirm(ASSIGNMENT_ID, ACTOR_ID);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("never carries the note in the event", async () => {
      state.assignment = buildAssignment({ note: NOTE });

      await service.confirm(ASSIGNMENT_ID, ACTOR_ID);

      const [event] = auditEvents();
      expect(JSON.stringify(event)).not.toContain(NOTE);
    });

    it("answers the note to the one who confirms: the route needs assignments.create, which reads it", async () => {
      state.assignment = buildAssignment({ note: NOTE });

      const result = await service.confirm(ASSIGNMENT_ID, ACTOR_ID);

      expect(result.note).toBe(NOTE);
    });

    it("reads the name of the member after the commit, and answers person null when she is gone", async () => {
      state.people = [];

      const result = await service.confirm(ASSIGNMENT_ID, ACTOR_ID);

      expect(order.indexOf("commit")).toBeLessThan(order.indexOf("find-people"));
      expect(people.findRefsByIds).toHaveBeenCalledWith([PERSON_ID]);
      expect(result.person).toBeNull();
    });
  });

  describe("cancel()", () => {
    it.each([AssignmentStatus.PENDING, AssignmentStatus.CONFIRMED])(
      "cancels a %s assignment: status, who and when, with the same instant for the update",
      async (status) => {
        state.assignment = status === AssignmentStatus.CONFIRMED ? confirmed() : buildAssignment();

        const result = await service.cancel(ASSIGNMENT_ID, ACTOR_ID);

        const [saved] = savedAssignments();
        expect(savedAssignments()).toHaveLength(1);
        expect(saved).toMatchObject({
          id: ASSIGNMENT_ID,
          status: AssignmentStatus.CANCELLED,
          cancelledById: ACTOR_ID,
          cancelledAt: NOW,
          updatedAt: NOW,
        });
        expect(result).toMatchObject({
          id: ASSIGNMENT_ID,
          status: AssignmentStatus.CANCELLED,
          cancelledById: ACTOR_ID,
          cancelledAt: NOW,
          person: { id: PERSON_ID, name: "Monitor Um" },
        });
        // Whoever confirmed it stays in the row: cancelling adds to it, it does not erase it.
        expect(result.reviewedById).toBe(
          status === AssignmentStatus.CONFIRMED ? OTHER_ACTOR_ID : null,
        );
      },
    );

    it("locks the assignment FOR UPDATE and reads neither the lesson nor the member", async () => {
      await service.cancel(ASSIGNMENT_ID, ACTOR_ID);

      expect(manager.findOne).toHaveBeenCalledWith(LessonAssignment, {
        where: { id: ASSIGNMENT_ID },
        lock: { mode: "pessimistic_write" },
      });
      // A direct assignment does not depend on its lesson to be cancelled.
      expect(lessons.getLessonSummary).not.toHaveBeenCalled();
      expect(members.getMemberSummary).not.toHaveBeenCalled();
      expect(order).toEqual(["load-assignment", "save", "commit", "emit-audit", "find-people"]);
    });

    it("answers 200 without writing when the assignment is already cancelled, and keeps the first instant", async () => {
      const firstCancelledAt = new Date("2026-03-05T12:00:00.000Z");
      state.assignment = buildAssignment({
        status: AssignmentStatus.CANCELLED,
        cancelledAt: firstCancelledAt,
        cancelledById: OTHER_ACTOR_ID,
      });

      const result = await service.cancel(ASSIGNMENT_ID, ACTOR_ID);

      expect(result.status).toBe(AssignmentStatus.CANCELLED);
      expect(result.cancelledAt).toEqual(firstCancelledAt);
      expect(result.cancelledById).toBe(OTHER_ACTOR_ID);
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 404 ASSIGNMENT_NOT_FOUND when the assignment does not exist", async () => {
      state.assignment = null;

      const failure = await httpFailure(service.cancel(ASSIGNMENT_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("ASSIGNMENT_NOT_FOUND");
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 409 ASSIGNMENT_NOT_ACTIVE for a declined assignment: it was never in place", async () => {
      state.assignment = buildAssignment({
        status: AssignmentStatus.DECLINED,
        source: AssignmentSource.APPLICATION,
        reviewedById: OTHER_ACTOR_ID,
        reviewedAt: REVIEWED_AT,
      });

      const failure = await httpFailure(service.cancel(ASSIGNMENT_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "ASSIGNMENT_NOT_ACTIVE",
        message: "Only a pending or confirmed assignment can be cancelled.",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 409 ASSIGNMENT_NOT_ACTIVE for an expired one: stored expired, or a pending application of a lesson before today or cancelled (GUS-179)", async () => {
      const cases: { assignment: LessonAssignment; lesson: LessonSummary }[] = [
        {
          assignment: buildAssignment({
            source: AssignmentSource.APPLICATION,
            status: AssignmentStatus.EXPIRED,
          }),
          lesson: buildLesson(),
        },
        {
          assignment: buildAssignment({ source: AssignmentSource.APPLICATION }),
          lesson: buildLesson({ date: PAST_DAY }),
        },
        {
          assignment: buildAssignment({ source: AssignmentSource.APPLICATION }),
          lesson: buildLesson({ status: LessonStatus.CANCELLED }),
        },
      ];

      for (const { assignment, lesson } of cases) {
        state.assignment = assignment;
        state.lesson = lesson;

        const failure = await httpFailure(service.cancel(ASSIGNMENT_ID, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect(codeOf(failure)).toBe("ASSIGNMENT_NOT_ACTIVE");
      }
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("reads the lesson without a lock for a pending application, and cancels one of a lesson of today or later", async () => {
      state.assignment = buildAssignment({ source: AssignmentSource.APPLICATION });

      const result = await service.cancel(ASSIGNMENT_ID, ACTOR_ID);

      expect(lessons.getLessonSummary).toHaveBeenCalledWith(LESSON_ID, manager);
      expect(order).toEqual([
        "load-assignment",
        "get-lesson",
        "save",
        "commit",
        "emit-audit",
        "find-people",
      ]);
      expect(result.status).toBe(AssignmentStatus.CANCELLED);
    });

    it("emits LESSON_ASSIGNMENT_CANCELLED after the commit, without the note, saying what it was", async () => {
      state.assignment = confirmed({ note: NOTE });

      await service.cancel(ASSIGNMENT_ID, ACTOR_ID);

      expect(order.indexOf("commit")).toBeLessThan(order.indexOf("emit-audit"));
      const events = auditEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: ACTOR_ID,
        action: AuditableAction.LESSON_ASSIGNMENT_CANCELLED,
        targetType: "lesson_assignment",
        targetId: ASSIGNMENT_ID,
        before: { status: AssignmentStatus.CONFIRMED },
        after: {
          status: AssignmentStatus.CANCELLED,
          cancelledAt: NOW,
          lessonId: LESSON_ID,
          personId: PERSON_ID,
          role: AssignmentRole.MONITOR,
        },
      });
      expect(JSON.stringify(events[0])).not.toContain(NOTE);
    });

    it("says in the event that a pending assignment was what got cancelled", async () => {
      await service.cancel(ASSIGNMENT_ID, ACTOR_ID);

      expect(auditEvents()[0].before).toEqual({ status: AssignmentStatus.PENDING });
    });

    it("answers the note to the one who cancels: the route needs assignments.create, which reads it", async () => {
      state.assignment = confirmed({ note: NOTE });

      const result = await service.cancel(ASSIGNMENT_ID, ACTOR_ID);

      expect(result.note).toBe(NOTE);
    });

    it("emits nothing when the transaction fails", async () => {
      dataSource.transaction.mockRejectedValue(new Error("boom"));

      await expect(service.cancel(ASSIGNMENT_ID, ACTOR_ID)).rejects.toThrow("boom");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("listByMember()", () => {
    const FORBIDDEN_SCOPE_BODY = {
      error: "FORBIDDEN_SCOPE",
      message: "You do not have access to this resource.",
    };

    it("throws 404 MEMBER_NOT_FOUND when the id is not a member, before the scope", async () => {
      state.member = null;
      const assertCan = jest.spyOn(policy, "assertCan");

      const failure = await httpFailure(service.listByMember(PERSON_ID, DIRECTOR));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "MEMBER_NOT_FOUND",
        message: "Member not found.",
      });
      expect(assertCan).not.toHaveBeenCalled();
      expect(assignmentRepository.find).not.toHaveBeenCalled();
    });

    it("calls assertCan with members.view and the departmentIds of the target", async () => {
      state.member = buildMember({ departmentIds: [DEPARTMENT_ID] });
      const assertCan = jest.spyOn(policy, "assertCan");

      await service.listByMember(PERSON_ID, DIRECTOR);

      expect(assertCan).toHaveBeenCalledTimes(1);
      expect(assertCan).toHaveBeenCalledWith(DIRECTOR, Permission.MEMBERS_VIEW, {
        personId: PERSON_ID,
        departmentIds: [DEPARTMENT_ID],
      });
    });

    it("lets coordination read the assignments of a member of any department", async () => {
      state.member = buildMember({ departmentIds: [OTHER_DEPARTMENT_ID] });

      await expect(service.listByMember(PERSON_ID, COORDINATOR)).resolves.toEqual([]);
    });

    it("lets a director read the assignments of a member of the own department", async () => {
      state.member = buildMember({ departmentIds: [DEPARTMENT_ID] });

      await expect(service.listByMember(PERSON_ID, DIRECTOR)).resolves.toEqual([]);
    });

    it("throws 403 FORBIDDEN_SCOPE to a director of another department, and reads no assignment", async () => {
      state.member = buildMember({ departmentIds: [DEPARTMENT_ID] });

      const failure = await httpFailure(
        service.listByMember(PERSON_ID, DIRECTOR_OF_OTHER_DEPARTMENT),
      );

      expect(failure.getStatus()).toBe(403);
      expect(failure.getResponse()).toMatchObject(FORBIDDEN_SCOPE_BODY);
      expect(assignmentRepository.find).not.toHaveBeenCalled();
    });

    it("throws 403 FORBIDDEN_SCOPE to a director for a member without an approved department", async () => {
      state.member = buildMember({ departmentIds: [] });

      const failure = await httpFailure(service.listByMember(PERSON_ID, DIRECTOR));

      expect(failure.getResponse()).toMatchObject(FORBIDDEN_SCOPE_BODY);
    });

    it("throws 403 FORBIDDEN_SCOPE to a director without department, whoever the member is", async () => {
      const failure = await httpFailure(
        service.listByMember(PERSON_ID, DIRECTOR_WITHOUT_DEPARTMENT),
      );

      expect(failure.getResponse()).toMatchObject(FORBIDDEN_SCOPE_BODY);
    });

    it("throws 403 FORBIDDEN_SCOPE to a member (the guard answers first; this is the second line)", async () => {
      const failure = await httpFailure(service.listByMember(PERSON_ID, MEMBER));

      expect(failure.getResponse()).toMatchObject(FORBIDDEN_SCOPE_BODY);
    });

    it("lists the assignments of the member with the lesson, the latest lesson first", async () => {
      const early = buildAssignment({
        id: "01999a3e-7c1b-7000-8000-0000000000a1",
        lessonId: LESSON_ID,
      });
      const late = buildAssignment({
        id: "01999a3e-7c1b-7000-8000-0000000000a2",
        lessonId: OTHER_LESSON_ID,
        role: AssignmentRole.TEACHER,
        status: AssignmentStatus.CONFIRMED,
      });
      const middle = buildAssignment({
        id: "01999a3e-7c1b-7000-8000-0000000000a3",
        lessonId: THIRD_LESSON_ID,
      });
      state.assignmentsFound = [early, late, middle];
      state.lessonSummaries = [
        buildLesson({ id: LESSON_ID, date: "2026-03-10", title: "Primeira" }),
        buildLesson({ id: OTHER_LESSON_ID, date: "2026-03-24", title: "Terceira" }),
        buildLesson({ id: THIRD_LESSON_ID, date: "2026-03-17", title: "Segunda" }),
      ];

      const result = await service.listByMember(PERSON_ID, COORDINATOR);

      expect(result.map((item) => item.lesson.title)).toEqual(["Terceira", "Segunda", "Primeira"]);
      expect(result[0]).toEqual({
        id: "01999a3e-7c1b-7000-8000-0000000000a2",
        lesson: {
          id: OTHER_LESSON_ID,
          title: "Terceira",
          date: "2026-03-24",
          startTime: "14:00",
          endTime: "15:30",
          status: LessonStatus.PLANNED,
        },
        role: AssignmentRole.TEACHER,
        status: AssignmentStatus.CONFIRMED,
        statusReason: null,
        source: AssignmentSource.DIRECT,
        createdAt: CREATED_AT,
      });
    });

    it("orders lessons of the same day by start time, latest first, and then the newest assignment first", async () => {
      const morning = buildAssignment({
        id: "01999a3e-7c1b-7000-8000-0000000000a1",
        lessonId: LESSON_ID,
      });
      const afternoon = buildAssignment({
        id: "01999a3e-7c1b-7000-8000-0000000000a2",
        lessonId: OTHER_LESSON_ID,
      });
      const older = buildAssignment({
        id: "01999a3e-7c1b-7000-8000-0000000000a3",
        lessonId: THIRD_LESSON_ID,
        createdAt: new Date("2026-02-01T12:00:00.000Z"),
      });
      const newer = buildAssignment({
        id: "01999a3e-7c1b-7000-8000-0000000000a4",
        lessonId: THIRD_LESSON_ID,
        createdAt: new Date("2026-02-02T12:00:00.000Z"),
        status: AssignmentStatus.CANCELLED,
        cancelledAt: NOW,
        cancelledById: ACTOR_ID,
      });
      state.assignmentsFound = [morning, older, afternoon, newer];
      state.lessonSummaries = [
        buildLesson({ id: LESSON_ID, date: "2026-03-10", startTime: "08:00", endTime: "09:30" }),
        buildLesson({ id: OTHER_LESSON_ID, date: "2026-03-10", startTime: "14:00" }),
        buildLesson({ id: THIRD_LESSON_ID, date: "2026-03-03", startTime: "10:00" }),
      ];

      const result = await service.listByMember(PERSON_ID, COORDINATOR);

      expect(result.map((item) => item.id)).toEqual([
        "01999a3e-7c1b-7000-8000-0000000000a2",
        "01999a3e-7c1b-7000-8000-0000000000a1",
        "01999a3e-7c1b-7000-8000-0000000000a4",
        "01999a3e-7c1b-7000-8000-0000000000a3",
      ]);
    });

    it("asks for the lessons in ONE call, with the ids of all the assignments", async () => {
      state.assignmentsFound = [
        buildAssignment({ id: "01999a3e-7c1b-7000-8000-0000000000a1", lessonId: LESSON_ID }),
        buildAssignment({ id: "01999a3e-7c1b-7000-8000-0000000000a2", lessonId: OTHER_LESSON_ID }),
      ];
      state.lessonSummaries = [
        buildLesson({ id: LESSON_ID }),
        buildLesson({ id: OTHER_LESSON_ID }),
      ];

      await service.listByMember(PERSON_ID, COORDINATOR);

      expect(lessons.findLessonSummaries).toHaveBeenCalledTimes(1);
      expect(lessons.findLessonSummaries).toHaveBeenCalledWith([LESSON_ID, OTHER_LESSON_ID]);
      expect(assignmentRepository.find).toHaveBeenCalledWith({ where: { personId: PERSON_ID } });
    });

    it("lists every status, the cancelled and the declined ones too", async () => {
      state.assignmentsFound = [
        buildAssignment({
          id: "01999a3e-7c1b-7000-8000-0000000000a1",
          status: AssignmentStatus.DECLINED,
        }),
        buildAssignment({
          id: "01999a3e-7c1b-7000-8000-0000000000a2",
          lessonId: OTHER_LESSON_ID,
          status: AssignmentStatus.CANCELLED,
          cancelledAt: NOW,
          cancelledById: ACTOR_ID,
        }),
      ];
      state.lessonSummaries = [
        buildLesson({ id: LESSON_ID, date: "2026-03-10" }),
        buildLesson({ id: OTHER_LESSON_ID, date: "2026-03-17" }),
      ];

      const result = await service.listByMember(PERSON_ID, COORDINATOR);

      expect(result.map((item) => item.status)).toEqual([
        AssignmentStatus.CANCELLED,
        AssignmentStatus.DECLINED,
      ]);
    });

    it("leaves out an assignment whose lesson the lessons no longer answer for", async () => {
      state.assignmentsFound = [
        buildAssignment({ id: "01999a3e-7c1b-7000-8000-0000000000a1", lessonId: LESSON_ID }),
        buildAssignment({ id: "01999a3e-7c1b-7000-8000-0000000000a2", lessonId: OTHER_LESSON_ID }),
      ];
      state.lessonSummaries = [buildLesson({ id: LESSON_ID })];

      const result = await service.listByMember(PERSON_ID, COORDINATOR);

      expect(result.map((item) => item.id)).toEqual(["01999a3e-7c1b-7000-8000-0000000000a1"]);
    });

    it("answers an empty list for a member with no assignment, without asking for lessons", async () => {
      state.assignmentsFound = [];

      await expect(service.listByMember(PERSON_ID, COORDINATOR)).resolves.toEqual([]);

      expect(lessons.findLessonSummaries).not.toHaveBeenCalled();
    });

    it("shows no note and no member data: the item is the lesson, the role, the status and the source", async () => {
      state.assignmentsFound = [buildAssignment({ note: NOTE })];
      state.lessonSummaries = [buildLesson()];

      const [item] = await service.listByMember(PERSON_ID, COORDINATOR);

      expect(Object.keys(item).sort()).toEqual([
        "createdAt",
        "id",
        "lesson",
        "role",
        "source",
        "status",
        "statusReason",
      ]);
      expect(JSON.stringify(item)).not.toContain(NOTE);
    });

    it("answers expired for a pending application of a lesson before today, and the reason of what the cancellation of a lesson ended (GUS-179)", async () => {
      state.assignmentsFound = [
        buildAssignment({
          id: "01999a3e-7c1b-7000-8000-0000000000a1",
          source: AssignmentSource.APPLICATION,
        }),
        buildAssignment({
          id: "01999a3e-7c1b-7000-8000-0000000000a2",
          lessonId: OTHER_LESSON_ID,
          status: AssignmentStatus.CANCELLED,
          cancelledAt: NOW,
          cancelledById: ACTOR_ID,
          statusReason: AssignmentStatusReason.LESSON_CANCELLED,
        }),
      ];
      state.lessonSummaries = [
        buildLesson({ id: LESSON_ID, date: PAST_DAY }),
        buildLesson({ id: OTHER_LESSON_ID, date: "2026-03-17", status: LessonStatus.CANCELLED }),
      ];

      const result = await service.listByMember(PERSON_ID, COORDINATOR);

      expect(result.map((item) => [item.status, item.statusReason])).toEqual([
        [AssignmentStatus.CANCELLED, AssignmentStatusReason.LESSON_CANCELLED],
        [AssignmentStatus.EXPIRED, null],
      ]);
    });

    it("takes no transaction, no lock and emits no event", async () => {
      state.assignmentsFound = [buildAssignment()];
      state.lessonSummaries = [buildLesson()];

      await service.listByMember(PERSON_ID, COORDINATOR);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      // The member is read plainly: no manager and no lock.
      expect(members.getMemberSummary).toHaveBeenCalledWith(PERSON_ID);
    });
  });
});
