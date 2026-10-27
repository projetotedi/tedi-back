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
import { CreateClassDto } from "../dto/create-class.dto";
import { SchoolClass } from "../entities/class.entity";
import { Edition } from "../entities/edition.entity";
import { ClassStatus } from "../enums/class-status.enum";
import { toClassResponse } from "../services/class-response.mapper";
import { ClassesService } from "../services/classes.service";
import { EditionsService } from "../services/editions.service";
import { EnrollmentCountsService } from "../services/enrollment-counts.service";

const NOW = new Date("2026-10-02T01:30:00.000Z");
const LATER = new Date("2026-10-02T01:30:05.000Z");
const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const EDITION_ID = "01999a3e-7c1b-7000-8000-0000000000e1";
const NEXT_EDITION_ID = "01999a3e-7c1b-7000-8000-0000000000e2";

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
    editionId: EDITION_ID,
    startDate: "2026-03-03",
    endDate: "2026-06-27",
    location: null,
    capacity: 15,
    status: ClassStatus.PLANNED,
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

function buildEdition(overrides: Partial<Edition> = {}): Edition {
  return Object.assign(new Edition(), {
    id: EDITION_ID,
    name: "2026.1",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  });
}

function violation(code: string, constraint: string): QueryFailedError {
  const driverError = Object.assign(new Error(`violates constraint ${constraint}`), {
    code,
    constraint,
  });
  return new QueryFailedError("INSERT INTO classes", [], driverError);
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

describe("ClassesService", () => {
  let service: ClassesService;
  let order: string[];
  let state: {
    row: SchoolClass | null;
    edition: Edition;
    found: { edition: Edition; created: boolean };
    codeTaken: boolean;
    active: number;
  };

  const builder = { where: jest.fn(), andWhere: jest.fn(), getExists: jest.fn() };
  const manager = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const dataSource = { transaction: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  // Fixed at NOW. A test that needs to tell two reads of the clock apart makes the next ones LATER.
  const clock = { now: jest.fn() };
  const editions = { findOrCreate: jest.fn() };
  const enrollmentCounts = { countActive: jest.fn() };

  function emittedEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls.map((call) => call[1] as AuditableActionEvent);
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    order = [];
    state = {
      row: buildClass(),
      edition: buildEdition(),
      found: { edition: buildEdition(), created: false },
      codeTaken: false,
      active: 0,
    };

    builder.where.mockReturnValue(builder);
    builder.andWhere.mockReturnValue(builder);
    builder.getExists.mockImplementation(async () => {
      order.push("check-code");
      return state.codeTaken;
    });
    manager.createQueryBuilder.mockReturnValue(builder);
    manager.create.mockImplementation((target: new () => object, data: Record<string, unknown>) =>
      Object.assign(new target(), {
        id: CLASS_ID,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        deletedAt: null,
        ...data,
      }),
    );
    manager.save.mockImplementation(async (entity: unknown) => {
      order.push("save-class");
      return entity;
    });
    manager.findOne.mockImplementation(async (target: unknown) => {
      if (target !== SchoolClass) return null;
      order.push("load-class");
      return state.row;
    });
    manager.findOneOrFail.mockImplementation(async (target: unknown) => {
      if (target !== Edition) throw new Error("Unexpected entity");
      order.push("load-edition");
      return state.edition;
    });
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => Promise<unknown>) => {
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
    editions.findOrCreate.mockImplementation(async () => {
      order.push("find-or-create-edition");
      return state.found;
    });
    enrollmentCounts.countActive.mockImplementation(async () => {
      order.push("count-active");
      return state.active;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClassesService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: EditionsService, useValue: editions },
        { provide: EnrollmentCountsService, useValue: enrollmentCounts },
      ],
    }).compile();

    service = moduleRef.get(ClassesService);
  });

  describe("create()", () => {
    const dto: CreateClassDto = {
      courseId: COURSE_ID,
      code: "INFO-A",
      editionName: "2026.1",
      startDate: "2026-03-03",
      endDate: "2026-06-27",
      capacity: 15,
    };

    beforeEach(() => {
      state.found = { edition: buildEdition(), created: true };
    });

    it("creates INFO-A in 2026.1 with the edition of the transaction, createdById = actor and status planned", async () => {
      const result = await service.create(dto, ACTOR_ID);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(editions.findOrCreate).toHaveBeenCalledWith(manager, "2026.1");
      expect(manager.create).toHaveBeenCalledWith(SchoolClass, {
        code: "INFO-A",
        name: null,
        courseId: COURSE_ID,
        editionId: EDITION_ID,
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        location: null,
        capacity: 15,
        status: ClassStatus.PLANNED,
        createdById: ACTOR_ID,
      });
      expect(order).toEqual([
        "find-or-create-edition",
        "check-code",
        "save-class",
        "commit",
        "emit",
      ]);

      expect(result).toEqual({
        id: CLASS_ID,
        code: "INFO-A",
        name: null,
        courseId: COURSE_ID,
        edition: { id: EDITION_ID, name: "2026.1" },
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        location: null,
        capacity: 15,
        status: ClassStatus.PLANNED,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: ACTOR_ID,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      });
    });

    it("stores the optional fields it receives, and the status it is given", async () => {
      const result = await service.create(
        {
          ...dto,
          name: "Informática Básica, turma A",
          location: "Laboratório 3, bloco B",
          status: ClassStatus.IN_PROGRESS,
        },
        ACTOR_ID,
      );

      expect(manager.create).toHaveBeenCalledWith(
        SchoolClass,
        expect.objectContaining({
          name: "Informática Básica, turma A",
          location: "Laboratório 3, bloco B",
          status: ClassStatus.IN_PROGRESS,
        }),
      );
      expect(result).toMatchObject({
        name: "Informática Básica, turma A",
        location: "Laboratório 3, bloco B",
        status: ClassStatus.IN_PROGRESS,
      });
    });

    it("answers planned for a status that is null or omitted, and null for a name and a location that are null", async () => {
      // A null status passes the DTO (IsOptional ignores null), so the service has to cope with it.
      const body = {
        ...dto,
        status: null,
        name: null,
        location: null,
      } as unknown as CreateClassDto;

      const result = await service.create(body, ACTOR_ID);

      expect(result.status).toBe(ClassStatus.PLANNED);
      expect(result.name).toBeNull();
      expect(result.location).toBeNull();
    });

    it("throws 400 INVALID_PERIOD before it opens a transaction when the class ends before it starts", async () => {
      const failure = await httpFailure(
        service.create({ ...dto, startDate: "2026-06-27", endDate: "2026-03-03" }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "INVALID_PERIOD",
        message: "endDate must be on or after startDate.",
        details: [{ field: "endDate", message: "endDate must be on or after startDate" }],
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(editions.findOrCreate).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("accepts a class that starts and ends on the same day", async () => {
      const result = await service.create(
        { ...dto, startDate: "2026-03-03", endDate: "2026-03-03" },
        ACTOR_ID,
      );

      expect(result.startDate).toBe("2026-03-03");
      expect(result.endDate).toBe("2026-03-03");
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it("throws 409 CLASS_CODE_TAKEN when the code exists in that edition and saves nothing", async () => {
      state.codeTaken = true;

      const failure = await httpFailure(service.create({ ...dto, code: "info-a" }, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "CLASS_CODE_TAKEN",
        message: "A class with this code already exists in this edition.",
      });
      // The pre-check looks inside the edition of the transaction, ignoring case, archived included.
      expect(manager.createQueryBuilder).toHaveBeenCalledWith(SchoolClass, "schoolClass");
      expect(builder.where).toHaveBeenCalledWith("schoolClass.editionId = :editionId", {
        editionId: EDITION_ID,
      });
      expect(builder.andWhere).toHaveBeenCalledTimes(1);
      expect(builder.andWhere).toHaveBeenCalledWith("LOWER(schoolClass.code) = LOWER(:code)", {
        code: "info-a",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("checks the code in the edition it found, not in the one it was asked for by name", async () => {
      state.found = {
        edition: buildEdition({ id: NEXT_EDITION_ID, name: "2026.2" }),
        created: false,
      };

      await service.create({ ...dto, editionName: "2026.2" }, ACTOR_ID);

      expect(builder.where).toHaveBeenCalledWith("schoolClass.editionId = :editionId", {
        editionId: NEXT_EDITION_ID,
      });
      expect(manager.create).toHaveBeenCalledWith(
        SchoolClass,
        expect.objectContaining({ editionId: NEXT_EDITION_ID }),
      );
    });

    it("maps 23505 on uq_classes_edition_id_code to 409 CLASS_CODE_TAKEN", async () => {
      manager.save.mockRejectedValueOnce(violation("23505", "uq_classes_edition_id_code"));

      const failure = await httpFailure(service.create(dto, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "CLASS_CODE_TAKEN",
        message: "A class with this code already exists in this edition.",
      });
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("maps 23503 on fk_classes_course_id to 400 COURSE_NOT_FOUND", async () => {
      manager.save.mockRejectedValueOnce(violation("23503", "fk_classes_course_id"));

      const failure = await httpFailure(service.create(dto, ACTOR_ID));

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "COURSE_NOT_FOUND",
        message: "Course not found.",
      });
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("maps 23514 on ck_classes_period to 400 INVALID_PERIOD", async () => {
      manager.save.mockRejectedValueOnce(violation("23514", "ck_classes_period"));

      const failure = await httpFailure(service.create(dto, ACTOR_ID));

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({ error: "INVALID_PERIOD" });
    });

    it("keeps any other error as it is", async () => {
      const otherIndex = violation("23505", "uq_editions_name");
      manager.save.mockRejectedValueOnce(otherIndex);
      await expect(service.create(dto, ACTOR_ID)).rejects.toBe(otherIndex);

      const otherForeignKey = violation("23503", "fk_classes_created_by_id");
      manager.save.mockRejectedValueOnce(otherForeignKey);
      await expect(service.create(dto, ACTOR_ID)).rejects.toBe(otherForeignKey);

      const otherCheck = violation("23514", "ck_classes_capacity_positive");
      manager.save.mockRejectedValueOnce(otherCheck);
      await expect(service.create(dto, ACTOR_ID)).rejects.toBe(otherCheck);

      const boom = new Error("connection lost");
      manager.save.mockRejectedValueOnce(boom);
      await expect(service.create(dto, ACTOR_ID)).rejects.toBe(boom);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits CLASS_CREATED after the commit with the class, its edition and editionCreated true", async () => {
      await service.create(
        { ...dto, name: "Turma A", location: "Sala 2", status: ClassStatus.IN_PROGRESS },
        ACTOR_ID,
      );

      expect(order.slice(-2)).toEqual(["commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(AUDITABLE_ACTION_EVENT, expect.anything());

      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.CLASS_CREATED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("class");
      expect(event.targetId).toBe(CLASS_ID);
      expect(event.before).toBeNull();
      expect(event.after).toEqual({
        code: "INFO-A",
        name: "Turma A",
        courseId: COURSE_ID,
        editionId: EDITION_ID,
        editionName: "2026.1",
        editionCreated: true,
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        location: "Sala 2",
        capacity: 15,
        status: ClassStatus.IN_PROGRESS,
      });
      expect(event.occurredAt).toEqual(NOW);
    });

    it("emits editionCreated false when the edition already existed", async () => {
      state.found = { edition: buildEdition(), created: false };

      await service.create(dto, ACTOR_ID);

      expect(emittedEvents()[0].after).toMatchObject({ editionCreated: false });
    });

    it("does not emit when the transaction fails, or when the edition cannot be found or created", async () => {
      dataSource.transaction.mockRejectedValueOnce(new Error("connection lost"));
      await expect(service.create(dto, ACTOR_ID)).rejects.toThrow("connection lost");

      editions.findOrCreate.mockRejectedValueOnce(new Error("edition failed"));
      await expect(service.create(dto, ACTOR_ID)).rejects.toThrow("edition failed");

      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("update()", () => {
    it("throws 404 CLASS_NOT_FOUND when the class does not exist", async () => {
      state.row = null;

      const failure = await httpFailure(service.update(CLASS_ID, { capacity: 20 }, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "CLASS_NOT_FOUND",
        message: "Class not found.",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("locks the row of the class for the whole edit", async () => {
      await service.update(CLASS_ID, {}, ACTOR_ID);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.findOne).toHaveBeenCalledWith(SchoolClass, {
        where: { id: CLASS_ID },
        lock: { mode: "pessimistic_write" },
      });
    });

    it("throws 409 CLASS_ARCHIVED, answering it before any other check, and writes nothing", async () => {
      state.row = buildClass({ archive: { archivedAt: CREATED_AT, archivedById: ACTOR_ID } });
      state.codeTaken = true;
      state.active = 10;

      const failure = await httpFailure(
        service.update(
          CLASS_ID,
          { code: "INFO-B", startDate: "2026-12-01", capacity: 5, editionName: "2026.2" },
          ACTOR_ID,
        ),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "CLASS_ARCHIVED",
        message: "Archived classes are read-only.",
      });
      expect(editions.findOrCreate).not.toHaveBeenCalled();
      expect(builder.getExists).not.toHaveBeenCalled();
      expect(enrollmentCounts.countActive).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    describe("the period", () => {
      it("throws 400 INVALID_PERIOD when only endDate is sent and falls before the startDate stored", async () => {
        const failure = await httpFailure(
          service.update(CLASS_ID, { endDate: "2026-03-02" }, ACTOR_ID),
        );

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({
          error: "INVALID_PERIOD",
          details: [{ field: "endDate", message: "endDate must be on or after startDate" }],
        });
        expect(manager.save).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it("throws 400 INVALID_PERIOD when only startDate is sent and falls after the endDate stored", async () => {
        const failure = await httpFailure(
          service.update(CLASS_ID, { startDate: "2026-06-28" }, ACTOR_ID),
        );

        expect(failure.getResponse()).toMatchObject({ error: "INVALID_PERIOD" });
        expect(manager.save).not.toHaveBeenCalled();
      });

      it("accepts a new endDate that is the stored startDate, and a new period that moves both", async () => {
        const sameDay = await service.update(CLASS_ID, { endDate: "2026-03-03" }, ACTOR_ID);
        expect(sameDay.endDate).toBe("2026-03-03");

        state.row = buildClass();
        const moved = await service.update(
          CLASS_ID,
          { startDate: "2026-08-03", endDate: "2026-12-12" },
          ACTOR_ID,
        );
        expect(moved).toMatchObject({ startDate: "2026-08-03", endDate: "2026-12-12" });
      });

      it("judges the dates sent together, whatever the ones stored are", async () => {
        const failure = await httpFailure(
          service.update(CLASS_ID, { startDate: "2027-01-10", endDate: "2027-01-09" }, ACTOR_ID),
        );

        expect(failure.getResponse()).toMatchObject({ error: "INVALID_PERIOD" });
      });

      it("does not check the period when no date is sent", async () => {
        const result = await service.update(CLASS_ID, { capacity: 20 }, ACTOR_ID);

        expect(result.capacity).toBe(20);
        expect(editions.findOrCreate).not.toHaveBeenCalled();
      });
    });

    describe("the code", () => {
      it("checks the new code in the edition of the class, leaving the class itself out", async () => {
        await service.update(CLASS_ID, { code: "INFO-B" }, ACTOR_ID);

        expect(builder.where).toHaveBeenCalledWith("schoolClass.editionId = :editionId", {
          editionId: EDITION_ID,
        });
        expect(builder.andWhere).toHaveBeenCalledWith("LOWER(schoolClass.code) = LOWER(:code)", {
          code: "INFO-B",
        });
        expect(builder.andWhere).toHaveBeenCalledWith("schoolClass.id <> :exceptId", {
          exceptId: CLASS_ID,
        });
      });

      it("throws 409 CLASS_CODE_TAKEN when another class of the edition has the code", async () => {
        state.codeTaken = true;

        const failure = await httpFailure(service.update(CLASS_ID, { code: "INFO-B" }, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "CLASS_CODE_TAKEN",
          message: "A class with this code already exists in this edition.",
        });
        expect(manager.save).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it("lets the class change only the case of its own code", async () => {
        const result = await service.update(CLASS_ID, { code: "info-a" }, ACTOR_ID);

        // The check ran, with the class left out, and found nobody else: the change goes through.
        expect(builder.getExists).toHaveBeenCalledTimes(1);
        expect(builder.andWhere).toHaveBeenCalledWith("schoolClass.id <> :exceptId", {
          exceptId: CLASS_ID,
        });
        expect(result.code).toBe("info-a");
        expect(manager.save).toHaveBeenCalledTimes(1);
      });

      it("does not check the code when it did not change", async () => {
        await service.update(CLASS_ID, { code: "INFO-A", capacity: 20 }, ACTOR_ID);

        expect(builder.getExists).not.toHaveBeenCalled();
      });

      it("maps 23505 on uq_classes_edition_id_code at the save to 409 CLASS_CODE_TAKEN and keeps any other error", async () => {
        manager.save.mockRejectedValueOnce(violation("23505", "uq_classes_edition_id_code"));

        const failure = await httpFailure(service.update(CLASS_ID, { code: "INFO-B" }, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toMatchObject({ error: "CLASS_CODE_TAKEN" });

        state.row = buildClass();
        const boom = new Error("connection lost");
        manager.save.mockRejectedValueOnce(boom);
        await expect(service.update(CLASS_ID, { code: "INFO-B" }, ACTOR_ID)).rejects.toBe(boom);

        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });
    });

    describe("the edition", () => {
      beforeEach(() => {
        state.found = {
          edition: buildEdition({ id: NEXT_EDITION_ID, name: "2026.2" }),
          created: true,
        };
      });

      it("moves the class to the edition of that name and answers with it", async () => {
        const result = await service.update(CLASS_ID, { editionName: "2026.2" }, ACTOR_ID);

        expect(editions.findOrCreate).toHaveBeenCalledWith(manager, "2026.2");
        expect(manager.save).toHaveBeenCalledWith(
          expect.objectContaining({ id: CLASS_ID, editionId: NEXT_EDITION_ID }),
        );
        expect(result.edition).toEqual({ id: NEXT_EDITION_ID, name: "2026.2" });
      });

      it("checks the code of the class in the new edition, even though the code did not change", async () => {
        await service.update(CLASS_ID, { editionName: "2026.2" }, ACTOR_ID);

        expect(builder.where).toHaveBeenCalledWith("schoolClass.editionId = :editionId", {
          editionId: NEXT_EDITION_ID,
        });
        expect(builder.andWhere).toHaveBeenCalledWith("LOWER(schoolClass.code) = LOWER(:code)", {
          code: "INFO-A",
        });
        expect(builder.andWhere).toHaveBeenCalledWith("schoolClass.id <> :exceptId", {
          exceptId: CLASS_ID,
        });
      });

      it("throws 409 CLASS_CODE_TAKEN when the code is already in the new edition", async () => {
        state.codeTaken = true;

        const failure = await httpFailure(
          service.update(CLASS_ID, { editionName: "2026.2" }, ACTOR_ID),
        );

        expect(failure.getResponse()).toMatchObject({ error: "CLASS_CODE_TAKEN" });
        expect(manager.save).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it("does not look for the edition when the name is the one the class already has", async () => {
        const result = await service.update(CLASS_ID, { editionName: "2026.1" }, ACTOR_ID);

        expect(editions.findOrCreate).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
        expect(result.edition).toEqual({ id: EDITION_ID, name: "2026.1" });
      });

      it("records the edition in the event, by id and by name", async () => {
        await service.update(CLASS_ID, { editionName: "2026.2" }, ACTOR_ID);

        const [event] = emittedEvents();
        expect(event.before).toEqual({ editionId: EDITION_ID, editionName: "2026.1" });
        expect(event.after).toEqual({
          editionId: NEXT_EDITION_ID,
          editionName: "2026.2",
          changedFields: ["editionId", "editionName"],
        });
      });
    });

    describe("the seats", () => {
      it("throws 409 CAPACITY_BELOW_ENROLLED when the seats fall below the active enrollments", async () => {
        state.active = 10;

        const failure = await httpFailure(service.update(CLASS_ID, { capacity: 5 }, ACTOR_ID));

        expect(failure.getStatus()).toBe(409);
        expect(failure.getResponse()).toEqual({
          error: "CAPACITY_BELOW_ENROLLED",
          message: "The capacity cannot be lower than the number of active enrollments.",
        });
        expect(enrollmentCounts.countActive).toHaveBeenCalledWith(manager, CLASS_ID);
        expect(manager.save).not.toHaveBeenCalled();
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it("accepts seats equal to the active enrollments", async () => {
        state.active = 10;

        const result = await service.update(CLASS_ID, { capacity: 10 }, ACTOR_ID);

        expect(result.capacity).toBe(10);
        expect(manager.save).toHaveBeenCalledTimes(1);
      });

      it("accepts more seats than the class has now", async () => {
        state.active = 3;

        const result = await service.update(CLASS_ID, { capacity: 30 }, ACTOR_ID);

        expect(result.capacity).toBe(30);
        expect(enrollmentCounts.countActive).toHaveBeenCalledWith(manager, CLASS_ID);
      });

      it("does not count the enrollments when the seats did not change or were not sent", async () => {
        state.active = 100;

        await service.update(CLASS_ID, { capacity: 15, location: "Sala 2" }, ACTOR_ID);
        await service.update(CLASS_ID, { location: "Sala 3" }, ACTOR_ID);

        expect(enrollmentCounts.countActive).not.toHaveBeenCalled();
      });
    });

    it("answers the errors of an edit in the order period, code, seats", async () => {
      state.codeTaken = true;
      state.active = 10;

      const period = await httpFailure(
        service.update(CLASS_ID, { endDate: "2026-03-02", code: "INFO-B", capacity: 5 }, ACTOR_ID),
      );
      expect(period.getResponse()).toMatchObject({ error: "INVALID_PERIOD" });

      const code = await httpFailure(
        service.update(CLASS_ID, { code: "INFO-B", capacity: 5 }, ACTOR_ID),
      );
      expect(code.getResponse()).toMatchObject({ error: "CLASS_CODE_TAKEN" });

      state.codeTaken = false;
      const seats = await httpFailure(service.update(CLASS_ID, { capacity: 5 }, ACTOR_ID));
      expect(seats.getResponse()).toMatchObject({ error: "CAPACITY_BELOW_ENROLLED" });
    });

    it("updates the fields sent, clears name and location sent as null and takes any status", async () => {
      state.row = buildClass({
        name: "Turma A",
        location: "Sala 2",
        status: ClassStatus.COMPLETED,
      });

      const result = await service.update(
        CLASS_ID,
        {
          code: "INFO-B",
          name: null,
          location: null,
          startDate: "2026-03-10",
          endDate: "2026-07-04",
          capacity: 20,
          status: ClassStatus.PLANNED,
        },
        ACTOR_ID,
      );

      expect(result).toMatchObject({
        id: CLASS_ID,
        code: "INFO-B",
        name: null,
        location: null,
        startDate: "2026-03-10",
        endDate: "2026-07-04",
        capacity: 20,
        status: ClassStatus.PLANNED,
        courseId: COURSE_ID,
        createdById: ACTOR_ID,
        updatedAt: NOW,
        createdAt: CREATED_AT,
      });
      expect(order.slice(-3)).toEqual(["save-class", "commit", "emit"]);
    });

    it("never changes the course", async () => {
      const result = await service.update(
        CLASS_ID,
        { courseId: "01999a3e-7c1b-7000-8000-0000000000ff", capacity: 20 } as never,
        ACTOR_ID,
      );

      expect(result.courseId).toBe(COURSE_ID);
      expect(emittedEvents()[0].after).not.toHaveProperty("courseId");
    });

    it("is a no-op without event when nothing changed", async () => {
      const unchanged = await service.update(
        CLASS_ID,
        {
          code: "INFO-A",
          name: null,
          startDate: "2026-03-03",
          endDate: "2026-06-27",
          location: null,
          capacity: 15,
          status: ClassStatus.PLANNED,
          editionName: "2026.1",
        },
        ACTOR_ID,
      );
      const empty = await service.update(CLASS_ID, {}, ACTOR_ID);

      expect(unchanged.updatedAt).toEqual(CREATED_AT);
      expect(empty.updatedAt).toEqual(CREATED_AT);
      expect(manager.save).not.toHaveBeenCalled();
      expect(editions.findOrCreate).not.toHaveBeenCalled();
      expect(builder.getExists).not.toHaveBeenCalled();
      expect(enrollmentCounts.countActive).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits CLASS_UPDATED after the commit with only the fields that changed", async () => {
      await service.update(
        CLASS_ID,
        { code: "INFO-B", capacity: 15, location: "Sala 2", status: ClassStatus.IN_PROGRESS },
        ACTOR_ID,
      );

      expect(order.slice(-2)).toEqual(["commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(AUDITABLE_ACTION_EVENT, expect.anything());

      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.CLASS_UPDATED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("class");
      expect(event.targetId).toBe(CLASS_ID);
      // The capacity was sent but did not change: it is in neither snapshot.
      expect(event.before).toEqual({
        code: "INFO-A",
        location: null,
        status: ClassStatus.PLANNED,
      });
      expect(event.after).toEqual({
        code: "INFO-B",
        location: "Sala 2",
        status: ClassStatus.IN_PROGRESS,
        changedFields: ["code", "location", "status"],
      });
      expect(event.occurredAt).toEqual(NOW);
    });

    it("answers with the edition it read in the transaction, not with one from the body", async () => {
      state.edition = buildEdition({ id: EDITION_ID, name: "2026.1" });

      const result = await service.update(CLASS_ID, { capacity: 20 }, ACTOR_ID);

      expect(manager.findOneOrFail).toHaveBeenCalledWith(Edition, {
        where: { id: EDITION_ID },
        withDeleted: true,
      });
      expect(result.edition).toEqual({ id: EDITION_ID, name: "2026.1" });
    });

    it("does not emit when the transaction fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.update(CLASS_ID, { capacity: 20 }, ACTOR_ID)).rejects.toThrow(
        "connection lost",
      );

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    describe("with the id of the path in upper case", () => {
      // The UUID pipe of the route accepts upper case and Postgres finds the row all the same, but
      // the ids of the database are lower case: the service works with the id of the class it
      // loaded, not with the one it received.
      const UPPER_ID = CLASS_ID.toUpperCase();

      it("looks the class up with the id received and compares, writes and emits with the id of the database", async () => {
        await service.update(UPPER_ID, { code: "INFO-B" }, ACTOR_ID);

        expect(manager.findOne).toHaveBeenCalledWith(SchoolClass, {
          where: { id: UPPER_ID },
          lock: { mode: "pessimistic_write" },
        });
        expect(builder.andWhere).toHaveBeenCalledWith("schoolClass.id <> :exceptId", {
          exceptId: CLASS_ID,
        });
        expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ id: CLASS_ID }));
        expect(emittedEvents()[0].targetId).toBe(CLASS_ID);
      });
    });
  });

  describe("archive()", () => {
    it("throws 404 CLASS_NOT_FOUND when the class does not exist", async () => {
      state.row = null;

      const failure = await httpFailure(service.archive(CLASS_ID, undefined, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toMatchObject({ error: "CLASS_NOT_FOUND" });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("locks the row of the class", async () => {
      await service.archive(CLASS_ID, undefined, ACTOR_ID);

      expect(manager.findOne).toHaveBeenCalledWith(SchoolClass, {
        where: { id: CLASS_ID },
        lock: { mode: "pessimistic_write" },
      });
    });

    it("throws 409 CLASS_HAS_ACTIVE_ENROLLMENTS when the class has active enrollments and writes nothing", async () => {
      state.active = 2;

      const failure = await httpFailure(service.archive(CLASS_ID, undefined, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "CLASS_HAS_ACTIVE_ENROLLMENTS",
        message: "A class with active enrollments cannot be archived.",
      });
      expect(enrollmentCounts.countActive).toHaveBeenCalledWith(manager, CLASS_ID);
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("archives a class without active enrollments, with the actor, the reason and the time of the clock", async () => {
      const result = await service.archive(CLASS_ID, { reason: "Turma encerrada." }, ACTOR_ID);

      expect(result).toMatchObject({
        id: CLASS_ID,
        archivedAt: NOW,
        archivedById: ACTOR_ID,
        archiveReason: "Turma encerrada.",
        updatedAt: NOW,
        // Archiving never touches the status (RF-034).
        status: ClassStatus.PLANNED,
        edition: { id: EDITION_ID, name: "2026.1" },
      });
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(order).toEqual([
        "load-class",
        "count-active",
        "save-class",
        "load-edition",
        "commit",
        "emit",
      ]);
    });

    it("takes archivedAt and updatedAt from the same read of the clock, in the row it saves", async () => {
      // The first read is the time of the archive; the event reads the clock again, later.
      clock.now.mockReturnValueOnce(NOW).mockReturnValue(LATER);

      const result = await service.archive(CLASS_ID, undefined, ACTOR_ID);

      const [saved] = manager.save.mock.calls[0] as [SchoolClass];
      expect(saved.archive.archivedAt).toEqual(NOW);
      expect(saved.updatedAt).toEqual(NOW);
      expect(result.archivedAt).toEqual(NOW);
      expect(result.updatedAt).toEqual(NOW);
      expect(emittedEvents()[0].occurredAt).toEqual(LATER);
    });

    it("stores a null reason when there is no body or no reason", async () => {
      const withoutBody = await service.archive(CLASS_ID, undefined, ACTOR_ID);
      expect(withoutBody.archiveReason).toBeNull();

      state.row = buildClass();
      const withoutReason = await service.archive(CLASS_ID, {}, ACTOR_ID);
      expect(withoutReason.archiveReason).toBeNull();
    });

    it("emits CLASS_ARCHIVED after the commit with the archive data", async () => {
      await service.archive(CLASS_ID, { reason: "Turma encerrada." }, ACTOR_ID);

      expect(order.slice(-2)).toEqual(["commit", "emit"]);
      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.CLASS_ARCHIVED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("class");
      expect(event.targetId).toBe(CLASS_ID);
      expect(event.before).toEqual({ archivedAt: null });
      expect(event.after).toEqual({ archivedAt: NOW, archiveReason: "Turma encerrada." });
      expect(event.occurredAt).toEqual(NOW);
    });

    it("is a no-op that keeps the first archive when the class is already archived, and does not even count the enrollments", async () => {
      state.row = buildClass({
        archive: { archivedAt: CREATED_AT, archivedById: "someone-else", archiveReason: "First." },
      });
      state.active = 2;

      const result = await service.archive(CLASS_ID, { reason: "Second." }, ACTOR_ID);

      expect(result).toMatchObject({
        archivedAt: CREATED_AT,
        archivedById: "someone-else",
        archiveReason: "First.",
        updatedAt: CREATED_AT,
      });
      expect(enrollmentCounts.countActive).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not emit when the save fails", async () => {
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.archive(CLASS_ID, undefined, ACTOR_ID)).rejects.toThrow(
        "connection lost",
      );

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits the id of the database when the path has it in upper case", async () => {
      await service.archive(CLASS_ID.toUpperCase(), undefined, ACTOR_ID);

      expect(enrollmentCounts.countActive).toHaveBeenCalledWith(manager, CLASS_ID);
      expect(emittedEvents()[0].targetId).toBe(CLASS_ID);
    });
  });

  describe("unarchive()", () => {
    const archive = {
      archivedAt: CREATED_AT,
      archivedById: "someone-else",
      archiveReason: "Turma encerrada.",
    };

    it("throws 404 CLASS_NOT_FOUND when the class does not exist", async () => {
      state.row = null;

      const failure = await httpFailure(service.unarchive(CLASS_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toMatchObject({ error: "CLASS_NOT_FOUND" });
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("clears the three archive columns and emits CLASS_UNARCHIVED with what they were", async () => {
      state.row = buildClass({ archive, status: ClassStatus.COMPLETED });

      const result = await service.unarchive(CLASS_ID, ACTOR_ID);

      expect(result).toMatchObject({
        id: CLASS_ID,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        updatedAt: NOW,
        // Reactivating never touches the status either.
        status: ClassStatus.COMPLETED,
      });
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(order.slice(-3)).toEqual(["load-edition", "commit", "emit"]);

      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.CLASS_UNARCHIVED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("class");
      expect(event.targetId).toBe(CLASS_ID);
      expect(event.before).toEqual({
        archivedAt: CREATED_AT,
        archivedById: "someone-else",
        archiveReason: "Turma encerrada.",
      });
      expect(event.after).toEqual({ archivedAt: null });
    });

    it("takes updatedAt from the clock, in the row it saves, like the edit does", async () => {
      state.row = buildClass({ archive });
      // The first read is the time of the reactivation; the event reads the clock again, later.
      clock.now.mockReturnValueOnce(NOW).mockReturnValue(LATER);

      const result = await service.unarchive(CLASS_ID, ACTOR_ID);

      const [saved] = manager.save.mock.calls[0] as [SchoolClass];
      expect(saved.updatedAt).toEqual(NOW);
      expect(result.updatedAt).toEqual(NOW);
      expect(emittedEvents()[0].occurredAt).toEqual(LATER);
    });

    it("is a no-op without event when the class is not archived", async () => {
      const result = await service.unarchive(CLASS_ID, ACTOR_ID);

      expect(result.archivedAt).toBeNull();
      expect(result.updatedAt).toEqual(CREATED_AT);
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("does not consult the enrollments", async () => {
      state.row = buildClass({ archive });

      await service.unarchive(CLASS_ID, ACTOR_ID);

      expect(enrollmentCounts.countActive).not.toHaveBeenCalled();
    });

    it("does not emit when the save fails", async () => {
      state.row = buildClass({ archive });
      manager.save.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.unarchive(CLASS_ID, ACTOR_ID)).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("toClassResponse()", () => {
    it("copies the class and the id and name of its edition, and nothing else of the edition", () => {
      const result = toClassResponse(
        buildClass({ name: "Turma A", location: "Sala 2", status: ClassStatus.IN_PROGRESS }),
        buildEdition(),
      );

      expect(result).toEqual({
        id: CLASS_ID,
        code: "INFO-A",
        name: "Turma A",
        courseId: COURSE_ID,
        edition: { id: EDITION_ID, name: "2026.1" },
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        location: "Sala 2",
        capacity: 15,
        status: ClassStatus.IN_PROGRESS,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdById: ACTOR_ID,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      });
    });

    it("keeps the status and shows the archive data of an archived class", () => {
      const result = toClassResponse(
        buildClass({
          status: ClassStatus.COMPLETED,
          archive: { archivedAt: NOW, archivedById: ACTOR_ID, archiveReason: "Turma encerrada." },
        }),
        buildEdition(),
      );

      expect(result.status).toBe(ClassStatus.COMPLETED);
      expect(result.archivedAt).toEqual(NOW);
      expect(result.archivedById).toBe(ACTOR_ID);
      expect(result.archiveReason).toBe("Turma encerrada.");
    });

    it("answers null for the optional fields and the archive data when the entity has none", () => {
      const bare = Object.assign(buildClass(), {
        name: undefined,
        location: undefined,
        archive: undefined,
      });

      const result = toClassResponse(bare as unknown as SchoolClass, buildEdition());

      expect(result.name).toBeNull();
      expect(result.location).toBeNull();
      expect(result.archivedAt).toBeNull();
      expect(result.archivedById).toBeNull();
      expect(result.archiveReason).toBeNull();
    });
  });
});
