import { HttpException, Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { isUUID } from "class-validator";
import { DataSource, EntityManager, In, QueryFailedError } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { isArchived } from "@shared/entities/archivable.columns";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { CourseResponseDto } from "../dto/course.response.dto";
import { CreateCourseDto } from "../dto/create-course.dto";
import { CoursePrerequisite } from "../entities/course-prerequisite.entity";
import { Course } from "../entities/course.entity";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import { courseStatusOf, toCourseResponse } from "./course-response.mapper";

const COURSE_TARGET_TYPE = "course";

/** The unique index on LOWER("name"), created by the migration (see Course). */
const COURSE_NAME_INDEX = "uq_courses_name";

export function courseNotFound(): HttpException {
  return new HttpException({ error: "COURSE_NOT_FOUND", message: "Course not found." }, 404);
}

/** The one place that builds "name taken": the pre-check and the unique violation. */
function courseNameTaken(): HttpException {
  return new HttpException(
    { error: "COURSE_NAME_TAKEN", message: "A course with this name already exists." },
    409,
  );
}

function prerequisiteNotFound(): HttpException {
  return new HttpException(
    { error: "PREREQUISITE_NOT_FOUND", message: "One or more prerequisites do not exist." },
    400,
  );
}

function prerequisiteArchived(): HttpException {
  return new HttpException(
    {
      error: "PREREQUISITE_ARCHIVED",
      message: "An archived course cannot be added as a prerequisite.",
    },
    400,
  );
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

/**
 * What another module needs to know about a course (the classes validate the `courseId` of their
 * body and take the category from here, RN-14).
 */
export interface CourseSummary {
  id: string;
  name: string;
  category: CourseCategory;
  status: CourseStatus;
}

/**
 * Courses of the catalog (RF-013, RF-021): create, edit and the prerequisites between them.
 * Exported by CatalogModule for `classes` through `getCourseSummary`.
 */
@Injectable()
export class CoursesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
  ) {}

  /**
   * Creates a course and its prerequisites in one transaction. A name that already exists,
   * ignoring case and archived courses included, answers 409 COURSE_NAME_TAKEN (a race on the
   * unique index answers the same). An id that is not a course answers 400
   * PREREQUISITE_NOT_FOUND; an archived one, 400 PREREQUISITE_ARCHIVED (RN-27).
   * Emits COURSE_CREATED after the commit.
   */
  async create(dto: CreateCourseDto, actorId: string): Promise<CourseResponseDto> {
    const prerequisiteIds = dto.prerequisiteIds ?? [];

    const created = await this.runInTransaction(async (manager) => {
      await this.assertNameAvailable(manager, dto.name);
      const prerequisites = await this.loadPrerequisiteCourses(manager, prerequisiteIds);

      const course = await manager.save(
        manager.create(Course, {
          name: dto.name,
          description: dto.description,
          objective: dto.objective ?? null,
          category: dto.category,
          createdById: actorId,
        }),
      );
      // No cycle check here: nobody requires a course that was just created, so no path can lead
      // back to it. Only an edit (update) can close a cycle.
      await this.insertPrerequisites(manager, course.id, prerequisiteIds);

      return { course, prerequisites };
    });

    this.emit(AuditableAction.COURSE_CREATED, actorId, created.course.id, null, {
      name: created.course.name,
      description: created.course.description,
      objective: created.course.objective,
      category: created.course.category,
      prerequisiteIds: sortedIds(prerequisiteIds),
    });

    return toCourseResponse(created.course, created.prerequisites);
  }

  /**
   * Summary of a course for another module. Null when the id is not a course or is not even a
   * UUID: whoever calls decides the error (the classes will answer for the `courseId` of their
   * body). An archived course is returned, with status archived. Pass the `manager` of a
   * transaction to read inside it. No transaction, no lock and no event of its own.
   */
  async getCourseSummary(id: string, manager?: EntityManager): Promise<CourseSummary | null> {
    // A malformed id would reach Postgres as invalid uuid text (22P02) and become a 500.
    if (!isUUID(id)) return null;

    const course = await (manager ?? this.dataSource)
      .getRepository(Course)
      .findOne({ where: { id } });
    if (course === null) return null;

    return {
      id: course.id,
      name: course.name,
      category: course.category,
      status: courseStatusOf(course),
    };
  }

  /** Runs the work in a transaction and turns the unique violation of the name into 409. */
  private async runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      throw this.mapNameConflict(error);
    }
  }

  /** 409 when another course already has the name, ignoring case. `exceptId` is the edited one. */
  private async assertNameAvailable(
    manager: EntityManager,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const query = manager
      .createQueryBuilder(Course, "course")
      .where("LOWER(course.name) = LOWER(:name)", { name });
    if (exceptId !== undefined) query.andWhere("course.id <> :exceptId", { exceptId });

    if (await query.getExists()) throw courseNameTaken();
  }

  /**
   * The courses behind `ids`, for the prerequisites. 400 PREREQUISITE_NOT_FOUND when any id is
   * not a course. 400 PREREQUISITE_ARCHIVED when an archived one is being added now (RN-27); the
   * ids in `currentIds` are links that already exist, so they stay valid even if archived later.
   */
  private async loadPrerequisiteCourses(
    manager: EntityManager,
    ids: readonly string[],
    currentIds: readonly string[] = [],
  ): Promise<Course[]> {
    if (ids.length === 0) return [];

    const courses = await manager.find(Course, { where: { id: In(ids) } });
    if (courses.length < ids.length) throw prerequisiteNotFound();

    const addedArchived = courses.some(
      (course) => !currentIds.includes(course.id) && isArchived(course.archive),
    );
    if (addedArchived) throw prerequisiteArchived();

    return courses;
  }

  private async insertPrerequisites(
    manager: EntityManager,
    courseId: string,
    prerequisiteIds: readonly string[],
  ): Promise<void> {
    if (prerequisiteIds.length === 0) return;

    await manager.save(
      prerequisiteIds.map((prerequisiteId) =>
        manager.create(CoursePrerequisite, { courseId, prerequisiteId }),
      ),
    );
  }

  /** Turns the unique violation of the name into 409. Any other error is kept. */
  private mapNameConflict(error: unknown): unknown {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { code?: string; constraint?: string } | undefined;
      if (driverError?.code === "23505" && driverError.constraint === COURSE_NAME_INDEX) {
        return courseNameTaken();
      }
    }
    return error;
  }

  private emit(
    action: AuditableAction,
    actorId: string,
    targetId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): void {
    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = action;
    event.targetType = COURSE_TARGET_TYPE;
    event.targetId = targetId;
    event.before = before;
    event.after = after;
    event.occurredAt = this.clock.now();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);
  }
}
