import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import { CourseLessonPlansService } from "@modules/catalog/services/course-lesson-plans.service";
import { CoursesService } from "@modules/catalog/services/courses.service";
import {
  LessonPlansService,
  LessonPlanSummary,
} from "@modules/catalog/services/lesson-plans.service";
import { ClassesService, ClassSummary } from "@modules/classes/services/classes.service";
import { Clock } from "@shared/dates/clock";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import {
  LESSON_CANCELLED_EVENT,
  LessonCancelledEvent,
} from "@shared/events/lesson-cancelled.event";
import { CancelLessonDto } from "../dto/cancel-lesson.dto";
import { CreateLessonDto } from "../dto/create-lesson.dto";
import { LessonResponseDto } from "../dto/lesson.response.dto";
import { RescheduleLessonDto } from "../dto/reschedule-lesson.dto";
import { UpdateLessonDto } from "../dto/update-lesson.dto";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";
import { LessonCreationService, LessonDraft } from "./lesson-creation.service";
import {
  classArchived,
  classNotFoundInBody,
  lessonCancelled,
  lessonNotFound,
  lessonPlanArchivedInBody,
  lessonPlanNotFoundInBody,
  lessonPlanNotInCourseSequence,
} from "./lesson-errors";
import { toLessonResponse } from "./lesson-response.mapper";
import {
  invalidTimeRange,
  isValidTimeRange,
  isWithinClassPeriod,
  lessonOutsideClassPeriod,
} from "./lesson-schedule";

/** The fields of the lesson an edit copies from the body when they differ. */
const LESSON_FIELDS = [
  "title",
  "objective",
  "location",
  "expectedStudents",
  "expectedMonitors",
  "subject",
  "postNotes",
  "status",
] as const;

/**
 * Free text that is written after the fact and may hold personal data about a student (RNF-13): the
 * audit event of an edit says that it changed, in `changedFields`, and never what it says.
 */
const UNLOGGED_VALUE_FIELDS: ReadonlySet<string> = new Set(["postNotes"]);

const LESSON_TARGET_TYPE = "lesson";

const LESSON_TIME_RANGE_CHECK = "ck_lessons_time_range";
const LESSON_CLASS_FOREIGN_KEY = "fk_lessons_class_id";
const LESSON_PLAN_FOREIGN_KEY = "fk_lessons_lesson_plan_id";

interface FieldChanges {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  fields: string[];
}

/** The schedule of a lesson: what a reschedule changes and what its event shows. */
interface LessonSchedule extends Record<string, unknown> {
  date: string;
  startTime: string;
  endTime: string;
  location: string | null;
  originalDate: string | null;
}

type CancelOutcome =
  | { changed: false; response: LessonResponseDto }
  | { changed: true; response: LessonResponseDto; lesson: Lesson; previousStatus: LessonStatus };

type RescheduleOutcome =
  | { changed: false; response: LessonResponseDto }
  | {
      changed: true;
      response: LessonResponseDto;
      lessonId: string;
      before: LessonSchedule;
      after: LessonSchedule;
    };

/** 409 CLASS_ARCHIVED when the class is archived: archived classes are read-only (RN-27). */
function assertClassWritable(schoolClass: ClassSummary): void {
  if (schoolClass.archivedAt != null) throw classArchived();
}

/** 400 when `date` falls outside the period of the class, ends included (RN-21). */
function assertWithinPeriod(date: string, schoolClass: ClassSummary): void {
  if (!isWithinClassPeriod(date, schoolClass)) throw lessonOutsideClassPeriod();
}

