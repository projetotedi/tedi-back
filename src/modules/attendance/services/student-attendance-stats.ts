import { RosterSlotEnrollment } from "@modules/classes/services/enrollment-roster.service";
import { RollCallLesson, StudentRollCallCount } from "@modules/lessons/services/lesson-roll-call";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";

/** One signature of a lesson, as the counter of the roll calls reads it. */
export interface SignedRollCall {
  lessonId: string;
  enrollmentId: string;
}

/** One attendance of an enrollment, as the attendance rate reads it. */
export interface RecordedAttendance {
  enrollmentId: string;
  lessonId: string;
  status: StudentAttendanceStatus;
}

const NOBODY: ReadonlySet<string> = new Set();

function slotKey(classId: string, date: string): string {
  return `${classId}|${date}`;
}

/** Adds `value` to the set of `key`, creating it on the first one. */
function addTo(sets: Map<string, Set<string>>, key: string, value: string): void {
  const set = sets.get(key);
  if (set === undefined) sets.set(key, new Set([value]));
  else set.add(value);
}

/**
 * The numbers of the roll call of each lesson (pure, GUS-166, S2 and S12): `total` is the union of
 * the enrollments its class expects on its day (`expected`, by class and day) and the ones signed in
 * it, and `signed` the signed ones. Since `signed` is a subset of the union, `signed < total` holds
 * exactly when an expected enrollment has no signature: a signature of a student who dropped
 * afterwards never "completes" the roll call in the place of an expected one.
 *
 * Two lessons of the same class on the same day share the expected enrollments. A lesson whose
 * total is 0 is left out of the map (the reader takes `NO_STUDENT_ROLL_CALL`), and a repeated lesson
 * counts once. Indexed by maps: the work is linear in the rows.
 */
export function rollCallCountsOf(
  lessons: readonly RollCallLesson[],
  expected: readonly RosterSlotEnrollment[],
  signed: readonly SignedRollCall[],
): Map<string, StudentRollCallCount> {
  const expectedBySlot = new Map<string, Set<string>>();
  for (const row of expected)
    addTo(expectedBySlot, slotKey(row.classId, row.date), row.enrollmentId);
  const signedByLesson = new Map<string, Set<string>>();
  for (const row of signed) addTo(signedByLesson, row.lessonId, row.enrollmentId);

  const counts = new Map<string, StudentRollCallCount>();
  for (const lesson of lessons) {
    if (counts.has(lesson.id)) continue;

    const expectedIds = expectedBySlot.get(slotKey(lesson.classId, lesson.date)) ?? NOBODY;
    const signedIds = signedByLesson.get(lesson.id) ?? NOBODY;
    let signedOutside = 0;
    for (const enrollmentId of signedIds) {
      if (!expectedIds.has(enrollmentId)) signedOutside += 1;
    }
    const total = expectedIds.size + signedOutside;
    if (total > 0) counts.set(lesson.id, { total, signed: signedIds.size });
  }
  return counts;
}

/**
 * The rate of `present` over `recorded`, from 0 to 1 with two decimals (the scale of the
 * occupancy of a class). `recorded` below 1 is a broken invariant (an enrollment without a roll call
 * has no rate, it is null): it throws instead of publishing NaN or Infinity.
 */
export function rateOf(present: number, recorded: number): number {
  if (!Number.isInteger(recorded) || recorded < 1) {
    throw new Error(`An attendance rate needs at least one recorded roll call, got ${recorded}.`);
  }
  return Math.round((present * 100) / recorded) / 100;
}

/**
 * The attendance rate of each enrollment (pure, F6.3, GUS-166, S14): its presences over its roll
 * calls recorded in lessons that were not cancelled. A justified absence is an absence; a lesson
 * cancelled after the roll call leaves both sides. An enrollment left without any recorded roll call
 * is not in the map: its rate is null, not 0.
 */
export function attendanceRatesOf(
  rows: readonly RecordedAttendance[],
  cancelledLessonIds: ReadonlySet<string>,
): Map<string, number> {
  const tally = new Map<string, { present: number; recorded: number }>();
  for (const row of rows) {
    if (cancelledLessonIds.has(row.lessonId)) continue;

    const counts = tally.get(row.enrollmentId) ?? { present: 0, recorded: 0 };
    switch (row.status) {
      case StudentAttendanceStatus.PRESENT:
        counts.present += 1;
        break;
      case StudentAttendanceStatus.ABSENT:
        break;
      default: {
        const unknownStatus: never = row.status;
        throw new Error(`Unknown student attendance status: ${String(unknownStatus)}.`);
      }
    }
    counts.recorded += 1;
    tally.set(row.enrollmentId, counts);
  }

  return new Map(
    [...tally].map(([enrollmentId, counts]) => [
      enrollmentId,
      rateOf(counts.present, counts.recorded),
    ]),
  );
}
