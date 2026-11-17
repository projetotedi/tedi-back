import { Injectable, OnModuleInit } from "@nestjs/common";
import { isUUID } from "class-validator";
import { DataSource, EntityManager } from "typeorm";
import { EnrollmentRosterService } from "@modules/classes/services/enrollment-roster.service";
import {
  LessonRollCallCounter,
  RollCallLesson,
  StudentRollCallCount,
} from "@modules/lessons/services/lesson-roll-call";
import { LessonRollCallRegistry } from "@modules/lessons/services/lesson-roll-call.registry";
import { rollCallCountsOf, SignedRollCall } from "./student-attendance-stats";

/**
 * The counter of the roll call of the students of the lessons (GUS-166): the implementation, in
 * `attendance`, of the port that `lessons` defines (`LessonRollCallCounter`, docs/ARCHITECTURE.md
 * section 18.1). It plugs itself in the `LessonRollCallRegistry` when the module starts, and from
 * then on every answer of `lessons` counts through it: `attendance` of the detail and of the writes,
 * and `attendancePending` of the list and of the calendar.
 */
@Injectable()
export class StudentRollCallCounterService implements LessonRollCallCounter, OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: LessonRollCallRegistry,
    private readonly roster: EnrollmentRosterService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * The numbers of the roll call of each lesson in TWO queries however many lessons are asked: the
   * enrollments each class expects on each day (`EnrollmentRosterService.findRosterIds`, once per
   * pair) and the signatures of the lessons; folded by `rollCallCountsOf`. A lesson whose id is not a
   * UUID is skipped (Postgres would answer 22P02), and with nothing left it answers an empty map
   * without touching the database. Pass the `manager` of a transaction to count inside it; it takes
   * no lock and writes nothing.
   */
  async countStudentRollCalls(
    lessons: readonly RollCallLesson[],
    manager?: EntityManager,
  ): Promise<Map<string, StudentRollCallCount>> {
    const asked = lessons.filter((lesson) => isUUID(lesson.id));
    if (asked.length === 0) return new Map();

    const expected = await this.roster.findRosterIds(
      asked.map((lesson) => ({ classId: lesson.classId, date: lesson.date })),
      manager,
    );
    const signed: SignedRollCall[] = await (manager ?? this.dataSource.manager).query(
      `SELECT lesson_id AS "lessonId", enrollment_id AS "enrollmentId"
         FROM student_attendance
        WHERE lesson_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [[...new Set(asked.map((lesson) => lesson.id))]],
    );

    return rollCallCountsOf(asked, expected, signed);
  }
}