/**
 * Lessons (aulas) of the classes: create, read, edit, cancel and reschedule (F4.1, F4.3, F4.5).
 * Listing, the calendar and the series of lessons are other cards (GUS-153, GUS-154).
 *
 * A lesson is never deleted or archived: cancelling keeps the row, with the reason and who did it.
 * The title and the objective are copied from the lesson plan when the lesson is created from one,
 * and from then on they are the lesson's own (RN-18). Nothing here follows the plan after that.
 *
 * Every write runs in a transaction and the audit event goes out after the commit, only when
 * something changed. The class is read through `ClassesService` and the plan, the course and the
 * position in the sequence through the catalog: this module touches no table of another one.
 *
 * Locks, always in this order, so no two writes wait for each other in a circle:
 * - creating: the class FOR SHARE, then the lesson plan FOR SHARE, then the insert;
 * - the other writes: the lesson FOR UPDATE, then the class FOR SHARE.
 * The FOR SHARE on the class conflicts with the FOR UPDATE that `ClassesService.update` and
 * `archive` take, so a lesson is never written against a class that was archived or whose period
 * moved a moment before; shared locks do not conflict with each other, so lessons of the same class
 * do not wait for one another. The classes and the catalog never lock a lesson.
 */
@Injectable()
export class LessonsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly creation: LessonCreationService,
    private readonly classes: ClassesService,
    private readonly courses: CoursesService,
    private readonly lessonPlans: LessonPlansService,
    private readonly courseLessonPlans: CourseLessonPlansService,
  ) {}

  /**
   * Creates a lesson in a class, alone or from a lesson plan. It starts `planned`.
   *
   * With a `lessonPlanId` the title and the objective are copied from the plan when the body omits
   * them (RN-18): a title or an objective sent wins, and an objective sent as null leaves it empty.
   * Editing the plan afterwards does not change the lesson. With a `sequenceOrder` the plan must be
   * at exactly that position in the sequence of the course of the class (L2); without one, any
   * active plan is valid, which is an extra lesson.
   *
   * Errors, in the order they are answered: 400 VALIDATION_FAILED (the DTO), 400 INVALID_TIME_RANGE
   * (before the transaction opens), 400 CLASS_NOT_FOUND (the `classId` is in the body, so it is not
   * a 404), 409 CLASS_ARCHIVED (archived classes are read-only, RN-27), 400
   * LESSON_OUTSIDE_CLASS_PERIOD (RN-21), 400 LESSON_PLAN_NOT_FOUND, 400 LESSON_PLAN_ARCHIVED (an
   * archived plan does not originate a lesson) and 400 LESSON_PLAN_NOT_IN_COURSE_SEQUENCE.
   *
   * The class and the plan are locked FOR SHARE until the commit, so neither can be archived (or
   * edited, or the period of the class changed) between the checks and the insert.
   *
   * Emits LESSON_CREATED after the commit.
   */
  async create(dto: CreateLessonDto, actorId: string): Promise<LessonResponseDto> {
    if (!isValidTimeRange(dto.startTime, dto.endTime)) throw invalidTimeRange();

    const created = await this.runInTransaction(async (manager) => {
      const schoolClass = await this.classes.getClassSummary(dto.classId, manager, {
        forShare: true,
      });
      if (schoolClass === null) throw classNotFoundInBody();
      assertClassWritable(schoolClass);
      assertWithinPeriod(dto.date, schoolClass);

      const lessonPlan = await this.resolveLessonPlan(manager, dto, schoolClass);

      const [lesson] = await this.creation.createMany(
        manager,
        schoolClass,
        [this.toDraft(dto, lessonPlan)],
        actorId,
      );

      return {
        lesson,
        response: await this.buildResponse(manager, lesson, { schoolClass, lessonPlan }),
      };
    });

    const { lesson } = created;
    this.emit(AuditableAction.LESSON_CREATED, actorId, lesson.id, null, {
      classId: lesson.classId,
      lessonPlanId: lesson.lessonPlanId,
      sequenceOrder: lesson.sequenceOrder,
      title: lesson.title,
      objective: lesson.objective,
      date: lesson.date,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      location: lesson.location,
      expectedStudents: lesson.expectedStudents,
      expectedMonitors: lesson.expectedMonitors,
      subject: lesson.subject,
      status: lesson.status,
    });

    return created.response;
  }

  /**
   * One lesson, with its class, its course, its edition and the lesson plan it came from. A lesson
   * of an archived class is read the same way, and so is one whose plan was archived later: both
   * come with `archivedAt` set. 404 LESSON_NOT_FOUND for an id that is not a lesson.
   *
   * A plain read: no transaction, no lock and no event.
   */
  async findById(requestedId: string): Promise<LessonResponseDto> {
    const lesson = await this.dataSource
      .getRepository(Lesson)
      .findOne({ where: { id: requestedId } });
    if (lesson === null) throw lessonNotFound();

    return this.buildResponse(undefined, lesson);
  }

  /**
   * Edits a lesson. Every field is optional: omitted keeps, and the ones that take null clear.
   * `status` takes planned, confirmed or done, with no rule on the moves between them yet; the DTO
   * rejects cancelled, which has its own route. The class, the plan and the position in the
   * sequence never change (RN-20), and neither do the day and the time, which only change through
   * `reschedule`, so `originalDate` cannot be bypassed.
   *
   * Errors, in the order they are answered: 404 LESSON_NOT_FOUND, 409 LESSON_CANCELLED (a cancelled
   * lesson is final) and 409 CLASS_ARCHIVED (archived classes are read-only, RN-27, even for a body
   * that would change nothing).
   *
   * The lesson is locked FOR UPDATE until the commit, so two edits of it are serialized, and so is
   * an edit and a cancel; the class is locked FOR SHARE after it.
   *
   * Without a change (or with an empty body) nothing is written and no event is emitted. Emits
   * LESSON_UPDATED after the commit, with only the fields that changed. `postNotes` is named in
   * `changedFields` but its text is never in the event (RNF-13).
   *
   * `requestedId` is only the key of the lookup: the UUID pipe of the route accepts upper case and
   * Postgres finds the row all the same, but the ids of the database are lower case. So everything
   * after the lookup (the comparisons, the writes and the event) uses `lesson.id`.
   */
  async update(
    requestedId: string,
    dto: UpdateLessonDto,
    actorId: string,
  ): Promise<LessonResponseDto> {
    const changes: FieldChanges = { before: {}, after: {}, fields: [] };

    const updated = await this.runInTransaction(async (manager) => {
      const lesson = await this.loadLesson(manager, requestedId);
      if (lesson.status === LessonStatus.CANCELLED) throw lessonCancelled();
      const schoolClass = await this.loadWritableClass(manager, lesson.classId);

      if (this.applyChanges(lesson, dto as Record<string, unknown>, changes)) {
        lesson.updatedAt = this.clock.now();
        await manager.save(lesson);
      }

      return {
        lessonId: lesson.id,
        response: await this.buildResponse(manager, lesson, { schoolClass }),
      };
    });

    if (changes.fields.length > 0) {
      this.emit(AuditableAction.LESSON_UPDATED, actorId, updated.lessonId, changes.before, {
        ...changes.after,
        changedFields: changes.fields,
      });
    }

    return updated.response;
  }

  /**
   * Cancels a lesson: status `cancelled`, with the reason, the instant and who did it. The lesson
   * stays (nothing is deleted) and the response is the lesson as it is now. Cancelling it reverses
   * the hours already recorded for it (RN-07), and that is the `hours` module's work: this one only
   * announces it, with the `lesson.cancelled` event.
   *
   * Cancelling a lesson that is already cancelled is a no-op that answers 200 and keeps the first
   * reason: no write and no event, and not even the class is looked at. Otherwise, errors: 404
   * LESSON_NOT_FOUND and 409 CLASS_ARCHIVED (archived classes are read-only, RN-27).
   *
   * `cancelledAt` and `updatedAt` are the same instant, read once from the clock. After the commit,
   * and only when the lesson was cancelled now, it emits LESSON_CANCELLED on the audit channel
   * (without the reason: free text, RNF-13) and `lesson.cancelled`, the hook of the hours.
   */
  async cancel(
    requestedId: string,
    dto: CancelLessonDto,
    actorId: string,
  ): Promise<LessonResponseDto> {
    const now = this.clock.now();

    const outcome = await this.runInTransaction(async (manager): Promise<CancelOutcome> => {
      const lesson = await this.loadLesson(manager, requestedId);

      if (lesson.status === LessonStatus.CANCELLED) {
        return { changed: false, response: await this.buildResponse(manager, lesson) };
      }

      const schoolClass = await this.loadWritableClass(manager, lesson.classId);

      const previousStatus = lesson.status;
      lesson.status = LessonStatus.CANCELLED;
      lesson.cancelReason = dto.reason;
      lesson.cancelledAt = now;
      lesson.cancelledById = actorId;
      // The instant of the cancellation is the one of the update, as in the archive of a class. Left
      // alone, the table would fill updated_at with its own CURRENT_TIMESTAMP, from another clock.
      lesson.updatedAt = now;
      await manager.save(lesson);

      return {
        changed: true,
        lesson,
        previousStatus,
        response: await this.buildResponse(manager, lesson, { schoolClass }),
      };
    });

    if (outcome.changed) {
      const { lesson } = outcome;
      this.emit(
        AuditableAction.LESSON_CANCELLED,
        actorId,
        lesson.id,
        { status: outcome.previousStatus },
        { status: LessonStatus.CANCELLED, cancelledAt: now },
      );
      this.eventEmitter.emit(
        LESSON_CANCELLED_EVENT,
        new LessonCancelledEvent({
          lessonId: lesson.id,
          classId: lesson.classId,
          date: lesson.date,
          cancelledById: actorId,
          cancelledAt: now,
        }),
      );
    }

    return outcome.response;
  }

  /**
   * Moves a lesson to another day and time. It is the SAME lesson (same id, same plan, same
   * status): the day it had goes to `originalDate`, and only the first one is kept: rescheduling a
   * lesson a second time leaves the first `originalDate` as it was. A reschedule that moves only
   * the time also sets it, since `originalDate` is what says "this lesson was rescheduled".
   *
   * The body always states the whole new schedule (`date`, `startTime` and `endTime`). `location`
   * changes only when it is sent: omitted keeps the place, null clears it. `reason` and `note`
   * describe THIS reschedule, so omitted or null leave them empty even if the previous one had them.
   *
   * Errors, in the order they are answered: 400 VALIDATION_FAILED, 400 INVALID_TIME_RANGE (before the
   * transaction opens), 404 LESSON_NOT_FOUND, 409 LESSON_CANCELLED, 409 CLASS_ARCHIVED (RN-27) and
   * 400 LESSON_OUTSIDE_CLASS_PERIOD (the new day must fall inside the period of the class, RN-21).
   *
   * A schedule equal to the current one (the same day, times and place) is a no-op that answers 200:
   * no write and no event. Emits LESSON_RESCHEDULED after the commit, with the schedule before and
   * after. The reason and the note are free text and are not in the event (RNF-13).
   */
  async reschedule(
    requestedId: string,
    dto: RescheduleLessonDto,
    actorId: string,
  ): Promise<LessonResponseDto> {
    if (!isValidTimeRange(dto.startTime, dto.endTime)) throw invalidTimeRange();

    const outcome = await this.runInTransaction(async (manager): Promise<RescheduleOutcome> => {
      const lesson = await this.loadLesson(manager, requestedId);
      if (lesson.status === LessonStatus.CANCELLED) throw lessonCancelled();
      const schoolClass = await this.loadWritableClass(manager, lesson.classId);
      assertWithinPeriod(dto.date, schoolClass);

      const location = dto.location !== undefined ? dto.location : lesson.location;
      const unchanged =
        dto.date === lesson.date &&
        dto.startTime === lesson.startTime &&
        dto.endTime === lesson.endTime &&
        location === lesson.location;
      if (unchanged) {
        return {
          changed: false,
          response: await this.buildResponse(manager, lesson, { schoolClass }),
        };
      }

      const before = this.scheduleOf(lesson);

      lesson.originalDate = lesson.originalDate ?? lesson.date;
      lesson.date = dto.date;
      lesson.startTime = dto.startTime;
      lesson.endTime = dto.endTime;
      lesson.location = location;
      lesson.rescheduleReason = dto.reason ?? null;
      lesson.rescheduleNote = dto.note ?? null;
      lesson.updatedAt = this.clock.now();
      await manager.save(lesson);

      return {
        changed: true,
        lessonId: lesson.id,
        before,
        after: this.scheduleOf(lesson),
        response: await this.buildResponse(manager, lesson, { schoolClass }),
      };
    });

    if (outcome.changed) {
      this.emit(
        AuditableAction.LESSON_RESCHEDULED,
        actorId,
        outcome.lessonId,
        outcome.before,
        outcome.after,
      );
    }

    return outcome.response;
  }

  /**
   * Runs the work in a transaction and turns the constraint violations that mean a business error
   * into it: a lesson that ends before it starts (400, which the check before the write normally
   * answers first), and a class or a lesson plan that does not exist (400, which the lookups with a
   * lock normally answer first). They are the safety net, in case the rows move under the checks.
   */
  private async runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      throw this.mapConstraintError(error);
    }
  }

  /** The lesson, locked FOR UPDATE until the end of the transaction. */
  private async loadLesson(manager: EntityManager, id: string): Promise<Lesson> {
    const lesson = await manager.findOne(Lesson, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (lesson === null) throw lessonNotFound();

    return lesson;
  }

  /**
   * The class of a lesson that exists, locked FOR SHARE until the end of the transaction, and 409
   * CLASS_ARCHIVED when it is archived. The foreign key guarantees the class exists.
   */
  private async loadWritableClass(manager: EntityManager, classId: string): Promise<ClassSummary> {
    const schoolClass = await this.classes.getClassSummary(classId, manager, { forShare: true });
    if (schoolClass === null) {
      throw new Error(
        `Class ${classId} of a lesson was not found, but the foreign key requires it.`,
      );
    }
    assertClassWritable(schoolClass);

    return schoolClass;
  }

  /**
   * The lesson plan a new lesson comes from, locked FOR SHARE, or null when the body has none. 400
   * LESSON_PLAN_NOT_FOUND, 400 LESSON_PLAN_ARCHIVED and, when the body gives a `sequenceOrder`, 400
   * LESSON_PLAN_NOT_IN_COURSE_SEQUENCE unless the plan is at exactly that position in the sequence
   * of the course of the class.
   */
  private async resolveLessonPlan(
    manager: EntityManager,
    dto: CreateLessonDto,
    schoolClass: ClassSummary,
  ): Promise<LessonPlanSummary | null> {
    if (dto.lessonPlanId == null) return null;

    const lessonPlan = await this.lessonPlans.getLessonPlanSummary(dto.lessonPlanId, manager, {
      forShare: true,
    });
    if (lessonPlan === null) throw lessonPlanNotFoundInBody();
    if (lessonPlan.archivedAt != null) throw lessonPlanArchivedInBody();

    if (dto.sequenceOrder != null) {
      const position = await this.courseLessonPlans.findPosition(
        schoolClass.courseId,
        lessonPlan.id,
        manager,
      );
      if (position !== dto.sequenceOrder) throw lessonPlanNotInCourseSequence();
    }

    return lessonPlan;
  }

  /**
   * What the body says the lesson is, with the title and the objective resolved (RN-18). A title
   * sent wins over the one of the plan, and an objective sent (null included, which leaves it
   * empty) wins over the one of the plan. The ids are the ones of the database.
   */
  private toDraft(dto: CreateLessonDto, lessonPlan: LessonPlanSummary | null): LessonDraft {
    const title = dto.title ?? lessonPlan?.title;
    if (title === undefined) {
      throw new Error("A lesson without a lesson plan needs a title: the DTO should have said so.");
    }

    return {
      lessonPlanId: lessonPlan?.id ?? null,
      sequenceOrder: dto.sequenceOrder ?? null,
      title,
      objective: dto.objective !== undefined ? dto.objective : (lessonPlan?.objective ?? null),
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      location: dto.location ?? null,
      expectedStudents: dto.expectedStudents ?? null,
      expectedMonitors: dto.expectedMonitors ?? null,
      subject: dto.subject ?? null,
    };
  }

  /**
   * The answer of every route. `known` is what the caller already holds (it read the class under a
   * lock, the plan under a lock), so it is not read again. The course is always read here, and so
   * is whatever is missing. The foreign keys guarantee the class, the course and the plan of a
   * lesson exist, so a missing one is a broken database and an error, not a 404.
   */
  private async buildResponse(
    manager: EntityManager | undefined,
    lesson: Lesson,
    known: { schoolClass?: ClassSummary; lessonPlan?: LessonPlanSummary | null } = {},
  ): Promise<LessonResponseDto> {
    const schoolClass =
      known.schoolClass ?? (await this.classes.getClassSummary(lesson.classId, manager));
    if (schoolClass === null) {
      throw new Error(`Class ${lesson.classId} of lesson ${lesson.id} was not found.`);
    }

    const course = await this.courses.getCourseSummary(schoolClass.courseId, manager);
    if (course === null) {
      throw new Error(`Course ${schoolClass.courseId} of class ${schoolClass.id} was not found.`);
    }

    let lessonPlan: LessonPlanSummary | null;
    if (known.lessonPlan !== undefined) {
      lessonPlan = known.lessonPlan;
    } else if (lesson.lessonPlanId == null) {
      lessonPlan = null;
    } else {
      lessonPlan = await this.lessonPlans.getLessonPlanSummary(lesson.lessonPlanId, manager);
      if (lessonPlan === null) {
        throw new Error(`Lesson plan ${lesson.lessonPlanId} of lesson ${lesson.id} was not found.`);
      }
    }

    return toLessonResponse(lesson, { schoolClass, course, lessonPlan });
  }

  /** Copies the fields that were sent and differ into the lesson, and records before and after. */
  private applyChanges(
    lesson: Lesson,
    values: Readonly<Record<string, unknown>>,
    changes: FieldChanges,
  ): boolean {
    const target = lesson as unknown as Record<string, unknown>;
    let changed = false;

    for (const field of LESSON_FIELDS) {
      const next = values[field];
      if (next === undefined || next === target[field]) continue;

      if (!UNLOGGED_VALUE_FIELDS.has(field)) {
        changes.before[field] = target[field];
        changes.after[field] = next;
      }
      changes.fields.push(field);
      target[field] = next;
      changed = true;
    }

    return changed;
  }

  private scheduleOf(lesson: Lesson): LessonSchedule {
    return {
      date: lesson.date,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      location: lesson.location,
      originalDate: lesson.originalDate,
    };
  }

  /** Turns the violations of the constraints of `lessons` into their business error. */
  private mapConstraintError(error: unknown): unknown {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { code?: string; constraint?: string } | undefined;

      if (driverError?.code === "23514" && driverError.constraint === LESSON_TIME_RANGE_CHECK) {
        return invalidTimeRange();
      }
      if (driverError?.code === "23503" && driverError.constraint === LESSON_CLASS_FOREIGN_KEY) {
        return classNotFoundInBody();
      }
      if (driverError?.code === "23503" && driverError.constraint === LESSON_PLAN_FOREIGN_KEY) {
        return lessonPlanNotFoundInBody();
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
    event.targetType = LESSON_TARGET_TYPE;
    event.targetId = targetId;
    event.before = before;
    event.after = after;
    event.occurredAt = this.clock.now();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);
  }
}
