import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DataSource, In } from "typeorm";
import { ConfirmedStaffCount } from "@modules/lessons/services/lesson-coverage";
import {
  LessonAgendaRef,
  LessonListingService,
} from "@modules/lessons/services/lesson-listing.service";
import { LessonStatus } from "@modules/lessons/services/lessons.service";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { LessonStaffCounterService } from "../services/lesson-staff-counter.service";
import { MyAssignmentsService } from "../services/my-assignments.service";

/** 12:00 in São Paulo: today is 2026-03-09 there. */
const NOW = new Date("2026-03-09T15:00:00.000Z");

const PERSON_ID = "01999a3e-0000-7000-8000-0000000000b1";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";

const MEMBER: AuthUser = {
  id: PERSON_ID,
  role: Role.MEMBER,
  accessEnabled: true,
  departmentIds: [],
};

function lessonId(n: number): string {
  return `01999a3e-7c1b-7000-8000-${String(n).padStart(12, "0")}`;
}

function assignmentId(n: number): string {
  return `01999a3e-7c1b-7000-8000-a${String(n).padStart(11, "0")}`;
}

function buildRef(n: number, overrides: Partial<LessonAgendaRef> = {}): LessonAgendaRef {
  return {
    id: lessonId(n),
    title: `Aula ${n}`,
    sequenceOrder: n,
    date: "2026-03-10",
    startTime: "14:00",
    endTime: "15:30",
    location: null,
    status: LessonStatus.PLANNED,
    expectedMonitors: 2,
    class: { id: CLASS_ID, code: "INFO-A", name: "INFO-A" },
    ...overrides,
  };
}

function buildAssignment(
  n: number,
  forLesson: number,
  overrides: Partial<LessonAssignment> = {},
): LessonAssignment {
  return Object.assign(new LessonAssignment(), {
    id: assignmentId(n),
    lessonId: lessonId(forLesson),
    personId: PERSON_ID,
    role: AssignmentRole.MONITOR,
    status: AssignmentStatus.PENDING,
    source: AssignmentSource.APPLICATION,
    note: "Chego antes.",
    createdById: PERSON_ID,
    reviewedById: null,
    reviewedAt: null,
    cancelledById: null,
    cancelledAt: null,
    createdAt: new Date(`2026-03-0${Math.min(n, 9)}T12:00:00.000Z`),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  });
}

