import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import {
  LessonsService,
  LessonStatus,
  LessonSummary,
} from "@modules/lessons/services/lessons.service";
import { MembersService } from "@modules/people/services/members.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { MemberAttendance } from "../entities/member-attendance.entity";
import { MemberAttendanceStatus } from "../enums/member-attendance-status.enum";
import { MemberAttendanceHistoryService } from "../services/member-attendance-history.service";

const TECH = "01999a3e-1111-7000-8000-000000000001";
const COMMS = "01999a3e-1111-7000-8000-000000000002";
const MEMBER_ID = "01999a3e-0000-7000-8000-0000000000aa";

const COORDINATOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000ee",
  role: Role.COORDINATOR,
  accessEnabled: true,
  departmentIds: [],
};
const DIRECTOR_OF_COMMS: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000cc",
  role: Role.DIRECTOR,
  accessEnabled: true,
  departmentIds: [COMMS],
};

function lessonOf(id: string, values: Partial<LessonSummary>): LessonSummary {
  return {
    id,
    classId: "01999a3e-7c1b-7000-8000-0000000000c1",
    title: `Aula ${id.slice(-2)}`,
    date: "2026-03-10",
    startTime: "14:00",
    endTime: "15:30",
    status: LessonStatus.DONE,
    expectedMonitors: null,
    ...values,
  };
}

const MARCH_10_MORNING = lessonOf("01999a3e-7c1b-7000-8000-0000000000f1", {
  startTime: "09:00",
});
const MARCH_10_AFTERNOON = lessonOf("01999a3e-7c1b-7000-8000-0000000000f2", {});
const MARCH_17 = lessonOf("01999a3e-7c1b-7000-8000-0000000000f3", { date: "2026-03-17" });
const CANCELLED = lessonOf("01999a3e-7c1b-7000-8000-0000000000f4", {
  date: "2026-03-24",
  status: LessonStatus.CANCELLED,
});

function rowOf(id: string, lesson: LessonSummary, status: MemberAttendanceStatus) {
  return Object.assign(new MemberAttendance(), {
    id,
    lessonId: lesson.id,
    personId: MEMBER_ID,
    status,
    confirmedAt: new Date(`${lesson.date}T18:30:00.000Z`),
  });
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

describe("MemberAttendanceHistoryService", () => {
  let service: MemberAttendanceHistoryService;
  const repository = { find: jest.fn() };
  const dataSource = { getRepository: jest.fn() };
  const members = { getMemberSummary: jest.fn() };
  const lessons = { findLessonSummaries: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    dataSource.getRepository.mockReturnValue(repository);
    members.getMemberSummary.mockResolvedValue({
      id: MEMBER_ID,
      name: "Ana",
      active: true,
      departmentIds: [TECH],
    });
    repository.find.mockResolvedValue([
      rowOf(
        "01999a3e-7c1b-7000-8000-0000000000d1",
        MARCH_10_MORNING,
        MemberAttendanceStatus.PRESENT,
      ),
      rowOf("01999a3e-7c1b-7000-8000-0000000000d2", MARCH_17, MemberAttendanceStatus.ABSENT),
      rowOf("01999a3e-7c1b-7000-8000-0000000000d3", CANCELLED, MemberAttendanceStatus.ABSENT),
      rowOf(
        "01999a3e-7c1b-7000-8000-0000000000d4",
        MARCH_10_AFTERNOON,
        MemberAttendanceStatus.PRESENT,
      ),
    ]);
    lessons.findLessonSummaries.mockResolvedValue([
      MARCH_10_MORNING,
      MARCH_10_AFTERNOON,
      MARCH_17,
      CANCELLED,
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        MemberAttendanceHistoryService,
        PermissionPolicy,
        { provide: DataSource, useValue: dataSource },
        { provide: MembersService, useValue: members },
        { provide: LessonsService, useValue: lessons },
      ],
    }).compile();
    service = moduleRef.get(MemberAttendanceHistoryService);
  });

  it("answers 404 MEMBER_NOT_FOUND for an id that is not a member, before checking the scope", async () => {
    members.getMemberSummary.mockResolvedValue(null);

    const failure = await httpFailure(service.getByMember(MEMBER_ID, DIRECTOR_OF_COMMS));

    expect(failure.getStatus()).toBe(404);
    expect(failure.getResponse()).toMatchObject({ error: "MEMBER_NOT_FOUND" });
    expect(repository.find).not.toHaveBeenCalled();
  });

  it("answers 403 FORBIDDEN_SCOPE to a director outside the department of the member", async () => {
    const failure = await httpFailure(service.getByMember(MEMBER_ID, DIRECTOR_OF_COMMS));

    expect(failure.getStatus()).toBe(403);
    expect(failure.getResponse()).toMatchObject({ error: "FORBIDDEN_SCOPE" });
    expect(repository.find).not.toHaveBeenCalled();
  });

  it("lists presences and absences, the latest lesson first, with the totals", async () => {
    const history = await service.getByMember(MEMBER_ID.toUpperCase(), COORDINATOR);

    expect(members.getMemberSummary).toHaveBeenCalledWith(MEMBER_ID.toUpperCase());
    expect(repository.find).toHaveBeenCalledWith({ where: { personId: MEMBER_ID } });
    expect(history.items.map((item) => item.lesson.id)).toEqual([
      MARCH_17.id,
      MARCH_10_AFTERNOON.id,
      MARCH_10_MORNING.id,
    ]);
    expect(history.items[0]).toEqual({
      lesson: {
        id: MARCH_17.id,
        title: MARCH_17.title,
        date: "2026-03-17",
        startTime: "14:00",
        endTime: "15:30",
      },
      status: MemberAttendanceStatus.ABSENT,
      confirmedAt: new Date("2026-03-17T18:30:00.000Z"),
    });
    expect(history.totals).toEqual({ present: 2, absent: 1 });
  });

  it("leaves the cancelled lessons out of the items and of the totals", async () => {
    // A lesson the lessons no longer answer for is left out the same way.
    lessons.findLessonSummaries.mockResolvedValue([MARCH_17, CANCELLED]);

    const history = await service.getByMember(MEMBER_ID, COORDINATOR);

    expect(history.items.map((item) => item.lesson.id)).toEqual([MARCH_17.id]);
    expect(history.totals).toEqual({ present: 0, absent: 1 });
  });

  it("reads the lessons in one call to LessonsService.findLessonSummaries, and none for a member without attendance", async () => {
    await service.getByMember(MEMBER_ID, COORDINATOR);
    expect(lessons.findLessonSummaries).toHaveBeenCalledTimes(1);
    expect(lessons.findLessonSummaries).toHaveBeenCalledWith([
      MARCH_10_MORNING.id,
      MARCH_17.id,
      CANCELLED.id,
      MARCH_10_AFTERNOON.id,
    ]);

    jest.clearAllMocks();
    repository.find.mockResolvedValue([]);
    expect(await service.getByMember(MEMBER_ID, COORDINATOR)).toEqual({
      totals: { present: 0, absent: 0 },
      items: [],
    });
    expect(lessons.findLessonSummaries).not.toHaveBeenCalled();
  });
});
