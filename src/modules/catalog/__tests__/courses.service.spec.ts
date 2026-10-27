import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, QueryFailedError } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { CoursePrerequisite } from "../entities/course-prerequisite.entity";
import { Course } from "../entities/course.entity";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import { toCourseResponse } from "../services/course-response.mapper";
import { CoursesService } from "../services/courses.service";
import { PrerequisiteEdge } from "../services/prerequisite-graph";

const NOW = new Date("2026-10-02T01:30:00.000Z");
const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const BASIC_ID = "01999a3e-7c1b-7000-8000-000000000001";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000002";
const ADVANCED_ID = "01999a3e-7c1b-7000-8000-000000000003";
const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

type CourseOverrides = Partial<Omit<Course, "archive">> & { archive?: Partial<ArchivableColumns> };

function buildCourse(overrides: CourseOverrides = {}): Course {
  const { archive, ...rest } = overrides;
  return Object.assign(new Course(), {
    id: COURSE_ID,
    name: "Informática Intermediária",
    description: "Planilhas, textos e apresentações.",
    objective: "Preparar o aluno para as ferramentas de escritório.",
    category: CourseCategory.INTERMEDIATE,
    createdById: ACTOR_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    archive: Object.assign(new ArchivableColumns(), {
      archivedAt: null,
      archivedById: null,
      archiveReason: null,
      ...archive,
    }),
    ...rest,
  });
}

function buildBasic(overrides: CourseOverrides = {}): Course {
  return buildCourse({
    id: BASIC_ID,
    name: "Informática Básica",
    description: "Fundamentos do uso do computador.",
    objective: null,
    category: CourseCategory.BASIC,
    ...overrides,
  });
}

function buildAdvanced(overrides: CourseOverrides = {}): Course {
  return buildCourse({
    id: ADVANCED_ID,
    name: "Informática Avançada",
    description: "Automação de tarefas.",
    objective: null,
    category: CourseCategory.ADVANCED,
    ...overrides,
  });
}

function buildLink(prerequisiteId: string, courseId = COURSE_ID): CoursePrerequisite {
  return Object.assign(new CoursePrerequisite(), {
    id: `link-${courseId}-${prerequisiteId}`,
    courseId,
    prerequisiteId,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  });
}

function uniqueViolation(constraint: string): QueryFailedError {
  const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });
  return new QueryFailedError("INSERT INTO courses", [], driverError);
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

