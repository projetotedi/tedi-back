import { Injectable, OnModuleInit } from "@nestjs/common";
import { isUUID } from "class-validator";
import { DataSource, EntityManager } from "typeorm";
import {
  ConfirmedStaff,
  ConfirmedStaffCount,
  LessonStaffCounter,
} from "@modules/lessons/services/lesson-coverage";
import { LessonCoverageRegistry } from "@modules/lessons/services/lesson-coverage.registry";
import { PeopleService } from "@modules/people/services/people.service";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";

interface StaffRow {
  lessonId: string;
  /** COUNT comes from Postgres as text (bigint). */
  teachers: string;
  monitors: string;
  /** The id of the confirmed teacher, or null: only `findConfirmedStaff` asks for it. */
  teacherId?: string | null;
}

/**
 * The counter of the confirmed staff of the lessons (F5.4): the implementation, in `assignments`, of
 * the port that `lessons` defines (`LessonStaffCounter`, docs/ARCHITECTURE.md section 15). It plugs
 * itself in the `LessonCoverageRegistry` when the module starts, and from then on every answer of
 * `lessons` counts through it: the detail and the writes of a lesson ask for the counts, and the
 * list and the calendar of the GUS-153 ask for the counts and the confirmed teacher.
 *
 * Only CONFIRMED assignments count: a pending one is not staff yet, and a cancelled or declined one
 * no longer is (or never was). The soft-deleted rows do not count either.
 */
@Injectable()
export class LessonStaffCounterService implements LessonStaffCounter, OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: LessonCoverageRegistry,
    private readonly people: PeopleService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * How many teachers and monitors are confirmed in each lesson, in ONE aggregated query however
   * many lessons are asked, so a page costs one count and not one per lesson. It reads no person:
   * it is what the detail of a lesson and the answers of its writes ask for, from inside the
   * transaction of the lesson, so it must not take a second connection.
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
    const ids = this.lessonIdsToAsk(lessonIds);
    if (ids.length === 0) return new Map();

    const rows = await this.aggregate(ids, manager ?? this.dataSource.manager, false);

    return new Map(
      rows.map((row) => [
        row.lessonId,
        { teachers: Number(row.teachers), monitors: Number(row.monitors) },
      ]),
    );
  }

  /**
   * The counts of `countConfirmedStaff` and, for each lesson, the confirmed teacher in person (her
   * id and her name): what a row of the list and of the calendar draws (F4.4). Two queries for the
   * whole page, however many lessons it has: the aggregated one over the assignments, which also
   * brings the id of the confirmed teacher of each lesson, and ONE `PeopleService.findRefsByIds` for
   * the names of the teachers of the page (a teacher who has several lessons in it is asked once).
   *
   * Same entries as `countConfirmedStaff`: one per lesson that has someone confirmed, none for a
   * lesson with nobody. `teacher` is null for a lesson with only monitors confirmed, and also when
   * the person of the teacher is gone (her name cannot be read): the counts stay as they are. A
   * pending teacher is not the teacher, so she never shows. These are plain reads with no
   * transaction, so there is no `manager`, and the names are read through the service of `people`,
   * which takes none. With nothing left to ask, it answers an empty map without touching the
   * database. It writes nothing and takes no lock.
   */
  async findConfirmedStaff(lessonIds: readonly string[]): Promise<Map<string, ConfirmedStaff>> {
    const ids = this.lessonIdsToAsk(lessonIds);
    if (ids.length === 0) return new Map();

    const rows = await this.aggregate(ids, this.dataSource.manager, true);

    const teacherIds = [...new Set(rows.flatMap((row) => (row.teacherId ? [row.teacherId] : [])))];
    const people = teacherIds.length === 0 ? [] : await this.people.findRefsByIds(teacherIds);
    const peopleById = new Map(people.map((person) => [person.id, person]));

    return new Map(
      rows.map((row) => {
        const person = row.teacherId ? peopleById.get(row.teacherId) : undefined;

        return [
          row.lessonId,
          {
            teachers: Number(row.teachers),
            monitors: Number(row.monitors),
            teacher: person === undefined ? null : { id: person.id, name: person.name },
          },
        ];
      }),
    );
  }

  /** The ids worth asking about: no repeats, and none that is not a UUID. */
  private lessonIdsToAsk(lessonIds: readonly string[]): string[] {
    return [...new Set(lessonIds)].filter((id) => isUUID(id));
  }

  /**
   * The one aggregated query behind both reads: the confirmed assignments of the lessons, grouped
   * by lesson, with the teachers and the monitors counted apart. With `withTeacher` it also brings
   * the id of the confirmed teacher of each lesson: a lesson has at most one (the partial unique
   * index of RN-02), so the smallest of the ids of her teachers is that one, or null when it has
   * none. The `deleted_at` filter of the entity is added by the query builder.
   */
  private aggregate(
    ids: string[],
    manager: EntityManager,
    withTeacher: boolean,
  ): Promise<StaffRow[]> {
    const builder = manager
      .getRepository(LessonAssignment)
      .createQueryBuilder("assignment")
      .select("assignment.lesson_id", "lessonId")
      .addSelect("COUNT(*) FILTER (WHERE assignment.role = :teacher)", "teachers")
      .addSelect("COUNT(*) FILTER (WHERE assignment.role = :monitor)", "monitors");

    if (withTeacher) {
      builder.addSelect(
        "MIN(assignment.person_id::text) FILTER (WHERE assignment.role = :teacher)",
        "teacherId",
      );
    }

    return builder
      .where("assignment.lesson_id IN (:...lessonIds)", { lessonIds: ids })
      .andWhere("assignment.status = :confirmed", { confirmed: AssignmentStatus.CONFIRMED })
      .setParameters({ teacher: AssignmentRole.TEACHER, monitor: AssignmentRole.MONITOR })
      .groupBy("assignment.lesson_id")
      .getRawMany<StaffRow>();
  }
}
