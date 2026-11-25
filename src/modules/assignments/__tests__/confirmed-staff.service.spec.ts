import { Test } from "@nestjs/testing";
import { DataSource, EntityManager } from "typeorm";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { AssignmentRole, ConfirmedStaffService } from "../services/confirmed-staff.service";

const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const TEACHER_ASSIGNMENT = "01999a3e-7c1b-7000-8000-0000000000a1";
const MONITOR_ASSIGNMENT = "01999a3e-7c1b-7000-8000-0000000000a2";
const TEACHER_ID = "01999a3e-0000-7000-8000-0000000000bb";
const MONITOR_ID = "01999a3e-0000-7000-8000-0000000000aa";

describe("ConfirmedStaffService", () => {
  let service: ConfirmedStaffService;
  const plainManager = { find: jest.fn() };
  const transactionManager = { find: jest.fn() };
  const dataSource = { manager: plainManager };

  const ROWS = [
    Object.assign(new LessonAssignment(), {
      id: TEACHER_ASSIGNMENT,
      personId: TEACHER_ID,
      role: AssignmentRole.TEACHER,
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
    }),
    Object.assign(new LessonAssignment(), {
      id: MONITOR_ASSIGNMENT,
      personId: MONITOR_ID,
      role: AssignmentRole.MONITOR,
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
    }),
  ];

  beforeEach(async () => {
    jest.resetAllMocks();
    plainManager.find.mockResolvedValue(ROWS);
    transactionManager.find.mockResolvedValue(ROWS);

    const moduleRef = await Test.createTestingModule({
      providers: [ConfirmedStaffService, { provide: DataSource, useValue: dataSource }],
    }).compile();
    service = moduleRef.get(ConfirmedStaffService);
  });

  it("answers [] without querying for a lesson id that is not a uuid", async () => {
    expect(await service.findConfirmedAssignments("not-a-uuid")).toEqual([]);
    expect(plainManager.find).not.toHaveBeenCalled();
  });

  it("reads only the confirmed assignments of the lesson, the teacher first, then by creation and id", async () => {
    const staff = await service.findConfirmedAssignments(LESSON_ID);

    expect(plainManager.find).toHaveBeenCalledWith(LessonAssignment, {
      select: { id: true, personId: true, role: true },
      where: { lessonId: LESSON_ID, status: AssignmentStatus.CONFIRMED },
      order: { role: "ASC", createdAt: "ASC", id: "ASC" },
    });
    expect(staff).toEqual([
      { id: TEACHER_ASSIGNMENT, personId: TEACHER_ID, role: AssignmentRole.TEACHER },
      { id: MONITOR_ASSIGNMENT, personId: MONITOR_ID, role: AssignmentRole.MONITOR },
    ]);
  });

  it("locks them FOR SHARE with the manager of a transaction, and throws when forShare comes without one", async () => {
    await service.findConfirmedAssignments(
      LESSON_ID,
      transactionManager as unknown as EntityManager,
      { forShare: true },
    );

    expect(plainManager.find).not.toHaveBeenCalled();
    expect(transactionManager.find).toHaveBeenCalledWith(
      LessonAssignment,
      expect.objectContaining({ lock: { mode: "pessimistic_read" } }),
    );

    await expect(
      service.findConfirmedAssignments(LESSON_ID, undefined, { forShare: true }),
    ).rejects.toThrow("needs the manager of a transaction");
    expect(plainManager.find).not.toHaveBeenCalled();
  });
});
