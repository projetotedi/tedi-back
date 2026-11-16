import { EntityManager } from "typeorm";
import { timeOfDayInAppTimeZone, todayInAppTimeZone } from "@shared/dates/calendar-date";
import { LessonAttendanceDto } from "../dto/lesson-attendance.response.dto";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";

/**
 * The roll call of the students of a lesson, counted (GUS-166, docs/ARCHITECTURE.md section 18.1):
 * `total` is every enrollment the lesson expects on its day plus every one signed in it, and
 * `signed` the ones signed, so `signed` is never above `total`.
 */
export interface StudentRollCallCount {
  total: number;
  signed: number;
}

/**
 * A lesson whose roll call has nobody: no student expected and nothing signed, or no counter
 * registered (an application that loads `lessons` without `attendance`).
 */
export const NO_STUDENT_ROLL_CALL: Readonly<StudentRollCallCount> = Object.freeze({
  total: 0,
  signed: 0,
});

/** What the counter needs to know of a lesson: which one, its class and its day ("YYYY-MM-DD"). */
export interface RollCallLesson {
  id: string;
  classId: string;
  date: string;
}

/**
 * The port through which `lessons` learns the numbers of the roll call of its lessons without
 * knowing who takes it: the `attendance` module implements it and registers it in the
 * `LessonRollCallRegistry` (docs/ARCHITECTURE.md section 18.1). `lessons` decides what "ended" and
 * "pending" are; the port only counts.
 *
 * It answers ONE entry per lesson whose roll call has someone (`total > 0`); a lesson left out is
 * read as `NO_STUDENT_ROLL_CALL`. It is meant to be called once per page of lessons (or per period,
 * or per answer of a write), never once per lesson. Pass the `manager` of a transaction to count
 * inside it; the implementation takes no lock.
 */
export interface LessonRollCallCounter {
  countStudentRollCalls(
    lessons: readonly RollCallLesson[],
    manager?: EntityManager,
  ): Promise<Map<string, StudentRollCallCount>>;
}

/** The lesson as the counter takes it: the entity never leaves this module. */
export function rollCallLessonOf(lesson: Pick<Lesson, "id" | "classId" | "date">): RollCallLesson {
  return { id: lesson.id, classId: lesson.classId, date: lesson.date };
}

/**
 * Whether the lesson is over at `now`, in America/Sao_Paulo: its day is before today, or it is today
 * and its `endTime` has come (the lesson of 09:00 to 11:00 is over at 11:00). Both are compared as
 * strings, "YYYY-MM-DD" and "HH:mm".
 */
export function hasLessonEnded(lesson: Pick<Lesson, "date" | "endTime">, now: Date): boolean {
  const today = todayInAppTimeZone(now);
  if (lesson.date !== today) return lesson.date < today;

  return lesson.endTime <= timeOfDayInAppTimeZone(now);
}

/**
 * Whether the roll call of the lesson is pending (F6.1, the "Chamada pendente" of the list): the
 * lesson is not cancelled, it is over and some student of its roll call has no attendance. A lesson
 * without students is never pending, and neither is one that is still to come or under way.
 */
export function isAttendancePending(
  lesson: Pick<Lesson, "status" | "date" | "endTime">,
  count: StudentRollCallCount,
  now: Date,
): boolean {
  return (
    lesson.status !== LessonStatus.CANCELLED &&
    hasLessonEnded(lesson, now) &&
    count.signed < count.total
  );
}

/** The `attendance` of a lesson, as every answer of this module shows it. */
export function toLessonAttendance(
  lesson: Pick<Lesson, "status" | "date" | "endTime">,
  count: StudentRollCallCount,
  now: Date,
): LessonAttendanceDto {
  return {
    students: { total: count.total, signed: count.signed },
    pending: isAttendancePending(lesson, count, now),
  };
}
