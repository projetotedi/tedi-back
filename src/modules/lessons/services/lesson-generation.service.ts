import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, IsNull, Not } from "typeorm";
import {
  CourseLessonPlansService,
  SequencedLessonPlanSummary,
} from "@modules/catalog/services/course-lesson-plans.service";
import { CoursesService, CourseSummary } from "@modules/catalog/services/courses.service";
import { ClassesService, ClassSummary } from "@modules/classes/services/classes.service";
import { Clock } from "@shared/dates/clock";
import { minutesBetween } from "@shared/dates/time-of-day";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { ClassLessonsPreviewResponseDto } from "../dto/class-lessons-preview.response.dto";
import { GenerateClassLessonsDto } from "../dto/generate-class-lessons.dto";
import { GeneratedClassLessonsResponseDto } from "../dto/generated-class-lessons.response.dto";
import { Lesson } from "../entities/lesson.entity";
import { lessonCreatedPayload } from "./lesson-audit";
import { NO_CONFIRMED_STAFF } from "./lesson-coverage";
import { LessonCreationService, LessonDraft } from "./lesson-creation.service";
import {
  classArchived,
  classNotFoundInPath,
  courseWithoutSequence,
  lessonsAlreadyGenerated,
  lessonsOutsideClassPeriod,
} from "./lesson-errors";
import { toLessonResponse } from "./lesson-response.mapper";
import { invalidTimeRange, isValidTimeRange } from "./lesson-schedule";
import { buildSeries, SeriesItem } from "./lesson-series";

const LESSON_TARGET_TYPE = "lesson";

/** The advisory lock of the generation of the lessons of one class: the key is per class. */
function generationLockKey(classId: string): string {
  return `lessons.generate:${classId}`;
}

/** A plan of the sequence that is archived: it originates no lesson (RN-27). */
type ArchivedSequencedPlan = SequencedLessonPlanSummary & { archivedAt: Date };

function isArchivedPlan(plan: SequencedLessonPlanSummary): plan is ArchivedSequencedPlan {
  return plan.archivedAt != null;
}

/** Everything the preview and the generation need, read once and in the same order by both. */
interface ResolvedSeries {
  schoolClass: ClassSummary;
  course: CourseSummary;
  /** The active plans of the sequence by id: the ones the lessons come from. */
  plansById: Map<string, SequencedLessonPlanSummary>;
  /** One per active plan, in the order of the sequence, with its day. */
  items: SeriesItem[];
  /** The archived plans of the sequence, left out of the series. */
  skipped: ArchivedSequencedPlan[];
}

/**
 * The generation of the lessons of a class from the sequence of lesson plans of its course (F4.2):
 * the coordination says on which day of the week, at what time and from which date the class
 * meets, and gets one lesson per plan, in the order of the sequence (RN-17), one week after the
 * other, copying the title and the objective of the plan (RN-18). The preview shows it and writes
 * nothing; the generation writes it all or nothing.
 *
 * `preview` and `generate` answer for the same errors, in the same order, because the preview is
 * "what the generation would do": the class does not exist (404 CLASS_NOT_FOUND), is archived (409
 * CLASS_ARCHIVED, RN-27), already has the lessons of the sequence (409 LESSONS_ALREADY_GENERATED)
 * or its course has no active plan (409 COURSE_WITHOUT_SEQUENCE). Only the lessons outside the
 * period of the class differ: the preview marks them (`outsideClassPeriod`), the generation refuses
 * them (409 LESSONS_OUTSIDE_CLASS_PERIOD, RN-21) before writing anything.
 *
 * "Already generated" is a lesson of the class with a `sequenceOrder`, cancelled ones included: the
 * position is what marks "came from the sequence", and a cancelled lesson is still there (F4.5).
 * An extra lesson, without it, does not count. Two generations of the same class at the same time
 * are serialized by an advisory lock on the class, and the check is made again under it, so one
 * answers 201 and the other 409, never 4 lessons twice.
 *
 * A plan archived after it entered the sequence originates no lesson (RN-27, L1): it is left out,
 * listed in `skippedLessonPlans`, and does not leave a gap in the days. The `sequenceOrder` of the
 * other lessons keeps their real position in the sequence, so a number can be missing. An archived
 * course or a class that is `completed` or `cancelled` do not block: only an archived class does.
 *
 * Locks of `generate`, always in this order so no two writes wait for each other in a circle: the
 * class FOR SHARE, then the advisory lock of the class, then the course FOR SHARE, then the plans
 * FOR SHARE, then the insert. It is the order of `POST /lessons` (the class, then the plan) and of
 * `PUT /courses/:id/lesson-plans` (the course FOR UPDATE, then the plans FOR SHARE), and nobody takes
 * them the other way around. The FOR SHARE of the course is what keeps the sequence from being
 * replaced between the read and the insert; the FOR SHARE of the class and of the plans, what
 * `POST /lessons` already does. The preview takes no transaction and no lock.
 *
 * The lessons are created by `LessonCreationService.createMany` inside the transaction, which also
 * checks the whole batch before writing. The audit events (one LESSON_CREATED per lesson, in the
 * order of the sequence) go out after the commit, so a rollback emits none. The answer is built
 * from what was already read, without another query.
 */
