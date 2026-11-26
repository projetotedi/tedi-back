import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { ClassSummary } from "@modules/classes/services/classes.service";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";
import { classArchived } from "./lesson-errors";
import {
  invalidTimeRange,
  isValidTimeRange,
  isWithinClassPeriod,
  lessonOutsideClassPeriod,
} from "./lesson-schedule";

/**
 * Everything a new lesson carries that is not about who made it or the class it goes to: what the
 * lesson IS, already resolved. The title and the objective are the final text, never "copy from the
 * plan" (the caller reads the plan and copies, RN-18), so this service does not touch the catalog.
 */
export interface LessonDraft {
  lessonPlanId: string | null;
  sequenceOrder: number | null;
  title: string;
  objective: string | null;
  /** "YYYY-MM-DD", inside the period of the class. */
  date: string;
  /** "HH:mm". */
  startTime: string;
  /** "HH:mm", after `startTime`. */
  endTime: string;
  location: string | null;
  expectedStudents: number | null;
  expectedMonitors: number | null;
  subject: string | null;
}

/**
 * The one place that turns drafts into lessons, with the rules a lesson has at birth. Internal to
 * the module on purpose (it is not exported by LessonsModule) and written to be reused: the card
 * that generates the lessons of a class from the sequence of its course (GUS-154) builds one draft
 * per plan and calls `createMany`, and so gets the same rules as `POST /lessons`.
 *
 * It does not open a transaction, it does not lock and it emits no event. The caller owns all of
 * that: it passes the `manager` of its transaction, reads the class there with `FOR SHARE`
 * (`ClassesService.getClassSummary`, so the class cannot be archived or move its period before the
 * commit), and emits what it needs AFTER the commit.
 */
@Injectable()
export class LessonCreationService {
  /**
   * Creates one `planned` lesson per draft, in the order of the list, all of the class
   * `schoolClass`, with `createdById` = `actorId`. Returns them in the same order.
   *
   * The whole list is checked before anything is written: the class must not be archived (409
   * CLASS_ARCHIVED, RN-27) and every draft must end after it starts (400 INVALID_TIME_RANGE) and
   * fall inside the period of the class (400 LESSON_OUTSIDE_CLASS_PERIOD, RN-21). One bad draft
   * rejects the batch: no lesson of it is written. An empty list writes nothing.
   *
   * The caller answers first for the errors it can say better (the class that does not exist, the
   * plan that is archived); these checks repeat the ones about the lesson itself, so a caller that
   * forgot one still cannot write a lesson that breaks a rule.
   */
  async createMany(
    manager: EntityManager,
    schoolClass: ClassSummary,
    drafts: readonly LessonDraft[],
    actorId: string,
  ): Promise<Lesson[]> {
    if (schoolClass.archivedAt != null) throw classArchived();

    for (const draft of drafts) {
      if (!isValidTimeRange(draft.startTime, draft.endTime)) throw invalidTimeRange();
      if (!isWithinClassPeriod(draft.date, schoolClass)) throw lessonOutsideClassPeriod();
    }
    if (drafts.length === 0) return [];

    return manager.save(
      drafts.map((draft) =>
        manager.create(Lesson, {
          ...draft,
          classId: schoolClass.id,
          status: LessonStatus.PLANNED,
          createdById: actorId,
        }),
      ),
    );
  }
}
