import "reflect-metadata";
import { DataSource, EntityManager } from "typeorm";
import { LessonCoverageRegistry } from "@modules/lessons/services/lesson-coverage.registry";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { PeopleService } from "@modules/people/services/people.service";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { LessonStaffCounterService } from "../services/lesson-staff-counter.service";

const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const OTHER_LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f2";
const EMPTY_LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f3";
const TEACHER_ID = "01999a3e-0000-7000-8000-0000000000b1";
const OTHER_TEACHER_ID = "01999a3e-0000-7000-8000-0000000000b2";

describe("LessonStaffCounterService", () => {
  let service: LessonStaffCounterService;
  let registry: LessonCoverageRegistry;
  let rows: Array<{
    lessonId: string;
    teachers: string;
    monitors: string;
    teacherId?: string | null;
  }>;
  let people: PersonRefDto[];

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
  const peopleService = { findRefsByIds: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    rows = [];
    people = [];

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

    peopleService.findRefsByIds.mockImplementation(async () => people);

    registry = new LessonCoverageRegistry();
    service = new LessonStaffCounterService(
      dataSource as unknown as DataSource,
      registry,
      peopleService as unknown as PeopleService,
    );
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

    it("reads no person and does not ask for the teacher: the counts are all the detail of a lesson needs", async () => {
      rows = [{ lessonId: LESSON_ID, teachers: "1", monitors: "2" }];

      const result = await service.countConfirmedStaff([LESSON_ID]);

      expect(result.get(LESSON_ID)).toEqual({ teachers: 1, monitors: 2 });
      expect(peopleService.findRefsByIds).not.toHaveBeenCalled();
      expect(builder.addSelect).toHaveBeenCalledTimes(2);
      expect(builder.addSelect).not.toHaveBeenCalledWith(
        expect.stringContaining("person_id"),
        expect.anything(),
      );
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
  describe("findConfirmedStaff()", () => {
    it("answers an empty map without querying when there is no lesson to ask for", async () => {
      const result = await service.findConfirmedStaff([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(ownManager.getRepository).not.toHaveBeenCalled();
      expect(peopleService.findRefsByIds).not.toHaveBeenCalled();
    });

    it("answers an empty map without querying when none of the ids is a UUID", async () => {
      const result = await service.findConfirmedStaff(["not-a-uuid", ""]);

      expect(result.size).toBe(0);
      expect(builder.getRawMany).not.toHaveBeenCalled();
      expect(peopleService.findRefsByIds).not.toHaveBeenCalled();
    });

    it("answers the counts and the confirmed teacher, with her name, of each lesson", async () => {
      rows = [
        { lessonId: LESSON_ID, teachers: "1", monitors: "2", teacherId: TEACHER_ID },
        { lessonId: OTHER_LESSON_ID, teachers: "1", monitors: "0", teacherId: OTHER_TEACHER_ID },
      ];
      people = [
        { id: TEACHER_ID, name: "Ana Torres" },
        { id: OTHER_TEACHER_ID, name: "Bruno Lima" },
      ];

      const result = await service.findConfirmedStaff([LESSON_ID, OTHER_LESSON_ID]);

      expect(result).toEqual(
        new Map([
          [
            LESSON_ID,
            { teachers: 1, monitors: 2, teacher: { id: TEACHER_ID, name: "Ana Torres" } },
          ],
          [
            OTHER_LESSON_ID,
            { teachers: 1, monitors: 0, teacher: { id: OTHER_TEACHER_ID, name: "Bruno Lima" } },
          ],
        ]),
      );
    });

    it("resolves the names of the whole page in ONE call, with the teachers of every lesson", async () => {
      rows = [
        { lessonId: LESSON_ID, teachers: "1", monitors: "0", teacherId: TEACHER_ID },
        { lessonId: OTHER_LESSON_ID, teachers: "1", monitors: "1", teacherId: OTHER_TEACHER_ID },
        { lessonId: EMPTY_LESSON_ID, teachers: "0", monitors: "2", teacherId: null },
      ];
      people = [
        { id: TEACHER_ID, name: "Ana Torres" },
        { id: OTHER_TEACHER_ID, name: "Bruno Lima" },
      ];

      await service.findConfirmedStaff([LESSON_ID, OTHER_LESSON_ID, EMPTY_LESSON_ID]);

      expect(peopleService.findRefsByIds).toHaveBeenCalledTimes(1);
      expect(peopleService.findRefsByIds).toHaveBeenCalledWith([TEACHER_ID, OTHER_TEACHER_ID]);
    });

    it("asks for a teacher who has several lessons in the page once", async () => {
      rows = [
        { lessonId: LESSON_ID, teachers: "1", monitors: "0", teacherId: TEACHER_ID },
        { lessonId: OTHER_LESSON_ID, teachers: "1", monitors: "0", teacherId: TEACHER_ID },
      ];
      people = [{ id: TEACHER_ID, name: "Ana Torres" }];

      const result = await service.findConfirmedStaff([LESSON_ID, OTHER_LESSON_ID]);

      expect(peopleService.findRefsByIds).toHaveBeenCalledWith([TEACHER_ID]);
      expect(result.get(LESSON_ID)?.teacher).toEqual({ id: TEACHER_ID, name: "Ana Torres" });
      expect(result.get(OTHER_LESSON_ID)?.teacher).toEqual({ id: TEACHER_ID, name: "Ana Torres" });
    });

    it("answers no teacher for a lesson with only monitors, and reads no name when no lesson has a teacher", async () => {
      rows = [{ lessonId: LESSON_ID, teachers: "0", monitors: "2", teacherId: null }];

      const result = await service.findConfirmedStaff([LESSON_ID]);

      expect(result.get(LESSON_ID)).toEqual({ teachers: 0, monitors: 2, teacher: null });
      expect(peopleService.findRefsByIds).not.toHaveBeenCalled();
    });

    it("answers teacher null when the person is gone, and keeps the counts as they are", async () => {
      rows = [{ lessonId: LESSON_ID, teachers: "1", monitors: "1", teacherId: TEACHER_ID }];
      people = [];

      const result = await service.findConfirmedStaff([LESSON_ID]);

      expect(peopleService.findRefsByIds).toHaveBeenCalledWith([TEACHER_ID]);
      expect(result.get(LESSON_ID)).toEqual({ teachers: 1, monitors: 1, teacher: null });
    });

    it("leaves a lesson without staff out of the map", async () => {
      rows = [{ lessonId: LESSON_ID, teachers: "1", monitors: "0", teacherId: TEACHER_ID }];
      people = [{ id: TEACHER_ID, name: "Ana Torres" }];

      const result = await service.findConfirmedStaff([LESSON_ID, EMPTY_LESSON_ID]);

      expect(result.has(LESSON_ID)).toBe(true);
      expect(result.has(EMPTY_LESSON_ID)).toBe(false);
    });

    it("shows only the id and the name of the teacher: nothing else the people service answers", async () => {
      rows = [{ lessonId: LESSON_ID, teachers: "1", monitors: "0", teacherId: TEACHER_ID }];
      people = [
        { id: TEACHER_ID, name: "Ana Torres", email: "ana@example.com", ra: "a2210001" } as never,
      ];

      const result = await service.findConfirmedStaff([LESSON_ID]);

      expect(Object.keys(result.get(LESSON_ID)?.teacher ?? {}).sort()).toEqual(["id", "name"]);
    });

    it("asks for the confirmed teacher in the same aggregated query as the counts: one query on the assignments", async () => {
      await service.findConfirmedStaff([LESSON_ID, OTHER_LESSON_ID, EMPTY_LESSON_ID]);

      expect(repository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(builder.getRawMany).toHaveBeenCalledTimes(1);
      expect(builder.where).toHaveBeenCalledWith("assignment.lesson_id IN (:...lessonIds)", {
        lessonIds: [LESSON_ID, OTHER_LESSON_ID, EMPTY_LESSON_ID],
      });
      expect(builder.andWhere).toHaveBeenCalledWith("assignment.status = :confirmed", {
        confirmed: AssignmentStatus.CONFIRMED,
      });
      expect(builder.groupBy).toHaveBeenCalledWith("assignment.lesson_id");
      expect(builder.addSelect).toHaveBeenCalledWith(
        "MIN(assignment.person_id::text) FILTER (WHERE assignment.role = :teacher)",
        "teacherId",
      );
      expect(builder.setParameters).toHaveBeenCalledWith({
        teacher: AssignmentRole.TEACHER,
        monitor: AssignmentRole.MONITOR,
      });
    });

    it("skips an id that is not a UUID and counts a repeated one once", async () => {
      await service.findConfirmedStaff([LESSON_ID, "not-a-uuid", LESSON_ID, OTHER_LESSON_ID, ""]);

      expect(builder.where).toHaveBeenCalledWith("assignment.lesson_id IN (:...lessonIds)", {
        lessonIds: [LESSON_ID, OTHER_LESSON_ID],
      });
    });

    it("reads through the manager of the data source: it is a plain read and takes none", async () => {
      await service.findConfirmedStaff([LESSON_ID]);

      expect(ownManager.getRepository).toHaveBeenCalledWith(LessonAssignment);
    });
  });

  describe("through the registry", () => {
    it("answers findConfirmedStaff once it has registered itself", async () => {
      rows = [{ lessonId: LESSON_ID, teachers: "1", monitors: "0", teacherId: TEACHER_ID }];
      people = [{ id: TEACHER_ID, name: "Ana Torres" }];

      service.onModuleInit();
      const result = await registry.findConfirmedStaff([LESSON_ID]);

      expect(result.get(LESSON_ID)).toEqual({
        teachers: 1,
        monitors: 0,
        teacher: { id: TEACHER_ID, name: "Ana Torres" },
      });
    });
  });
});