describe("CoursesService", () => {
  let service: CoursesService;
  let order: string[];
  let state: {
    course: Course | null;
    courses: Course[];
    links: CoursePrerequisite[];
    edges: PrerequisiteEdge[];
    nameTaken: boolean;
  };

  const builder = { where: jest.fn(), andWhere: jest.fn(), getExists: jest.fn() };
  const manager = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn(),
    getRepository: jest.fn(),
  };
  const courseRepository = { findOne: jest.fn() };
  const dataSource = { transaction: jest.fn(), getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };

  function emittedEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls.map((call) => call[1] as AuditableActionEvent);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    order = [];
    const edited = buildCourse();
    state = {
      course: edited,
      courses: [buildBasic(), buildAdvanced(), edited],
      links: [],
      edges: [],
      nameTaken: false,
    };

    builder.where.mockReturnValue(builder);
    builder.andWhere.mockReturnValue(builder);
    builder.getExists.mockImplementation(async () => {
      order.push("check-name");
      return state.nameTaken;
    });
    manager.createQueryBuilder.mockReturnValue(builder);
    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), {
        id: target === Course ? COURSE_ID : `link-${String(data.prerequisiteId)}`,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        deletedAt: null,
        ...data,
      }),
    );
    manager.save.mockImplementation(async (entity: unknown) => {
      order.push(Array.isArray(entity) ? "insert-prerequisites" : "save-course");
      return entity;
    });
    manager.find.mockImplementation(
      async (target: unknown, options: { where: { id?: { value: string[] } } }) => {
        if (target === CoursePrerequisite) {
          order.push("load-links");
          return state.links;
        }
        if (target === Course) {
          order.push("load-prerequisites");
          const ids = options.where.id?.value ?? [];
          return state.courses.filter((course) => ids.includes(course.id));
        }
        return [];
      },
    );
    manager.findOne.mockImplementation(async (target: unknown) => {
      if (target !== Course) return null;
      order.push("load-course");
      return state.course;
    });
    manager.delete.mockImplementation(async () => {
      order.push("delete-prerequisites");
      return { affected: state.links.length };
    });
    manager.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        order.push("advisory-lock");
        return [{}];
      }
      if (sql.includes("FROM course_prerequisites")) {
        order.push("load-edges");
        return state.edges;
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    manager.getRepository.mockReturnValue(courseRepository);
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => Promise<unknown>) => {
        const result = await callback(manager);
        order.push("commit");
        return result;
      },
    );
    dataSource.getRepository.mockReturnValue(courseRepository);
    courseRepository.findOne.mockResolvedValue(state.course);
    eventEmitter.emit.mockImplementation(() => {
      order.push("emit");
      return true;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: { now: () => NOW } },
      ],
    }).compile();

    service = moduleRef.get(CoursesService);
  });

  describe("create()", () => {
    const dto = {
      name: "Informática Intermediária",
      description: "Planilhas, textos e apresentações.",
      objective: "Preparar o aluno para as ferramentas de escritório.",
      category: CourseCategory.INTERMEDIATE,
      prerequisiteIds: [BASIC_ID],
    };

    it("creates the course and its prerequisite rows in one transaction with createdById = actor", async () => {
      const result = await service.create(dto, ACTOR_ID);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenNthCalledWith(1, Course, {
        name: "Informática Intermediária",
        description: "Planilhas, textos e apresentações.",
        objective: "Preparar o aluno para as ferramentas de escritório.",
        category: CourseCategory.INTERMEDIATE,
        createdById: ACTOR_ID,
      });
      expect(manager.create).toHaveBeenNthCalledWith(2, CoursePrerequisite, {
        courseId: COURSE_ID,
        prerequisiteId: BASIC_ID,
      });
      expect(order).toEqual([
        "check-name",
        "load-prerequisites",
        "save-course",
        "insert-prerequisites",
        "commit",
        "emit",
      ]);

      expect(result).toEqual({
        id: COURSE_ID,
        name: "Informática Intermediária",
        description: "Planilhas, textos e apresentações.",
        objective: "Preparar o aluno para as ferramentas de escritório.",
        category: CourseCategory.INTERMEDIATE,
        status: CourseStatus.ACTIVE,
        prerequisites: [{ id: BASIC_ID, name: "Informática Básica" }],
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: ACTOR_ID,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      });
    });

    it("stores objective as null and creates no prerequisite row when they are not informed", async () => {
      const result = await service.create(
        { name: "Informática Básica", description: "Fundamentos.", category: CourseCategory.BASIC },
        ACTOR_ID,
      );

      expect(manager.create).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenCalledWith(
        Course,
        expect.objectContaining({ objective: null }),
      );
      expect(manager.find).not.toHaveBeenCalled();
      expect(order).toEqual(["check-name", "save-course", "commit", "emit"]);
      expect(result.objective).toBeNull();
      expect(result.prerequisites).toEqual([]);
    });

    it("creates with an empty list of prerequisites the same as with none", async () => {
      const result = await service.create({ ...dto, prerequisiteIds: [] }, ACTOR_ID);

      expect(manager.create).toHaveBeenCalledTimes(1);
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(result.prerequisites).toEqual([]);
    });

    it("returns the prerequisites as { id, name } ordered by name", async () => {
      const result = await service.create(
        { ...dto, category: CourseCategory.ADVANCED, prerequisiteIds: [BASIC_ID, ADVANCED_ID] },
        ACTOR_ID,
      );

      expect(result.prerequisites).toEqual([
        { id: ADVANCED_ID, name: "Informática Avançada" },
        { id: BASIC_ID, name: "Informática Básica" },
      ]);
    });

    it("does not look for a cycle: a new course cannot close one", async () => {
      await service.create(dto, ACTOR_ID);

      expect(manager.query).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it("throws 409 COURSE_NAME_TAKEN when the name exists ignoring case", async () => {
      state.nameTaken = true;

      const failure = await httpFailure(
        service.create({ ...dto, name: "INFORMÁTICA INTERMEDIÁRIA" }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "COURSE_NAME_TAKEN",
        message: "A course with this name already exists.",
      });
      // The pre-check compares ignoring case, and archived courses are not left out.
      expect(builder.where).toHaveBeenCalledWith("LOWER(course.name) = LOWER(:name)", {
        name: "INFORMÁTICA INTERMEDIÁRIA",
      });
      expect(builder.andWhere).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("maps 23505 on uq_courses_name to 409 COURSE_NAME_TAKEN and keeps any other error", async () => {
      manager.save.mockRejectedValueOnce(uniqueViolation("uq_courses_name"));

      const failure = await httpFailure(service.create(dto, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "COURSE_NAME_TAKEN",
        message: "A course with this name already exists.",
      });

      const otherIndex = uniqueViolation("uq_course_prerequisites_course_id_prerequisite_id");
      manager.save.mockRejectedValueOnce(otherIndex);
      await expect(service.create(dto, ACTOR_ID)).rejects.toBe(otherIndex);

      const boom = new Error("connection lost");
      manager.save.mockRejectedValueOnce(boom);
      await expect(service.create(dto, ACTOR_ID)).rejects.toBe(boom);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 400 PREREQUISITE_NOT_FOUND when any id does not exist and saves nothing", async () => {
      const failure = await httpFailure(
        service.create({ ...dto, prerequisiteIds: [BASIC_ID, UNKNOWN_ID] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "PREREQUISITE_NOT_FOUND",
        message: "One or more prerequisites do not exist.",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 400 PREREQUISITE_ARCHIVED for an archived prerequisite", async () => {
      state.courses = [
        buildBasic({ archive: { archivedAt: CREATED_AT, archivedById: ACTOR_ID } }),
        buildAdvanced(),
      ];

      const failure = await httpFailure(service.create(dto, ACTOR_ID));

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "PREREQUISITE_ARCHIVED",
        message: "An archived course cannot be added as a prerequisite.",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("answers PREREQUISITE_NOT_FOUND before PREREQUISITE_ARCHIVED when both happen", async () => {
      state.courses = [buildBasic({ archive: { archivedAt: CREATED_AT } })];

      const failure = await httpFailure(
        service.create({ ...dto, prerequisiteIds: [BASIC_ID, UNKNOWN_ID] }, ACTOR_ID),
      );

      expect(failure.getResponse()).toMatchObject({ error: "PREREQUISITE_NOT_FOUND" });
    });

    it("answers COURSE_NAME_TAKEN before the problems with the prerequisites", async () => {
      state.nameTaken = true;

      const failure = await httpFailure(
        service.create({ ...dto, prerequisiteIds: [UNKNOWN_ID] }, ACTOR_ID),
      );

      expect(failure.getResponse()).toMatchObject({ error: "COURSE_NAME_TAKEN" });
      expect(manager.find).not.toHaveBeenCalled();
    });

    it("emits COURSE_CREATED after the commit with the course and its prerequisite ids", async () => {
      await service.create(
        { ...dto, category: CourseCategory.ADVANCED, prerequisiteIds: [BASIC_ID, ADVANCED_ID] },
        ACTOR_ID,
      );

      expect(order.slice(-2)).toEqual(["commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(AUDITABLE_ACTION_EVENT, expect.anything());

      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.COURSE_CREATED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("course");
      expect(event.targetId).toBe(COURSE_ID);
      expect(event.before).toBeNull();
      expect(event.after).toEqual({
        name: "Informática Intermediária",
        description: "Planilhas, textos e apresentações.",
        objective: "Preparar o aluno para as ferramentas de escritório.",
        category: CourseCategory.ADVANCED,
        // Sorted: the set has no order.
        prerequisiteIds: [BASIC_ID, ADVANCED_ID].sort(),
      });
      expect(event.occurredAt).toEqual(NOW);
    });

    it("does not emit when the transaction fails", async () => {
      dataSource.transaction.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.create(dto, ACTOR_ID)).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not emit when the insert of the prerequisite rows fails", async () => {
      manager.save
        .mockImplementationOnce(async (entity: unknown) => entity)
        .mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.create(dto, ACTOR_ID)).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("update()", () => {
    beforeEach(() => {
      // Informática Intermediária (the edited course) requires Informática Básica.
      state.links = [buildLink(BASIC_ID)];
      state.edges = [{ courseId: COURSE_ID, prerequisiteId: BASIC_ID }];
    });

    it("returns 404 COURSE_NOT_FOUND when the course does not exist", async () => {
      state.course = null;

      const failure = await httpFailure(service.update(COURSE_ID, { name: "Outro" }, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "COURSE_NOT_FOUND",
        message: "Course not found.",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("locks the course row for the whole edit", async () => {
      await service.update(COURSE_ID, {}, ACTOR_ID);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.findOne).toHaveBeenCalledWith(Course, {
        where: { id: COURSE_ID },
        lock: { mode: "pessimistic_write" },
      });
    });

    it("takes the advisory lock before the row lock only when prerequisiteIds is sent", async () => {
      await service.update(COURSE_ID, { prerequisiteIds: [BASIC_ID] }, ACTOR_ID);

      expect(order.slice(0, 2)).toEqual(["advisory-lock", "load-course"]);
      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"), [
        "course_prerequisites",
      ]);

      order.length = 0;
      manager.query.mockClear();
      await service.update(COURSE_ID, { name: "Informática Média" }, ACTOR_ID);

      expect(order).not.toContain("advisory-lock");
      expect(manager.query).not.toHaveBeenCalled();
    });

    it("takes the advisory lock even when the prerequisites sent are the ones it already has", async () => {
      await service.update(COURSE_ID, { prerequisiteIds: [BASIC_ID] }, ACTOR_ID);

      expect(order).toContain("advisory-lock");
    });

    it("returns 409 COURSE_ARCHIVED and writes nothing", async () => {
      state.course = buildCourse({ archive: { archivedAt: CREATED_AT, archivedById: ACTOR_ID } });

      const failure = await httpFailure(
        service.update(
          COURSE_ID,
          { name: "Novo", category: CourseCategory.ADVANCED, prerequisiteIds: [] },
          ACTOR_ID,
        ),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "COURSE_ARCHIVED",
        message: "Archived courses are read-only.",
      });
      expect(builder.getExists).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws 409 COURSE_NAME_TAKEN for another course's name and allows its own name in another case", async () => {
      state.nameTaken = true;

      const failure = await httpFailure(
        service.update(COURSE_ID, { name: "Informática Básica" }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "COURSE_NAME_TAKEN",
        message: "A course with this name already exists.",
      });
      expect(builder.where).toHaveBeenCalledWith("LOWER(course.name) = LOWER(:name)", {
        name: "Informática Básica",
      });
      // The edited course is left out of the check: changing only the case of its own name passes.
      expect(builder.andWhere).toHaveBeenCalledWith("course.id <> :exceptId", {
        exceptId: COURSE_ID,
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();

      state.nameTaken = false;
      const result = await service.update(
        COURSE_ID,
        { name: "INFORMÁTICA INTERMEDIÁRIA" },
        ACTOR_ID,
      );

      expect(result.name).toBe("INFORMÁTICA INTERMEDIÁRIA");
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it("does not check the name when it did not change", async () => {
      await service.update(COURSE_ID, { name: "Informática Intermediária" }, ACTOR_ID);

      expect(builder.getExists).not.toHaveBeenCalled();
    });

    it("maps 23505 on uq_courses_name at the save to 409 COURSE_NAME_TAKEN and keeps any other error", async () => {
      manager.save.mockRejectedValueOnce(uniqueViolation("uq_courses_name"));

      const failure = await httpFailure(
        service.update(COURSE_ID, { name: "Outro nome" }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toMatchObject({ error: "COURSE_NAME_TAKEN" });

      state.course = buildCourse();
      const boom = new Error("connection lost");
      manager.save.mockRejectedValueOnce(boom);
      await expect(service.update(COURSE_ID, { name: "Outro nome" }, ACTOR_ID)).rejects.toBe(boom);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("changes the category from basic to advanced and leaves the rest alone", async () => {
      state.course = buildCourse({ category: CourseCategory.BASIC });

      const result = await service.update(
        COURSE_ID,
        { category: CourseCategory.ADVANCED },
        ACTOR_ID,
      );

      expect(result.category).toBe(CourseCategory.ADVANCED);
      expect(result.name).toBe("Informática Intermediária");
      expect(result.description).toBe("Planilhas, textos e apresentações.");
      expect(result.objective).toBe("Preparar o aluno para as ferramentas de escritório.");
      expect(result.status).toBe(CourseStatus.ACTIVE);
      expect(result.prerequisites).toEqual([{ id: BASIC_ID, name: "Informática Básica" }]);
      // Only the course row is written: no prerequisite row, and nothing about classes (RN-18).
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.save).toHaveBeenCalledWith(expect.any(Course));
      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it("updates the fields sent and clears objective sent as null", async () => {
      const result = await service.update(
        COURSE_ID,
        { name: "Informática Média", description: "Novo texto.", objective: null },
        ACTOR_ID,
      );

      expect(result).toMatchObject({
        id: COURSE_ID,
        name: "Informática Média",
        description: "Novo texto.",
        objective: null,
        category: CourseCategory.INTERMEDIATE,
        updatedAt: NOW,
        createdAt: CREATED_AT,
      });
    });

    it("keeps the prerequisites when prerequisiteIds is omitted and clears them with []", async () => {
      const kept = await service.update(COURSE_ID, { name: "Informática Média" }, ACTOR_ID);

      expect(kept.prerequisites).toEqual([{ id: BASIC_ID, name: "Informática Básica" }]);
      expect(manager.delete).not.toHaveBeenCalled();

      const cleared = await service.update(COURSE_ID, { prerequisiteIds: [] }, ACTOR_ID);

      expect(cleared.prerequisites).toEqual([]);
      expect(manager.delete).toHaveBeenCalledWith(CoursePrerequisite, { courseId: COURSE_ID });
      expect(manager.create).not.toHaveBeenCalled();
    });

    it("clears the prerequisites even when the ones it has are archived", async () => {
      state.courses = [
        buildBasic({ archive: { archivedAt: CREATED_AT, archivedById: ACTOR_ID } }),
        buildAdvanced(),
        buildCourse(),
      ];

      const result = await service.update(COURSE_ID, { prerequisiteIds: [] }, ACTOR_ID);

      expect(result.prerequisites).toEqual([]);
      expect(manager.delete).toHaveBeenCalledTimes(1);
    });

    it("replaces the whole set of prerequisites inside the transaction", async () => {
      const result = await service.update(COURSE_ID, { prerequisiteIds: [ADVANCED_ID] }, ACTOR_ID);

      expect(order).toEqual([
        "advisory-lock",
        "load-course",
        "load-links",
        "load-prerequisites",
        "load-prerequisites",
        "load-edges",
        "delete-prerequisites",
        "insert-prerequisites",
        "save-course",
        "commit",
        "emit",
      ]);
      expect(manager.delete).toHaveBeenCalledWith(CoursePrerequisite, { courseId: COURSE_ID });
      expect(manager.create).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenCalledWith(CoursePrerequisite, {
        courseId: COURSE_ID,
        prerequisiteId: ADVANCED_ID,
      });
      expect(result.prerequisites).toEqual([{ id: ADVANCED_ID, name: "Informática Avançada" }]);
    });

    it("reads the graph only after it holds both locks", async () => {
      await service.update(COURSE_ID, { prerequisiteIds: [ADVANCED_ID] }, ACTOR_ID);

      const edges = order.indexOf("load-edges");
      expect(order.indexOf("advisory-lock")).toBeLessThan(order.indexOf("load-course"));
      expect(order.indexOf("load-course")).toBeLessThan(edges);
      expect(edges).toBeLessThan(order.indexOf("delete-prerequisites"));
    });

    it("treats the same ids in another order as no change", async () => {
      state.links = [buildLink(BASIC_ID), buildLink(ADVANCED_ID)];

      const result = await service.update(
        COURSE_ID,
        { prerequisiteIds: [ADVANCED_ID, BASIC_ID] },
        ACTOR_ID,
      );

      expect(order).not.toContain("load-edges");
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(result.prerequisites.map((prerequisite) => prerequisite.id)).toEqual([
        ADVANCED_ID,
        BASIC_ID,
      ]);
    });

    describe("cycles", () => {
      it("throws 400 PREREQUISITE_CYCLE and writes nothing when Básica would require Intermediária", async () => {
        // Intermediária already requires Básica (state.edges).
        state.course = buildBasic();
        state.links = [];

        const failure = await httpFailure(
          service.update(BASIC_ID, { prerequisiteIds: [COURSE_ID] }, ACTOR_ID),
        );

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toEqual({
          error: "PREREQUISITE_CYCLE",
          message: "The prerequisites would form a cycle.",
        });
        expect(manager.delete).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it("throws 400 PREREQUISITE_CYCLE for a cycle through a third course", async () => {
        // Avançada requires Intermediária, which requires Básica: Básica cannot require Avançada.
        state.course = buildBasic();
        state.links = [];
        state.edges = [
          { courseId: ADVANCED_ID, prerequisiteId: COURSE_ID },
          { courseId: COURSE_ID, prerequisiteId: BASIC_ID },
        ];

        const failure = await httpFailure(
          service.update(BASIC_ID, { prerequisiteIds: [ADVANCED_ID] }, ACTOR_ID),
        );

        expect(failure.getResponse()).toMatchObject({ error: "PREREQUISITE_CYCLE" });
        expect(manager.save).not.toHaveBeenCalled();
      });

      it("throws 400 PREREQUISITE_CYCLE for a course that requires itself", async () => {
        const failure = await httpFailure(
          service.update(COURSE_ID, { prerequisiteIds: [COURSE_ID] }, ACTOR_ID),
        );

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({ error: "PREREQUISITE_CYCLE" });
        expect(manager.delete).not.toHaveBeenCalled();
      });

      it("accepts a new prerequisite that does not lead back to the course", async () => {
        state.edges = [
          { courseId: COURSE_ID, prerequisiteId: BASIC_ID },
          { courseId: ADVANCED_ID, prerequisiteId: BASIC_ID },
        ];

        const result = await service.update(
          COURSE_ID,
          { prerequisiteIds: [BASIC_ID, ADVANCED_ID] },
          ACTOR_ID,
        );

        expect(result.prerequisites.map((prerequisite) => prerequisite.id)).toEqual([
          ADVANCED_ID,
          BASIC_ID,
        ]);
        expect(manager.delete).toHaveBeenCalledTimes(1);
      });
    });

    describe("with the id of the path in upper case", () => {
      // The UUID pipe of the route accepts upper case and Postgres finds the row all the same, but
      // the links of the graph and the ids of the body are the lower case ones of the database:
      // the service has to work with the id of the course it loaded, not with the one it received.
      const UPPER_ID = COURSE_ID.toUpperCase();

      it("throws 400 PREREQUISITE_CYCLE for a transitive cycle and writes nothing", async () => {
        // Básica requires Intermediária and Avançada requires Básica: Intermediária cannot require Avançada.
        state.links = [];
        state.edges = [
          { courseId: BASIC_ID, prerequisiteId: COURSE_ID },
          { courseId: ADVANCED_ID, prerequisiteId: BASIC_ID },
        ];

        const failure = await httpFailure(
          service.update(UPPER_ID, { prerequisiteIds: [ADVANCED_ID] }, ACTOR_ID),
        );

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({ error: "PREREQUISITE_CYCLE" });
        expect(manager.delete).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it("throws 400 PREREQUISITE_CYCLE, not a database error, for a course that requires itself", async () => {
        state.links = [];
        state.edges = [];

        const failure = await httpFailure(
          service.update(UPPER_ID, { prerequisiteIds: [COURSE_ID] }, ACTOR_ID),
        );

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({ error: "PREREQUISITE_CYCLE" });
        expect(manager.delete).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
      });

      it("looks the course up with the id received and writes, compares and emits with the id of the database", async () => {
        await service.update(
          UPPER_ID,
          { name: "Informática Média", prerequisiteIds: [ADVANCED_ID] },
          ACTOR_ID,
        );

        // The lookup is the one place that uses the id as it came: Postgres reads the uuid in any case.
        expect(manager.findOne).toHaveBeenCalledWith(Course, {
          where: { id: UPPER_ID },
          lock: { mode: "pessimistic_write" },
        });
        expect(builder.andWhere).toHaveBeenCalledWith("course.id <> :exceptId", {
          exceptId: COURSE_ID,
        });
        expect(manager.find).toHaveBeenCalledWith(CoursePrerequisite, {
          where: { courseId: COURSE_ID },
        });
        expect(manager.delete).toHaveBeenCalledWith(CoursePrerequisite, { courseId: COURSE_ID });
        expect(manager.create).toHaveBeenCalledWith(CoursePrerequisite, {
          courseId: COURSE_ID,
          prerequisiteId: ADVANCED_ID,
        });
        const [event] = emittedEvents();
        expect(event.action).toBe(AuditableAction.COURSE_UPDATED);
        expect(event.targetId).toBe(COURSE_ID);
      });
    });

    it("throws 400 PREREQUISITE_NOT_FOUND and writes nothing", async () => {
      const failure = await httpFailure(
        service.update(COURSE_ID, { prerequisiteIds: [UNKNOWN_ID] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "PREREQUISITE_NOT_FOUND",
        message: "One or more prerequisites do not exist.",
      });
      expect(order).not.toContain("load-edges");
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("rejects a newly added archived prerequisite and keeps an already linked archived one", async () => {
      const archive = { archivedAt: CREATED_AT, archivedById: ACTOR_ID };
      state.courses = [buildBasic({ archive }), buildAdvanced({ archive }), buildCourse()];

      // Avançada is archived and not linked yet: refused.
      const failure = await httpFailure(
        service.update(COURSE_ID, { prerequisiteIds: [BASIC_ID, ADVANCED_ID] }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "PREREQUISITE_ARCHIVED",
        message: "An archived course cannot be added as a prerequisite.",
      });
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();

      // Básica is archived but already linked: it stays, next to a new active course.
      state.courses = [buildBasic({ archive }), buildAdvanced(), buildCourse()];
      const result = await service.update(
        COURSE_ID,
        { prerequisiteIds: [BASIC_ID, ADVANCED_ID] },
        ACTOR_ID,
      );

      expect(result.prerequisites.map((prerequisite) => prerequisite.id)).toEqual([
        ADVANCED_ID,
        BASIC_ID,
      ]);
      expect(manager.delete).toHaveBeenCalledTimes(1);
    });

    it("answers the errors of the prerequisites in the order not found, archived, cycle", async () => {
      state.course = buildBasic();
      state.links = [];
      const archive = { archivedAt: CREATED_AT, archivedById: ACTOR_ID };

      // Intermediária would close a cycle, is archived, and the other id does not exist.
      state.courses = [buildBasic(), buildCourse({ archive })];
      const notFound = await httpFailure(
        service.update(BASIC_ID, { prerequisiteIds: [COURSE_ID, UNKNOWN_ID] }, ACTOR_ID),
      );
      expect(notFound.getResponse()).toMatchObject({ error: "PREREQUISITE_NOT_FOUND" });

      const archived = await httpFailure(
        service.update(BASIC_ID, { prerequisiteIds: [COURSE_ID] }, ACTOR_ID),
      );
      expect(archived.getResponse()).toMatchObject({ error: "PREREQUISITE_ARCHIVED" });

      state.courses = [buildBasic(), buildCourse()];
      const cycle = await httpFailure(
        service.update(BASIC_ID, { prerequisiteIds: [COURSE_ID] }, ACTOR_ID),
      );
      expect(cycle.getResponse()).toMatchObject({ error: "PREREQUISITE_CYCLE" });
    });

    it("answers COURSE_NAME_TAKEN before the problems with the prerequisites", async () => {
      state.nameTaken = true;

      const failure = await httpFailure(
        service.update(
          COURSE_ID,
          { name: "Informática Básica", prerequisiteIds: [UNKNOWN_ID] },
          ACTOR_ID,
        ),
      );

      expect(failure.getResponse()).toMatchObject({ error: "COURSE_NAME_TAKEN" });
      expect(order).not.toContain("load-edges");
    });

    it("touches updatedAt with the clock when only the prerequisites change", async () => {
      const result = await service.update(COURSE_ID, { prerequisiteIds: [ADVANCED_ID] }, ACTOR_ID);

      // One save for the new prerequisite rows (a list) and one for the course itself.
      const savedCourses = manager.save.mock.calls.filter((call) => call[0] instanceof Course);
      expect(savedCourses).toHaveLength(1);
      expect(order.slice(-4)).toEqual(["insert-prerequisites", "save-course", "commit", "emit"]);
      expect(result.updatedAt).toEqual(NOW);
      expect(result.createdAt).toEqual(CREATED_AT);
    });

    it("emits COURSE_UPDATED after the commit with only the changed fields", async () => {
      await service.update(
        COURSE_ID,
        {
          name: "Informática Média",
          description: "Planilhas, textos e apresentações.",
          objective: null,
          category: CourseCategory.ADVANCED,
          prerequisiteIds: [ADVANCED_ID, BASIC_ID],
        },
        ACTOR_ID,
      );

      expect(order.slice(-2)).toEqual(["commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(AUDITABLE_ACTION_EVENT, expect.anything());

      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.COURSE_UPDATED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("course");
      expect(event.targetId).toBe(COURSE_ID);
      // The description was sent but did not change: it is in neither snapshot.
      expect(event.before).toEqual({
        name: "Informática Intermediária",
        objective: "Preparar o aluno para as ferramentas de escritório.",
        category: CourseCategory.INTERMEDIATE,
        prerequisiteIds: [BASIC_ID],
      });
      expect(event.after).toEqual({
        name: "Informática Média",
        objective: null,
        category: CourseCategory.ADVANCED,
        // Sorted: the set has no order.
        prerequisiteIds: [BASIC_ID, ADVANCED_ID],
        changedFields: ["name", "objective", "category", "prerequisiteIds"],
      });
      expect(event.occurredAt).toEqual(NOW);
    });

    it("emits only the prerequisites when only they change", async () => {
      await service.update(COURSE_ID, { prerequisiteIds: [] }, ACTOR_ID);

      const [event] = emittedEvents();
      expect(event.before).toEqual({ prerequisiteIds: [BASIC_ID] });
      expect(event.after).toEqual({ prerequisiteIds: [], changedFields: ["prerequisiteIds"] });
    });

    it("is a no-op without event when nothing changed", async () => {
      const unchanged = await service.update(
        COURSE_ID,
        {
          name: "Informática Intermediária",
          description: "Planilhas, textos e apresentações.",
          objective: "Preparar o aluno para as ferramentas de escritório.",
          category: CourseCategory.INTERMEDIATE,
          prerequisiteIds: [BASIC_ID],
        },
        ACTOR_ID,
      );
      const empty = await service.update(COURSE_ID, {}, ACTOR_ID);

      expect(unchanged.id).toBe(COURSE_ID);
      expect(unchanged.updatedAt).toEqual(CREATED_AT);
      expect(empty.id).toBe(COURSE_ID);
      expect(empty.updatedAt).toEqual(CREATED_AT);
      expect(order).not.toContain("load-edges");
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not emit when the transaction fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(
        service.update(COURSE_ID, { category: CourseCategory.ADVANCED }, ACTOR_ID),
      ).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not emit when the insert of the new prerequisite rows fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(
        service.update(COURSE_ID, { prerequisiteIds: [ADVANCED_ID] }, ACTOR_ID),
      ).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("toCourseResponse()", () => {
    it("answers status active for a new course and archived when archivedAt is set", () => {
      expect(toCourseResponse(buildCourse(), []).status).toBe(CourseStatus.ACTIVE);

      const archived = toCourseResponse(
        buildCourse({
          archive: { archivedAt: NOW, archivedById: ACTOR_ID, archiveReason: "Conteúdo revisado." },
        }),
        [],
      );
      expect(archived.status).toBe(CourseStatus.ARCHIVED);
      expect(archived.archivedAt).toEqual(NOW);
      expect(archived.archivedById).toBe(ACTOR_ID);
      expect(archived.archiveReason).toBe("Conteúdo revisado.");
    });

    it("answers null for the objective and the archive data when the entity has none", () => {
      const bare = Object.assign(buildCourse(), { objective: undefined, archive: undefined });

      const result = toCourseResponse(bare as unknown as Course, []);

      expect(result.objective).toBeNull();
      expect(result.status).toBe(CourseStatus.ACTIVE);
      expect(result.archivedAt).toBeNull();
      expect(result.archivedById).toBeNull();
      expect(result.archiveReason).toBeNull();
    });

    it("orders the prerequisites by name with the Portuguese collation", () => {
      const names = ["Zeta", "Álgebra", "Banco de Dados", "algoritmos"];
      const prerequisites = names.map((name, index) =>
        buildCourse({ id: `prerequisite-${index}`, name }),
      );

      const result = toCourseResponse(buildCourse(), prerequisites);

      // "Álgebra" sorts as "algebra" (before "algoritmos"), not after "Zeta" as its code point would.
      expect(result.prerequisites.map((prerequisite) => prerequisite.name)).toEqual([
        "Álgebra",
        "algoritmos",
        "Banco de Dados",
        "Zeta",
      ]);
      expect(Object.keys(result.prerequisites[0]).sort()).toEqual(["id", "name"]);
    });

    it("does not change the list it receives", () => {
      const prerequisites = [buildAdvanced(), buildBasic()];

      toCourseResponse(buildCourse(), prerequisites);

      expect(prerequisites.map((prerequisite) => prerequisite.id)).toEqual([ADVANCED_ID, BASIC_ID]);
    });
  });

  describe("getCourseSummary()", () => {
    it("returns id, name, category and status, and null for an unknown or malformed id", async () => {
      courseRepository.findOne.mockResolvedValue(buildBasic());

      await expect(service.getCourseSummary(BASIC_ID)).resolves.toEqual({
        id: BASIC_ID,
        name: "Informática Básica",
        category: CourseCategory.BASIC,
        status: CourseStatus.ACTIVE,
      });
      expect(courseRepository.findOne).toHaveBeenCalledWith({ where: { id: BASIC_ID } });

      courseRepository.findOne.mockResolvedValue(null);
      await expect(service.getCourseSummary(UNKNOWN_ID)).resolves.toBeNull();

      courseRepository.findOne.mockClear();
      for (const malformed of ["not-a-uuid", "", "123", `${BASIC_ID}x`]) {
        await expect(service.getCourseSummary(malformed)).resolves.toBeNull();
      }
      // A malformed id never reaches the database.
      expect(courseRepository.findOne).not.toHaveBeenCalled();
    });

    it("keeps an archived course readable, with status archived", async () => {
      courseRepository.findOne.mockResolvedValue(
        buildAdvanced({ archive: { archivedAt: NOW, archivedById: ACTOR_ID } }),
      );

      await expect(service.getCourseSummary(ADVANCED_ID)).resolves.toEqual({
        id: ADVANCED_ID,
        name: "Informática Avançada",
        category: CourseCategory.ADVANCED,
        status: CourseStatus.ARCHIVED,
      });
    });

    it("exposes only id, name, category and status", async () => {
      courseRepository.findOne.mockResolvedValue(buildBasic());

      const summary = await service.getCourseSummary(BASIC_ID);

      expect(Object.keys(summary ?? {}).sort()).toEqual(["category", "id", "name", "status"]);
    });

    it("reads through the manager of the caller when it is given", async () => {
      const inTransaction = { findOne: jest.fn().mockResolvedValue(buildBasic()) };
      manager.getRepository.mockReturnValue(inTransaction);

      const summary = await service.getCourseSummary(
        BASIC_ID,
        manager as unknown as Parameters<CoursesService["getCourseSummary"]>[1],
      );

      expect(summary?.id).toBe(BASIC_ID);
      expect(manager.getRepository).toHaveBeenCalledWith(Course);
      expect(inTransaction.findOne).toHaveBeenCalledWith({ where: { id: BASIC_ID } });
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it("reads without a transaction, a lock or an audit event", async () => {
      courseRepository.findOne.mockResolvedValue(buildBasic());

      await service.getCourseSummary(BASIC_ID);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(courseRepository.findOne.mock.calls[0][0]).not.toHaveProperty("lock");
    });
  });
});
