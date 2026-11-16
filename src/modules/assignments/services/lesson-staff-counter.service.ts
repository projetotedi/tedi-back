import { Injectable, OnModuleInit } from "@nestjs/common";
import { isUUID } from "class-validator";
import { DataSource, EntityManager } from "typeorm";
import { ConfirmedStaffCount, LessonStaffCounter } from "@modules/lessons/services/lesson-coverage";
import { LessonCoverageRegistry } from "@modules/lessons/services/lesson-coverage.registry";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";

interface StaffCountRow {
  lessonId: string;
  /** COUNT comes from Postgres as text (bigint). */
  teachers: string;
  monitors: string;
}

/**
 * The counter of the confirmed staff of the lessons (F5.4): the implementation, in `assignments`, of
 * the port that `lessons` defines (`LessonStaffCounter`, docs/ARCHITECTURE.md section 15). It plugs
 * itself in the `LessonCoverageRegistry` when the module starts, and from then on every answer of
 * `lessons` (and the listing and the calendar of the GUS-153) counts through it.
 *
 * Only CONFIRMED assignments count: a pending one is not staff yet, and a cancelled or declined one
 * no longer is (or never was). The soft-deleted rows do not count either.
 */
@Injectable()
export class LessonStaffCounterService implements LessonStaffCounter, OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: LessonCoverageRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * How many teachers and monitors are confirmed in each lesson, in ONE aggregated query however
   * many lessons are asked, so a page of the listing costs one count and not one per lesson.
   *
   * There is one entry per lesson that has someone confirmed: a lesson with nobody is left out of
   * the map (the caller reads it as `NO_CONFIRMED_STAFF`). A repeated id counts once, and an id that
   * is not a UUID is skipped (it cannot be a lesson, and Postgres would answer 22P02). With nothing
   * left to ask, it answers an empty map without touching the database. Pass the `manager` of a
   * transaction to count inside it. It writes nothing and takes no lock.
   */
  async countConfirmedStaff(
    lessonIds: readonly string[],
    manager?: EntityManager,
  ): Promise<Map<string, ConfirmedStaffCount>> {
    const ids = [...new Set(lessonIds)].filter((id) => isUUID(id));
    if (ids.length === 0) return new Map();

    const source = manager ?? this.dataSource.manager;
    const rows = await source
      .getRepository(LessonAssignment)
      .createQueryBuilder("assignment")
      .select("assignment.lesson_id", "lessonId")
      .addSelect("COUNT(*) FILTER (WHERE assignment.role = :teacher)", "teachers")
      .addSelect("COUNT(*) FILTER (WHERE assignment.role = :monitor)", "monitors")
      .where("assignment.lesson_id IN (:...lessonIds)", { lessonIds: ids })
      .andWhere("assignment.status = :confirmed", { confirmed: AssignmentStatus.CONFIRMED })
      .setParameters({ teacher: AssignmentRole.TEACHER, monitor: AssignmentRole.MONITOR })
      .groupBy("assignment.lesson_id")
      .getRawMany<StaffCountRow>();

    return new Map(
      rows.map((row) => [
        row.lessonId,
        { teachers: Number(row.teachers), monitors: Number(row.monitors) },
      ]),
    );
  }
}
