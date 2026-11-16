import "reflect-metadata";
import { DataSource, EntityManager } from "typeorm";
import { LessonCoverageRegistry } from "@modules/lessons/services/lesson-coverage.registry";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { LessonStaffCounterService } from "../services/lesson-staff-counter.service";

const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const OTHER_LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f2";
const EMPTY_LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f3";

describe("LessonStaffCounterService", () => {
  let service: LessonStaffCounterService;
  let registry: LessonCoverageRegistry;
  let rows: Array<{ lessonId: string; teachers: string; monitors: string }>;

  const builder = {
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    setParameters: jest.fn(),
    groupBy: jest.fn(),
    getRawMany: jest.fn(),
  };
  const repository = { createQueryBuilder: jest.fn() };
  const ownManager = { getRepository: jest.fn() };
  const dataSource = { manager: ownManager };

  beforeEach(() => {
    jest.resetAllMocks();
    rows = [];

    for (const name of [
      "select",
      "addSelect",
      "where",
      "andWhere",
      "setParameters",
      "groupBy",
    ] as const) {
      builder[name].mockReturnValue(builder);
    }
    builder.getRawMany.mockImplementation(async () => rows);
    repository.createQueryBuilder.mockReturnValue(builder);
    ownManager.getRepository.mockReturnValue(repository);

    registry = new LessonCoverageRegistry();
    service = new LessonStaffCounterService(dataSource as unknown as DataSource, registry);
  });

  describe("onModuleInit()", () => {
    it("registers itself as the counter of the lessons", async () => {
      const register = jest.spyOn(registry, "register");

      service.onModuleInit();

      expect(register).toHaveBeenCalledTimes(1);
      expect(register).toHaveBeenCalledWith(service);
    });

    it("makes the registry count through it from then on", async () => {
      rows = [{ lessonId: LESSON_ID, teachers: "1", monitors: "2" }];

      service.onModuleInit();
      const result = await registry.countConfirmedStaff([LESSON_ID]);

      expect(result.get(LESSON_ID)).toEqual({ teachers: 1, monitors: 2 });
    });

    it("refuses to register twice: a second counter would split the truth", () => {
      service.onModuleInit();

      expect(() => service.onModuleInit()).toThrow("A lesson staff counter is already registered.");
    });
  });

  describe("countConfirmedStaff()", () => {
    it("answers an empty map without querying when there is no lesson to ask for", async () => {
      const result = await service.countConfirmedStaff([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(ownManager.getRepository).not.toHaveBeenCalled();
      expect(builder.getRawMany).not.toHaveBeenCalled();
    });

    it("answers an empty map without querying when none of the ids is a UUID", async () => {
      const result = await service.countConfirmedStaff(["not-a-uuid", ""]);

      expect(result.size).toBe(0);
      expect(builder.getRawMany).not.toHaveBeenCalled();
    });

    it("counts the confirmed teachers and monitors of each lesson, as numbers", async () => {
      rows = [
        { lessonId: LESSON_ID, teachers: "1", monitors: "2" },
        { lessonId: OTHER_LESSON_ID, teachers: "0", monitors: "1" },
      ];

      const result = await service.countConfirmedStaff([LESSON_ID, OTHER_LESSON_ID]);

      expect(result).toEqual(
        new Map([
          [LESSON_ID, { teachers: 1, monitors: 2 }],
          [OTHER_LESSON_ID, { teachers: 0, monitors: 1 }],
        ]),
      );
    });

    it("leaves a lesson without staff out of the map", async () => {
      rows = [{ lessonId: LESSON_ID, teachers: "1", monitors: "0" }];

      const result = await service.countConfirmedStaff([LESSON_ID, EMPTY_LESSON_ID]);

      expect(result.has(LESSON_ID)).toBe(true);
      expect(result.has(EMPTY_LESSON_ID)).toBe(false);
    });

    it("asks once for all the lessons, in one aggregated query", async () => {
      await service.countConfirmedStaff([LESSON_ID, OTHER_LESSON_ID, EMPTY_LESSON_ID]);

      expect(repository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(builder.getRawMany).toHaveBeenCalledTimes(1);
      expect(builder.where).toHaveBeenCalledWith("assignment.lesson_id IN (:...lessonIds)", {
        lessonIds: [LESSON_ID, OTHER_LESSON_ID, EMPTY_LESSON_ID],
      });
      expect(builder.groupBy).toHaveBeenCalledWith("assignment.lesson_id");
    });

    it("counts only confirmed assignments, and teachers and monitors apart", async () => {
      await service.countConfirmedStaff([LESSON_ID]);

      expect(ownManager.getRepository).toHaveBeenCalledWith(LessonAssignment);
      expect(builder.andWhere).toHaveBeenCalledWith("assignment.status = :confirmed", {
        confirmed: AssignmentStatus.CONFIRMED,
      });
      expect(builder.addSelect).toHaveBeenCalledWith(
        "COUNT(*) FILTER (WHERE assignment.role = :teacher)",
        "teachers",
      );
      expect(builder.addSelect).toHaveBeenCalledWith(
        "COUNT(*) FILTER (WHERE assignment.role = :monitor)",
        "monitors",
      );
      expect(builder.setParameters).toHaveBeenCalledWith({
        teacher: AssignmentRole.TEACHER,
        monitor: AssignmentRole.MONITOR,
      });
    });

    it("skips an id that is not a UUID and counts a repeated one once", async () => {
      await service.countConfirmedStaff([LESSON_ID, "not-a-uuid", LESSON_ID, OTHER_LESSON_ID, ""]);

      expect(builder.where).toHaveBeenCalledWith("assignment.lesson_id IN (:...lessonIds)", {
        lessonIds: [LESSON_ID, OTHER_LESSON_ID],
      });
    });

    it("counts through the manager it receives, and through the one of the data source without it", async () => {
      const other = { getRepository: jest.fn().mockReturnValue(repository) };

      await service.countConfirmedStaff([LESSON_ID], other as unknown as EntityManager);
      expect(other.getRepository).toHaveBeenCalledWith(LessonAssignment);
      expect(ownManager.getRepository).not.toHaveBeenCalled();

      await service.countConfirmedStaff([LESSON_ID]);
      expect(ownManager.getRepository).toHaveBeenCalledWith(LessonAssignment);
    });
  });
});
