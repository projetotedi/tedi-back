import { HttpException, Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, In } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { isArchived } from "@shared/entities/archivable.columns";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { CourseLessonPlansResponseDto } from "../dto/course-lesson-plans.response.dto";
import { ReplaceCourseLessonPlansDto } from "../dto/replace-course-lesson-plans.dto";
import { CourseLessonPlan } from "../entities/course-lesson-plan.entity";
import { Course } from "../entities/course.entity";
import { LessonPlanContent } from "../entities/lesson-plan-content.entity";
import { LessonPlan } from "../entities/lesson-plan.entity";
import {
  CourseLessonPlanRow,
  toCourseLessonPlansResponse,
} from "./course-lesson-plans-response.mapper";
import { courseArchived, courseNotFound } from "./courses.service";

const COURSE_TARGET_TYPE = "course";

/**
 * 400 here, 404 in the routes of the lesson plans: the id of a lesson plan is in the body of the
 * sequence, not in the URL, and the URL is a course (the same rule as PREREQUISITE_NOT_FOUND).
 */
function sequenceLessonPlanNotFound(): HttpException {
  return new HttpException(
    { error: "LESSON_PLAN_NOT_FOUND", message: "One or more lesson plans do not exist." },
    400,
  );
}

/** 400 here, 409 when a lesson plan itself is edited: adding it to a course is a bad request. */
function sequenceLessonPlanArchived(): HttpException {
  return new HttpException(
    {
      error: "LESSON_PLAN_ARCHIVED",
      message: "An archived lesson plan cannot be added to a course.",
    },
    400,
  );
}

function duplicateLessonPlan(): HttpException {
  return new HttpException(
    {
      error: "DUPLICATE_LESSON_PLAN",
      message: "The same lesson plan appears more than once in the sequence.",
    },
    400,
  );
}

/** The first id that shows up a second time, or null when every id is different. */
export function findDuplicateId(ids: readonly string[]): string | null {
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }

  return null;
}

/** True when both lists hold the same ids in the same order: here the order is the data. */
function isSameSequence(current: readonly string[], next: readonly string[]): boolean {
  return current.length === next.length && current.every((id, index) => id === next[index]);
}

type ReplaceOutcome =
  | { changed: false; response: CourseLessonPlansResponseDto }
  | {
      changed: true;
      courseId: string;
      before: string[];
      response: CourseLessonPlansResponseDto;
    };

/**
 * The sequence of lesson plans of a course (RF-014, RF-016) and the workload it adds up to
 * (RF-018, RN-24). Reading is open to whoever can see the catalog; replacing is for courses.manage
 * (the permission is checked in the controller).
 *
 * The order lives on the link, so the same plan is in many courses with its own position (RN-17).
 * The workload is never stored: it is the sum of the durations read together with the sequence,
 * so changing the duration of a plan changes the workload of every course that uses it (RN-24).
 */