@Injectable()
export class LessonGenerationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly creation: LessonCreationService,
    private readonly classes: ClassesService,
    private readonly courses: CoursesService,
    private readonly courseLessonPlans: CourseLessonPlansService,
  ) {}

  /**
   * The lessons `generate` would create with this body, without creating them: one per active plan
   * of the sequence of the course of the class, with the day, the title, the duration of the plan
   * and whether the day falls outside the period of the class. A plain read: no transaction, no
   * lock, no write and no event.
   *
   * Errors, in the order they are answered: 400 VALIDATION_FAILED (the DTO), 400 INVALID_TIME_RANGE
   * (before anything is read), 404 CLASS_NOT_FOUND, 409 CLASS_ARCHIVED, 409
   * LESSONS_ALREADY_GENERATED, 409 COURSE_WITHOUT_SEQUENCE. A lesson outside the period of the
   * class is not an error here.
   */
  async preview(
    requestedClassId: string,
    dto: GenerateClassLessonsDto,
  ): Promise<ClassLessonsPreviewResponseDto> {
    if (!isValidTimeRange(dto.startTime, dto.endTime)) throw invalidTimeRange();

    const { schoolClass, items, skipped } = await this.resolveSeries(
      undefined,
      requestedClassId,
      dto,
      false,
    );

    return {
      classId: schoolClass.id,
      classStartDate: schoolClass.startDate,
      classEndDate: schoolClass.endDate,
      weekday: dto.weekday,
      startTime: dto.startTime,
      endTime: dto.endTime,
      durationMinutes: minutesBetween(dto.startTime, dto.endTime),
      location: dto.location ?? null,
      lessonCount: items.length,
      outsideClassPeriodCount: items.filter((item) => item.outsideClassPeriod).length,
      items: items.map((item) => ({
        sequenceOrder: item.position,
        lessonPlanId: item.lessonPlanId,
        title: item.title,
        date: item.date,
        expectedDurationMinutes: item.expectedDurationMinutes,
        outsideClassPeriod: item.outsideClassPeriod,
      })),
      skippedLessonPlans: skipped.map((plan) => ({
        sequenceOrder: plan.position,
        lessonPlanId: plan.id,
        title: plan.title,
        archivedAt: plan.archivedAt,
      })),
    };
  }

  /**
   * Creates the lessons of the series in one transaction: all of them or none. Each one is
   * `planned`, made by the actor, copies the title and the objective of its plan (RN-18) and keeps
   * `lessonPlanId` and `sequenceOrder` (RN-20), with the day of the series and the time and the
   * place of the body. They answer in the order of the sequence.
   *
   * Errors, in the order they are answered: 400 VALIDATION_FAILED (the DTO), 400 INVALID_TIME_RANGE
   * (before the transaction opens), 404 CLASS_NOT_FOUND, 409 CLASS_ARCHIVED, 409
   * LESSONS_ALREADY_GENERATED, 409 COURSE_WITHOUT_SEQUENCE and 409 LESSONS_OUTSIDE_CLASS_PERIOD
   * (any lesson of the series outside the period of the class: nothing is written, RN-21). Whatever
   * fails in the middle rolls the whole batch back.
   *
   * Emits LESSON_CREATED for each lesson, after the commit.
   */
  async generate(
    requestedClassId: string,
    dto: GenerateClassLessonsDto,
    actorId: string,
  ): Promise<GeneratedClassLessonsResponseDto> {
    if (!isValidTimeRange(dto.startTime, dto.endTime)) throw invalidTimeRange();

    const created = await this.dataSource.transaction(async (manager) => {
      const { schoolClass, course, plansById, items } = await this.resolveSeries(
        manager,
        requestedClassId,
        dto,
        true,
      );

      const outside = items.filter((item) => item.outsideClassPeriod);
      if (outside.length > 0) {
        throw lessonsOutsideClassPeriod(
          outside.map((item) => ({ sequenceOrder: item.position, date: item.date })),
        );
      }

      const lessons = await this.creation.createMany(
        manager,
        schoolClass,
        items.map((item) => this.toDraft(item, dto)),
        actorId,
      );

      return {
        lessons,
        response: {
          classId: schoolClass.id,
          lessons: lessons.map((lesson) =>
            toLessonResponse(lesson, {
              schoolClass,
              course,
              lessonPlan: this.planOf(lesson, plansById),
              // A lesson that was just generated has nobody allocated yet, so the coverage is zero
              // without asking the counter (A2, the same as POST /lessons).
              staff: NO_CONFIRMED_STAFF,
            }),
          ),
        },
      };
    });

    for (const lesson of created.lessons) this.emitCreated(actorId, lesson);

    return created.response;
  }

  /**
   * Reads what the series is made of, in the order that is the same for the preview and the
   * generation. With `lock` (the generation, which passes the `manager` of its transaction) it
   * also locks what the writes depend on, in the order of the class JSDoc; without it every read
   * is a plain one.
   *
   * 1. The class: 404 if it does not exist, 409 if it is archived. From here on only the id of the
   *    database, `schoolClass.id`, is used: the UUID pipe of the route accepts upper case and
   *    Postgres finds the row all the same, but the ids of the database are lower case.
   * 2. With `lock`, the advisory lock of the class: whoever generates the same class waits here.
   * 3. Whether the class already has the lessons of the sequence (409), read AFTER the lock, so
   *    the one that waited sees what the other committed.
   * 4. The course (it exists: the foreign key requires it). An archived course does not block (it
   *    is only read-only, and its classes keep being edited, docs/ARCHITECTURE.md section 13).
   * 5. The sequence of the course, split into the active plans and the archived ones. No active
   *    plan: 409.
   * 6. The days of the series, from the first weekday on or after `firstDate`.
   */
  private async resolveSeries(
    manager: EntityManager | undefined,
    requestedClassId: string,
    dto: GenerateClassLessonsDto,
    lock: boolean,
  ): Promise<ResolvedSeries> {
    const schoolClass = await this.classes.getClassSummary(requestedClassId, manager, {
      forShare: lock,
    });
    if (schoolClass === null) throw classNotFoundInPath();
    if (schoolClass.archivedAt != null) throw classArchived();

    if (lock) {
      if (manager === undefined) {
        throw new Error("Locking the generation of a class needs the manager of a transaction.");
      }
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        generationLockKey(schoolClass.id),
      ]);
    }

    const alreadyGenerated = await (manager ?? this.dataSource.manager).exists(Lesson, {
      where: { classId: schoolClass.id, sequenceOrder: Not(IsNull()) },
    });
    if (alreadyGenerated) throw lessonsAlreadyGenerated();

    const course = await this.courses.getCourseSummary(schoolClass.courseId, manager, {
      forShare: lock,
    });
    if (course === null) {
      throw new Error(`Course ${schoolClass.courseId} of class ${schoolClass.id} was not found.`);
    }

    const sequence = await this.courseLessonPlans.getSequenceSummaries(course.id, manager, {
      forShare: lock,
    });
    const skipped = sequence.filter(isArchivedPlan);
    const active = sequence.filter((plan) => !isArchivedPlan(plan));
    if (active.length === 0) throw courseWithoutSequence();

    const items = buildSeries(
      active.map((plan) => ({
        position: plan.position,
        lessonPlanId: plan.id,
        title: plan.title,
        objective: plan.objective,
        expectedDurationMinutes: plan.expectedDurationMinutes,
      })),
      dto.firstDate,
      dto.weekday,
      schoolClass,
    );

    return {
      schoolClass,
      course,
      plansById: new Map(active.map((plan) => [plan.id, plan])),
      items,
      skipped,
    };
  }

  /**
   * What the lesson is: the plan it comes from and its position, with the title and the objective
   * of the plan already copied (RN-18), the day of the series and the time and the place of the
   * body. The head counts and the subject are not part of the generation: they are filled in on
   * each lesson afterwards.
   */
  private toDraft(item: SeriesItem, dto: GenerateClassLessonsDto): LessonDraft {
    return {
      lessonPlanId: item.lessonPlanId,
      sequenceOrder: item.position,
      title: item.title,
      objective: item.objective,
      date: item.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      location: dto.location ?? null,
      expectedStudents: null,
      expectedMonitors: null,
      subject: null,
    };
  }

  /** The plan a lesson of the series was created from, read with the series: it is always there. */
  private planOf(
    lesson: Lesson,
    plansById: ReadonlyMap<string, SequencedLessonPlanSummary>,
  ): SequencedLessonPlanSummary {
    const plan = lesson.lessonPlanId === null ? undefined : plansById.get(lesson.lessonPlanId);
    if (plan === undefined) {
      throw new Error(`Lesson ${lesson.id} of the series has no lesson plan that it came from.`);
    }

    return plan;
  }

  private emitCreated(actorId: string, lesson: Lesson): void {
    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = AuditableAction.LESSON_CREATED;
    event.targetType = LESSON_TARGET_TYPE;
    event.targetId = lesson.id;
    event.before = null;
    event.after = lessonCreatedPayload(lesson);
    event.occurredAt = this.clock.now();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);
  }
}
