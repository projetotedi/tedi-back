import { HttpException, Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import { Clock } from "@shared/dates/clock";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { CreateDepartmentDto } from "../dto/create-department.dto";
import { DepartmentResponseDto } from "../dto/department.response.dto";
import { Department } from "../entities/department.entity";
import { toDepartmentResponse } from "./member-registration.mapper";

const DEPARTMENT_TARGET_TYPE = "department";

/** The one place that builds "department already exists": pre-check and unique violation. */
function departmentAlreadyExists(): HttpException {
  return new HttpException(
    { error: "DEPARTMENT_ALREADY_EXISTS", message: "Department already exists." },
    409,
  );
}

/**
 * Departments of the project (Tecnologia, Comunicação...): the list is data, managed by
 * coordination, not code (GUS-91). Renaming and archiving are out of scope.
 * Exported for the invites (the sign-up form lists them) and for the MembersService.
 */
@Injectable()
export class DepartmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
  ) {}

  /** Every department, ordered by name. */
  async list(): Promise<DepartmentResponseDto[]> {
    const departments = await this.dataSource
      .getRepository(Department)
      .find({ order: { name: "ASC" } });

    return departments.map(toDepartmentResponse);
  }

  /**
   * Creates a department. A name that already exists, ignoring case, answers
   * 409 DEPARTMENT_ALREADY_EXISTS (a race on the unique index answers the same).
   * Emits DEPARTMENT_CREATED after the save.
   */
  async create(dto: CreateDepartmentDto, actorId: string): Promise<DepartmentResponseDto> {
    const repository = this.dataSource.getRepository(Department);

    const taken = await repository
      .createQueryBuilder("department")
      .where("LOWER(department.name) = LOWER(:name)", { name: dto.name })
      .getExists();
    if (taken) throw departmentAlreadyExists();

    let saved: Department;
    try {
      saved = await repository.save(repository.create({ name: dto.name }));
    } catch (error) {
      throw this.mapNameConflict(error);
    }

    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = AuditableAction.DEPARTMENT_CREATED;
    event.targetType = DEPARTMENT_TARGET_TYPE;
    event.targetId = saved.id;
    event.before = null;
    event.after = { name: saved.name };
    event.occurredAt = this.clock.now();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);

    return toDepartmentResponse(saved);
  }

  /**
   * True when the department exists. Internal use of the MembersService, inside the
   * transaction of the caller (hence the EntityManager).
   */
  async exists(manager: EntityManager, id: string): Promise<boolean> {
    return manager.exists(Department, { where: { id } });
  }

  /** Turns the unique violation of the name into 409. Any other error is kept. */
  private mapNameConflict(error: unknown): unknown {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { code?: string; constraint?: string } | undefined;
      if (driverError?.code === "23505" && driverError.constraint === "uq_departments_name") {
        return departmentAlreadyExists();
      }
    }
    return error;
  }
}
