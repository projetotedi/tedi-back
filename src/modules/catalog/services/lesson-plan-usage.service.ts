import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { PeopleService } from "@modules/people/services/people.service";
import { LessonPlanDetailDto } from "../dto/lesson-plan-detail.response.dto";
import { LessonPlanUsageResponseDto } from "../dto/lesson-plan-usage.response.dto";
import { LessonPlan } from "../entities/lesson-plan.entity";
import {
  LessonPlanUsageRow,
  toLessonPlanDetail,
  toLessonPlanUsage,
} from "./lesson-plan-usage.mapper";
import { LessonPlansService, lessonPlanNotFound } from "./lesson-plans.service";

/**
 * Where a lesson plan is used (RF-017): the detail page of the plan and the simulation of a change
 * of its duration, which shows what each course's workload would be (RN-24: the workload is the
 * sum of the durations of the sequence, never stored). Read only: no transaction, no lock and no
 * audit event. Whoever saves the new duration is `PATCH /lesson-plans/:id`.
 *
 * `requestedId` in both methods is only the key of the lookup. The UUID pipe of the route accepts
 * upper case and Postgres finds the row all the same, but the answer carries the lower case id of
 * the database. So everything after the lookup (the usage query and the answer) uses `plan.id`.
 */
@Injectable()
export class LessonPlanUsageService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly lessonPlansService: LessonPlansService,
    private readonly peopleService: PeopleService,
  ) {}

  /**
   * The plan with its contents (the same lookup as `LessonPlansService.findById`, which answers the
   * 404 LESSON_PLAN_NOT_FOUND), who created it and the courses that use it. An archived plan can be
   * read: it comes with `archivedAt` set, and with the courses it stayed in. `createdBy` is null
   * when the creator was deleted.
   */
  async getDetail(requestedId: string): Promise<LessonPlanDetailDto> {
    const plan = await this.lessonPlansService.findById(requestedId);

    const rows = await this.readUsage(plan.id, null);
    const [createdBy = null] = await this.peopleService.findRefsByIds([plan.createdById]);

    return toLessonPlanDetail(plan, createdBy, rows);
  }

  /**
   * The workload of each course that uses the plan, today and with `expectedDurationMinutes` as the
   * duration of this plan. Without it, the new workload is the current one. Nothing is saved.
   * An archived plan can be simulated (it can be read), even though it can no longer be edited.
   * 404 LESSON_PLAN_NOT_FOUND for an id that is not a lesson plan.
   */
  async getUsage(
    requestedId: string,
    expectedDurationMinutes?: number,
  ): Promise<LessonPlanUsageResponseDto> {
    const plan = await this.dataSource.getRepository(LessonPlan).findOne({
      where: { id: requestedId },
      select: { id: true, expectedDurationMinutes: true },
    });
    if (plan === null) throw lessonPlanNotFound();

    const newDurationMinutes = expectedDurationMinutes ?? plan.expectedDurationMinutes;
    const rows = await this.readUsage(plan.id, expectedDurationMinutes ?? null);

    return toLessonPlanUsage(plan.id, plan.expectedDurationMinutes, newDurationMinutes, rows);
  }

  /**
   * One line per course that has the plan in its sequence: where the plan is, how many plans the
   * sequence has, and the workload of the course today and with `newDurationMinutes` in place of
   * the duration of this plan (null keeps it). Both routes read this, so they never disagree.
   *
   * `link` is the row of this plan in the course and `seq` walks the whole sequence of that same
   * course, so the SUM covers every plan of the course, this one included.
   *
   * The `deleted_at` filters are the ones of `CourseLessonPlansService.readSequence`, so the
   * workload is the `plannedWorkloadMinutes` of the sequence of the course and the number of
   * courses is its `courseCount`: archived courses and archived plans count, deleted ones do not
   * (D6 of GUS-98). The columns of `c` are not in the GROUP BY because they follow its primary key.
   *
   * SUM and COUNT are bigint, which the driver would hand over as a string: hence `::int`.
   */
  private readUsage(
    lessonPlanId: string,
    newDurationMinutes: number | null,
  ): Promise<LessonPlanUsageRow[]> {
    return this.dataSource.query(
      `SELECT c.id AS "courseId", c.name AS "courseName", c.category AS "category",
              c.archived_at AS "courseArchivedAt", link.position AS "position",
              COUNT(plan.id)::int AS "lessonPlanCount",
              SUM(plan.expected_duration_minutes)::int AS "currentWorkloadMinutes",
              SUM(CASE WHEN plan.id = link.lesson_plan_id
                       THEN COALESCE($2::int, plan.expected_duration_minutes)
                       ELSE plan.expected_duration_minutes END)::int AS "newWorkloadMinutes"
         FROM course_lesson_plans link
         JOIN courses c ON c.id = link.course_id AND c.deleted_at IS NULL
         JOIN course_lesson_plans seq ON seq.course_id = link.course_id AND seq.deleted_at IS NULL
         JOIN lesson_plans plan ON plan.id = seq.lesson_plan_id AND plan.deleted_at IS NULL
        WHERE link.lesson_plan_id = $1 AND link.deleted_at IS NULL
        GROUP BY c.id, link.position`,
      [lessonPlanId, newDurationMinutes],
    );
  }
}