@Injectable()
export class CourseLessonPlansService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
  ) {}

  /**
   * The sequence of a course in order, with the workload. An archived course can be read (it is
   * only read-only, RN-27), and so can an archived plan that stayed in the sequence: it comes with
   * `archivedAt` set. 404 COURSE_NOT_FOUND for an id that is not a course.
   *
   * `requestedCourseId` is only the key of the lookup; the sequence is read with `course.id`, the
   * id of the database (see `replace`).
   */
  async list(requestedCourseId: string): Promise<CourseLessonPlansResponseDto> {
    const course = await this.dataSource
      .getRepository(Course)
      .findOne({ where: { id: requestedCourseId } });
    if (course === null) throw courseNotFound();

    return this.readSequence(this.dataSource.manager, course.id);
  }

  /**
   * Replaces the whole sequence of a course in one transaction: adding, removing and reordering in
   * one call. `lessonPlanIds` is the new sequence in order (position 1, 2, 3...) and `[]` clears
   * it. Answers the sequence that was stored, with the workload recalculated.
   *
   * Errors, in the order they are answered: 404 for a malformed id (the pipe of the route), 400
   * VALIDATION_FAILED (the DTO), 400 DUPLICATE_LESSON_PLAN (the same plan twice, before anything is
   * read), 404 COURSE_NOT_FOUND, 409 COURSE_ARCHIVED (archived courses are read-only, RN-27, even
   * when the list would change nothing), then, only when the list does change something, 400
   * LESSON_PLAN_NOT_FOUND and 400 LESSON_PLAN_ARCHIVED (only for a plan being added now: one that
   * is already in the sequence stays even if it was archived later).
   *
   * The same list in the same order is a no-op: 200 with the current sequence, no write, no event.
   * The same ids in another order is a change, since here the order is the data.
   *
   * Two replacements of the same course are serialized by the row lock of the course (FOR UPDATE):
   * the second one waits, then deletes what the first one stored. Without it the delete and insert
   * of both would meet at the unique index of the position and one would answer 500.
   *
   * The plans of the list are locked FOR SHARE, which conflicts with the FOR UPDATE that
   * `PATCH /lesson-plans/:id` and its `/archive` take. So a plan being archived at the same time is
   * not missed: if the archiving comes first, this call waits for it and reads the plan archived
   * (400); if this call comes first, the archiving waits for the commit. The same lock keeps the
   * duration of a plan from changing in the middle of the answer. Locks are always taken in the
   * order course, then plans, and shared locks do not conflict with each other, so there is no
   * deadlock.
   *
   * `requestedCourseId` is only the key of the lookup. The UUID pipe of the route accepts upper
   * case and Postgres finds the row all the same, but the links of the database and the ids of the
   * body are the lower case ones. So everything after the lookup (the reads, the delete, the
   * inserts, the answer and the event) uses `course.id`, the id of the database.
   *
   * Emits COURSE_LESSON_PLANS_REPLACED after the commit, with the ids before and after in order.
   */
  async replace(
    requestedCourseId: string,
    dto: ReplaceCourseLessonPlansDto,
    actorId: string,
  ): Promise<CourseLessonPlansResponseDto> {
    if (findDuplicateId(dto.lessonPlanIds) !== null) throw duplicateLessonPlan();

    const outcome = await this.dataSource.transaction(async (manager): Promise<ReplaceOutcome> => {
      const course = await this.loadCourseForUpdate(manager, requestedCourseId);
      if (isArchived(course.archive)) throw courseArchived();

      const currentIds = await this.loadCurrentLessonPlanIds(manager, course.id);
      if (isSameSequence(currentIds, dto.lessonPlanIds)) {
        return { changed: false, response: await this.readSequence(manager, course.id) };
      }

      await this.lockLessonPlans(manager, dto.lessonPlanIds, currentIds);

      await manager.delete(CourseLessonPlan, { courseId: course.id });
      await this.insertLinks(manager, course.id, dto.lessonPlanIds);

      course.updatedAt = this.clock.now();
      await manager.save(course);

      return {
        changed: true,
        courseId: course.id,
        before: currentIds,
        response: await this.readSequence(manager, course.id),
      };
    });

    if (outcome.changed) {
      this.emit(
        AuditableAction.COURSE_LESSON_PLANS_REPLACED,
        actorId,
        outcome.courseId,
        { lessonPlanIds: outcome.before },
        { lessonPlanIds: [...dto.lessonPlanIds] },
      );
    }

    return outcome.response;
  }

  /** The course, locked FOR UPDATE until the end of the transaction. */
  private async loadCourseForUpdate(manager: EntityManager, id: string): Promise<Course> {
    const course = await manager.findOne(Course, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (course === null) throw courseNotFound();

    return course;
  }

  /** The ids of the lesson plans that `courseId` has today, in order. */
  private async loadCurrentLessonPlanIds(
    manager: EntityManager,
    courseId: string,
  ): Promise<string[]> {
    const links = await manager.find(CourseLessonPlan, {
      where: { courseId },
      order: { position: "ASC" },
    });

    return links.map((link) => link.lessonPlanId);
  }

  /**
   * Locks the plans of the list FOR SHARE until the end of the transaction (see `replace`) and
   * checks them. 400 LESSON_PLAN_NOT_FOUND when any id is not a lesson plan. 400
   * LESSON_PLAN_ARCHIVED when an archived one is being added now (RN-27); the ids in `currentIds`
   * are links that already exist, so they stay valid even if archived later. Nothing to lock for
   * an empty list.
   */
  private async lockLessonPlans(
    manager: EntityManager,
    ids: readonly string[],
    currentIds: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return;

    const plans = await manager.find(LessonPlan, {
      where: { id: In(ids) },
      lock: { mode: "pessimistic_read" },
    });
    if (plans.length < ids.length) throw sequenceLessonPlanNotFound();

    const addedArchived = plans.some(
      (plan) => !currentIds.includes(plan.id) && isArchived(plan.archive),
    );
    if (addedArchived) throw sequenceLessonPlanArchived();
  }

  /** One row per plan, position 1..n in the order of the list. Nothing to insert for []. */
  private async insertLinks(
    manager: EntityManager,
    courseId: string,
    lessonPlanIds: readonly string[],
  ): Promise<void> {
    if (lessonPlanIds.length === 0) return;

    await manager.save(
      lessonPlanIds.map((lessonPlanId, index) =>
        manager.create(CourseLessonPlan, { courseId, lessonPlanId, position: index + 1 }),
      ),
    );
  }

  /**
   * The sequence of `courseId` in order of position, with the workload. The count of courses is
   * `::int` because COUNT is a bigint, which the driver would hand over as a string. It counts the
   * courses that use the plan, this one and archived ones included: a change of duration reaches
   * them all (RN-24).
   */
  private async readSequence(
    manager: EntityManager,
    courseId: string,
  ): Promise<CourseLessonPlansResponseDto> {
    const rows: CourseLessonPlanRow[] = await manager.query(
      `SELECT link.position AS "position", plan.id AS "lessonPlanId", plan.title AS "title",
              plan.expected_duration_minutes AS "expectedDurationMinutes",
              plan.material_url AS "materialUrl", plan.archived_at AS "archivedAt",
              (SELECT COUNT(*)::int FROM course_lesson_plans usage
                 JOIN courses c ON c.id = usage.course_id AND c.deleted_at IS NULL
                WHERE usage.lesson_plan_id = plan.id AND usage.deleted_at IS NULL) AS "courseCount"
         FROM course_lesson_plans link
         JOIN lesson_plans plan ON plan.id = link.lesson_plan_id AND plan.deleted_at IS NULL
        WHERE link.course_id = $1 AND link.deleted_at IS NULL
        ORDER BY link.position`,
      [courseId],
    );

    const contents =
      rows.length === 0
        ? []
        : await manager.find(LessonPlanContent, {
            where: { lessonPlanId: In(rows.map((row) => row.lessonPlanId)) },
            order: { position: "ASC" },
          });

    return toCourseLessonPlansResponse(courseId, rows, contents);
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