describe("MyAssignmentsService", () => {
  let service: MyAssignmentsService;
  let order: string[];
  let state: {
    agenda: LessonAgendaRef[];
    rows: LessonAssignment[];
    staff: Map<string, ConfirmedStaffCount>;
  };

  const repository = { find: jest.fn() };
  const dataSource = { getRepository: jest.fn() };
  const clock = { now: jest.fn() };
  const listing = { findAgendaBetween: jest.fn() };
  const staffCounter = { countConfirmedStaff: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];
    state = { agenda: [], rows: [], staff: new Map() };

    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === LessonAssignment ? repository : undefined,
    );
    repository.find.mockImplementation(async () => {
      order.push("find-assignments");
      return state.rows;
    });
    clock.now.mockReturnValue(NOW);
    listing.findAgendaBetween.mockImplementation(async () => {
      order.push("find-agenda");
      return state.agenda;
    });
    staffCounter.countConfirmedStaff.mockImplementation(async () => {
      order.push("count-staff");
      return state.staff;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        MyAssignmentsService,
        { provide: DataSource, useValue: dataSource },
        { provide: Clock, useValue: clock },
        { provide: LessonListingService, useValue: listing },
        { provide: LessonStaffCounterService, useValue: staffCounter },
      ],
    }).compile();

    service = moduleRef.get(MyAssignmentsService);
  });

  describe("listMine()", () => {
    it("resolves the period before reading anything, from the clock in America/Sao_Paulo", async () => {
      // 2026-03-10 02:00 UTC is still the 9th in São Paulo.
      clock.now.mockReturnValue(new Date("2026-03-10T02:00:00.000Z"));

      const result = await service.listMine(MEMBER, {});

      expect(listing.findAgendaBetween).toHaveBeenCalledWith("2026-03-09", "2026-04-05");
      expect(result).toMatchObject({ from: "2026-03-09", to: "2026-04-05" });

      listing.findAgendaBetween.mockClear();
      for (const query of [
        { from: "2026-03-10", to: "2026-03-09" },
        { from: "2026-03-01", to: "2026-04-12" },
      ]) {
        await expect(service.listMine(MEMBER, query)).rejects.toBeInstanceOf(HttpException);
      }
      expect(listing.findAgendaBetween).not.toHaveBeenCalled();
      expect(repository.find).not.toHaveBeenCalled();
    });

    it("reads the agenda of the period and the assignments of the actor in those lessons only, by the id of the session", async () => {
      state.agenda = [buildRef(1), buildRef(2)];

      await service.listMine(MEMBER, { from: "2026-03-09", to: "2026-03-20" });

      expect(listing.findAgendaBetween).toHaveBeenCalledWith("2026-03-09", "2026-03-20");
      expect(repository.find).toHaveBeenCalledTimes(1);
      expect(repository.find).toHaveBeenCalledWith({
        where: { personId: PERSON_ID, lessonId: In([lessonId(1), lessonId(2)]) },
        order: { createdAt: "DESC", id: "DESC" },
      });
    });

    it("keeps one item per lesson: the active assignment if there is one, else the latest", async () => {
      state.agenda = [buildRef(1), buildRef(2), buildRef(3)];
      // As the query answers them: the newest first.
      state.rows = [
        buildAssignment(5, 1, { status: AssignmentStatus.DECLINED }),
        buildAssignment(4, 2, { status: AssignmentStatus.CANCELLED }),
        buildAssignment(3, 1, { status: AssignmentStatus.PENDING }),
        buildAssignment(2, 2, { status: AssignmentStatus.DECLINED }),
        buildAssignment(1, 1, { status: AssignmentStatus.CANCELLED }),
      ];

      const result = await service.listMine(MEMBER, {});

      expect(result.items.map((item) => [item.lesson.id, item.id, item.status])).toEqual([
        [lessonId(1), assignmentId(3), AssignmentStatus.PENDING],
        [lessonId(2), assignmentId(4), AssignmentStatus.CANCELLED],
      ]);
    });

    it("answers each item with the lesson, its class and position, the role, the status and the source, and no note", async () => {
      state.agenda = [buildRef(1, { location: "Laboratório 2" })];
      state.rows = [buildAssignment(1, 1, { role: AssignmentRole.TEACHER })];

      const result = await service.listMine(MEMBER, {});

      expect(result.items).toEqual([
        {
          id: assignmentId(1),
          lesson: {
            id: lessonId(1),
            title: "Aula 1",
            date: "2026-03-10",
            startTime: "14:00",
            endTime: "15:30",
            status: LessonStatus.PLANNED,
            sequenceOrder: 1,
            location: "Laboratório 2",
            class: { id: CLASS_ID, code: "INFO-A", name: "INFO-A" },
          },
          role: AssignmentRole.TEACHER,
          status: AssignmentStatus.PENDING,
          statusReason: null,
          source: AssignmentSource.APPLICATION,
        },
      ]);
      expect(JSON.stringify(result)).not.toContain("Chego antes.");
    });

    it("answers expired for a pending application of a lesson before today, and counts it in no total (GUS-179)", async () => {
      state.agenda = [buildRef(1, { date: "2026-03-08" }), buildRef(2, { date: "2026-03-08" })];
      state.rows = [
        buildAssignment(2, 2, {
          status: AssignmentStatus.PENDING,
          source: AssignmentSource.DIRECT,
        }),
        buildAssignment(1, 1, { status: AssignmentStatus.PENDING }),
      ];

      const result = await service.listMine(MEMBER, { from: "2026-03-01", to: "2026-03-31" });

      expect(result.items.map((item) => [item.id, item.status])).toEqual([
        [assignmentId(1), AssignmentStatus.EXPIRED],
        // A pending direct assignment is the decision of the board: it does not expire.
        [assignmentId(2), AssignmentStatus.PENDING],
      ]);
      expect(result.totals).toEqual({ upcoming: 1, confirmed: 0, pending: 1, openLessons: 0 });
    });

    it("lists a declined application and a cancelled assignment, and counts neither", async () => {
      state.agenda = [buildRef(1), buildRef(2)];
      state.rows = [
        buildAssignment(2, 2, { status: AssignmentStatus.CANCELLED }),
        buildAssignment(1, 1, { status: AssignmentStatus.DECLINED }),
      ];
      // Both lessons are full, so openLessons stays out of the way.
      state.staff = new Map([
        [lessonId(1), { teachers: 1, monitors: 2 }],
        [lessonId(2), { teachers: 1, monitors: 2 }],
      ]);

      const result = await service.listMine(MEMBER, {});

      expect(result.items.map((item) => item.status)).toEqual([
        AssignmentStatus.DECLINED,
        AssignmentStatus.CANCELLED,
      ]);
      expect(result.totals).toEqual({ upcoming: 0, confirmed: 0, pending: 0, openLessons: 0 });
    });

    it("counts upcoming as confirmed plus pending, with every total present when zero", async () => {
      await expect(service.listMine(MEMBER, {})).resolves.toEqual({
        from: "2026-03-09",
        to: "2026-04-05",
        totals: { upcoming: 0, confirmed: 0, pending: 0, openLessons: 0 },
        items: [],
      });

      state.agenda = [buildRef(1), buildRef(2), buildRef(3)];
      state.rows = [
        buildAssignment(3, 3, { status: AssignmentStatus.CONFIRMED }),
        buildAssignment(2, 2, { status: AssignmentStatus.CONFIRMED }),
        buildAssignment(1, 1, {
          status: AssignmentStatus.PENDING,
          source: AssignmentSource.DIRECT,
        }),
      ];

      const result = await service.listMine(MEMBER, {});

      expect(result.totals).toEqual({ upcoming: 3, confirmed: 2, pending: 1, openLessons: 0 });
    });

    it("counts openLessons with the same rule as listOpen", async () => {
      state.agenda = [
        buildRef(1, { date: "2026-03-08" }),
        buildRef(2),
        buildRef(3),
        buildRef(4, { expectedMonitors: null }),
        buildRef(5),
      ];
      state.rows = [buildAssignment(1, 3, { status: AssignmentStatus.PENDING })];
      state.staff = new Map([
        [lessonId(4), { teachers: 1, monitors: 0 }],
        [lessonId(5), { teachers: 0, monitors: 2 }],
      ]);

      const mine = await service.listMine(MEMBER, { from: "2026-03-01", to: "2026-03-31" });
      const open = await service.listOpen(MEMBER, { from: "2026-03-01", to: "2026-03-31" });

      expect(open.map((item) => item.lesson.id)).toEqual([lessonId(2), lessonId(5)]);
      expect(mine.totals.openLessons).toBe(open.length);
    });

    it("does not read assignments nor count staff for an empty agenda", async () => {
      await service.listMine(MEMBER, {});

      expect(order).toEqual(["find-agenda"]);
    });
  });

  describe("listOpen()", () => {
    it("leaves out lessons before today, lessons where the actor holds a place, and full lessons", async () => {
      state.agenda = [
        buildRef(1, { date: "2026-03-08" }),
        buildRef(2, { date: "2026-03-09" }),
        buildRef(3),
        buildRef(4),
        buildRef(5),
        buildRef(6, { expectedMonitors: null }),
      ];
      state.rows = [
        buildAssignment(2, 3, { status: AssignmentStatus.PENDING }),
        buildAssignment(1, 4, {
          status: AssignmentStatus.CONFIRMED,
          source: AssignmentSource.DIRECT,
        }),
      ];
      state.staff = new Map([
        [lessonId(5), { teachers: 1, monitors: 2 }],
        [lessonId(6), { teachers: 1, monitors: 0 }],
      ]);

      const result = await service.listOpen(MEMBER, { from: "2026-03-01", to: "2026-03-31" });

      // The lesson of today is still open; the 8th is past, 3 and 4 hold her place, 5 and 6 are full.
      expect(result.map((item) => item.lesson.id)).toEqual([lessonId(2)]);
    });

    it("leaves out a lesson already marked done, of today and of a later day, as applyToLesson refuses it", async () => {
      state.agenda = [
        buildRef(1, { date: "2026-03-09", status: LessonStatus.DONE }),
        buildRef(2, { date: "2026-03-09", status: LessonStatus.CONFIRMED }),
        buildRef(3, { date: "2026-03-17", status: LessonStatus.DONE }),
        buildRef(4, { date: "2026-03-17" }),
      ];

      const open = await service.listOpen(MEMBER, {});
      const mine = await service.listMine(MEMBER, {});

      expect(open.map((item) => item.lesson.id)).toEqual([lessonId(2), lessonId(4)]);
      expect(mine.totals.openLessons).toBe(2);
      // The staff is not even counted for the lessons that are closed.
      expect(staffCounter.countConfirmedStaff).toHaveBeenCalledWith([lessonId(2), lessonId(4)]);
    });

    it("keeps a lesson where the actor was declined", async () => {
      state.agenda = [buildRef(1), buildRef(2)];
      state.rows = [
        buildAssignment(2, 2, { status: AssignmentStatus.CANCELLED }),
        buildAssignment(1, 1, { status: AssignmentStatus.DECLINED }),
      ];

      const result = await service.listOpen(MEMBER, {});

      expect(result.map((item) => item.lesson.id)).toEqual([lessonId(1), lessonId(2)]);
    });

    it("counts staff once, only for the candidate lessons, and not at all when none is left", async () => {
      state.agenda = [buildRef(1, { date: "2026-03-08" }), buildRef(2), buildRef(3)];
      state.rows = [buildAssignment(1, 3, { status: AssignmentStatus.PENDING })];

      await service.listOpen(MEMBER, { from: "2026-03-01", to: "2026-03-31" });

      expect(staffCounter.countConfirmedStaff).toHaveBeenCalledTimes(1);
      expect(staffCounter.countConfirmedStaff).toHaveBeenCalledWith([lessonId(2)]);
      expect(order).toEqual(["find-agenda", "find-assignments", "count-staff"]);

      staffCounter.countConfirmedStaff.mockClear();
      state.rows = [
        buildAssignment(2, 2, { status: AssignmentStatus.CONFIRMED }),
        buildAssignment(1, 3, { status: AssignmentStatus.PENDING }),
      ];
      await expect(
        service.listOpen(MEMBER, { from: "2026-03-01", to: "2026-03-31" }),
      ).resolves.toEqual([]);
      expect(staffCounter.countConfirmedStaff).not.toHaveBeenCalled();
    });

    it("answers the coverage and the open roles of each lesson", async () => {
      state.agenda = [buildRef(1, { expectedMonitors: 3 }), buildRef(2, { expectedMonitors: 2 })];
      state.staff = new Map([
        [lessonId(1), { teachers: 0, monitors: 2 }],
        [lessonId(2), { teachers: 1, monitors: 0 }],
      ]);

      const result = await service.listOpen(MEMBER, {});

      // The Figma: "Professor(a) 0 de 1 · Monitores 2 de 3", and "Monitores 0 de 2".
      expect(result.map((item) => [item.coverage, item.openRoles])).toEqual([
        [
          { teacher: { confirmed: 0, expected: 1 }, monitors: { confirmed: 2, expected: 3 } },
          [AssignmentRole.TEACHER, AssignmentRole.MONITOR],
        ],
        [
          { teacher: { confirmed: 1, expected: 1 }, monitors: { confirmed: 0, expected: 2 } },
          [AssignmentRole.MONITOR],
        ],
      ]);
      expect(result[0].lesson).toMatchObject({ id: lessonId(1), class: { code: "INFO-A" } });
    });

    it("never asks the policy: it does not even depend on it", () => {
      const dependencies: unknown[] =
        Reflect.getMetadata("design:paramtypes", MyAssignmentsService) ?? [];

      expect(dependencies).not.toContain(PermissionPolicy);
    });
  });
});
