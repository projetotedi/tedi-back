import { Injectable, OnModuleInit } from "@nestjs/common";
import { isUUID } from "class-validator";
import { DataSource, EntityManager } from "typeorm";
import {
  EnrollmentAttendanceReader,
  EnrollmentAttendanceRegistry,
} from "@modules/classes/services/enrollment-attendance.registry";
import { LessonsService, LessonStatus } from "@modules/lessons/services/lessons.service";
import { attendanceRatesOf, RecordedAttendance } from "./student-attendance-stats";

/**
 * The reader of the attendance of the enrollments (GUS-166): the implementation, in `attendance`, of
 * the port that `classes` defines (`EnrollmentAttendanceReader`, docs/ARCHITECTURE.md section 18.1).
 * It plugs itself in the `EnrollmentAttendanceRegistry` when the module starts, and from then on the
 * list of a class and the history of a student show the attendance rate of each enrollment, and the
 * removal of an enrollment refuses one with attendance.
 *
 * Nothing here takes a lock (the invariant of the port): the removal counts inside its own
 * transaction, after it locked the class and the enrollment.
 */
@Injectable()
export class EnrollmentAttendanceReaderService implements EnrollmentAttendanceReader, OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: EnrollmentAttendanceRegistry,
    private readonly lessons: LessonsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * The attendance rate of each enrollment (S14) in TWO queries for the whole page or history: the
   * signatures of the enrollments, and their lessons (`LessonsService.findLessonSummaries`, for the
   * cancelled ones, which leave the rate); folded by `attendanceRatesOf`. An id that is not a UUID
   * is skipped and a repeated one counts once; with nothing to ask, or no signature at all, it
   * answers an empty map. A plain read.
   */
  async attendanceRates(enrollmentIds: readonly string[]): Promise<Map<string, number>> {
    const ids = [
      ...new Set(enrollmentIds.filter((id) => isUUID(id)).map((id) => id.toLowerCase())),
    ];
    if (ids.length === 0) return new Map();

    const rows: RecordedAttendance[] = await this.dataSource.query(
      `SELECT enrollment_id AS "enrollmentId", lesson_id AS "lessonId", status AS "status"
         FROM student_attendance
        WHERE enrollment_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids],
    );
    if (rows.length === 0) return new Map();

    const lessons = await this.lessons.findLessonSummaries([
      ...new Set(rows.map((row) => row.lessonId)),
    ]);
    const cancelled = new Set(
      lessons
        .filter((lesson) => lesson.status === LessonStatus.CANCELLED)
        .map((lesson) => lesson.id),
    );

    return attendanceRatesOf(rows, cancelled);
  }

  /**
   * How many attendances are signed for the enrollment, with the `manager` of the caller (the
   * transaction of the removal) and no lock. An id that is not a UUID has none.
   */
  async countAttendance(manager: EntityManager, enrollmentId: string): Promise<number> {
    if (!isUUID(enrollmentId)) return 0;

    const rows: Array<{ count: number }> = await manager.query(
      `SELECT COUNT(*)::int AS "count"
         FROM student_attendance
        WHERE enrollment_id = $1 AND deleted_at IS NULL`,
      [enrollmentId],
    );
    return rows[0].count;
  }
}
