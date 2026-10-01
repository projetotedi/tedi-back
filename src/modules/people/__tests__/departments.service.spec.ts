import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import { Clock } from "@shared/dates/clock";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { Department } from "../entities/department.entity";
import { DepartmentsService } from "../services/departments.service";

const NOW = new Date("2026-10-02T01:30:00.000Z");
const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000001";

function buildDepartment(name: string, id = DEPARTMENT_ID): Department {
  return Object.assign(new Department(), {
    id,
    name,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });
}

function uniqueViolation(constraint: string): QueryFailedError {
  const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });
  return new QueryFailedError("INSERT INTO departments", [], driverError);
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

describe("DepartmentsService", () => {
  let service: DepartmentsService;

  const builder = { where: jest.fn(), getExists: jest.fn() };
  const repository = {
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const dataSource = { getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    builder.where.mockReturnValue(builder);
    builder.getExists.mockResolvedValue(false);
    repository.createQueryBuilder.mockReturnValue(builder);
    repository.create.mockImplementation((values: Partial<Department>) =>
      Object.assign(new Department(), values),
    );
    repository.save.mockImplementation(async (department: Department) =>
      Object.assign(department, { id: DEPARTMENT_ID }),
    );
    dataSource.getRepository.mockReturnValue(repository);
    clock.now.mockReturnValue(NOW);

    service = new DepartmentsService(
      dataSource as unknown as DataSource,
      eventEmitter as unknown as EventEmitter2,
      clock as unknown as Clock,
    );
  });

  it("lists departments ordered by name", async () => {
    repository.find.mockResolvedValue([
      buildDepartment("Comunicação", "01999a3e-1111-7000-8000-000000000002"),
      buildDepartment("Tecnologia"),
    ]);

    const result = await service.list();

    expect(repository.find).toHaveBeenCalledWith({ order: { name: "ASC" } });
    // Explicit projection: only id and name reach the response.
    expect(result).toStrictEqual([
      { id: "01999a3e-1111-7000-8000-000000000002", name: "Comunicação" },
      { id: DEPARTMENT_ID, name: "Tecnologia" },
    ]);
  });

  it("creates a department and emits DEPARTMENT_CREATED after the save", async () => {
    const order: string[] = [];
    repository.save.mockImplementation(async (department: Department) => {
      order.push("save");
      return Object.assign(department, { id: DEPARTMENT_ID });
    });
    eventEmitter.emit.mockImplementation(() => order.push("emit"));

    const result = await service.create({ name: "Tecnologia" }, ACTOR_ID);

    expect(result).toStrictEqual({ id: DEPARTMENT_ID, name: "Tecnologia" });
    expect(repository.create).toHaveBeenCalledWith({ name: "Tecnologia" });
    expect(order).toEqual(["save", "emit"]);

    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    const [channel, event] = eventEmitter.emit.mock.calls[0] as [string, AuditableActionEvent];
    expect(channel).toBe(AUDITABLE_ACTION_EVENT);
    expect(event).toMatchObject({
      actorId: ACTOR_ID,
      action: AuditableAction.DEPARTMENT_CREATED,
      targetType: "department",
      targetId: DEPARTMENT_ID,
      before: null,
      after: { name: "Tecnologia" },
      occurredAt: NOW,
    });
  });

  it("throws 409 DEPARTMENT_ALREADY_EXISTS for the same name in another case", async () => {
    builder.getExists.mockResolvedValue(true);

    const failure = await httpFailure(service.create({ name: "TECNOLOGIA" }, ACTOR_ID));

    expect(failure.getStatus()).toBe(409);
    expect(failure.getResponse()).toEqual({
      error: "DEPARTMENT_ALREADY_EXISTS",
      message: "Department already exists.",
    });
    // The pre-check compares ignoring case.
    expect(builder.where).toHaveBeenCalledWith("LOWER(department.name) = LOWER(:name)", {
      name: "TECNOLOGIA",
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it("maps the uq_departments_name violation to 409 DEPARTMENT_ALREADY_EXISTS", async () => {
    repository.save.mockRejectedValue(uniqueViolation("uq_departments_name"));

    const failure = await httpFailure(service.create({ name: "Tecnologia" }, ACTOR_ID));

    expect(failure.getStatus()).toBe(409);
    expect(failure.getResponse()).toEqual({
      error: "DEPARTMENT_ALREADY_EXISTS",
      message: "Department already exists.",
    });
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it("keeps any other save error and emits nothing", async () => {
    const boom = new Error("connection lost");
    repository.save.mockRejectedValue(boom);

    await expect(service.create({ name: "Tecnologia" }, ACTOR_ID)).rejects.toBe(boom);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  describe("exists()", () => {
    const manager = { exists: jest.fn() };

    it("checks the department inside the transaction of the caller", async () => {
      manager.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(
        service.exists(manager as unknown as EntityManager, DEPARTMENT_ID),
      ).resolves.toBe(true);
      await expect(service.exists(manager as unknown as EntityManager, "other")).resolves.toBe(
        false,
      );
      expect(manager.exists).toHaveBeenCalledWith(Department, { where: { id: DEPARTMENT_ID } });
    });
  });
});
