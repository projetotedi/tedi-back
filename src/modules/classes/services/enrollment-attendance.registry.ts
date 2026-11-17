import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";

/**
 * What `classes` asks the attendance about an enrollment (GUS-166, docs/ARCHITECTURE.md section
 * 18.1): its attendance rate, for the list of a class and the history of a student, and whether it
 * has an attendance, before it removes it. `attendance` implements it, because the attendance lives
 * there and `classes` cannot import `attendance` (the arrow is `attendance -> classes`).
 *
 * Invariant: the implementation takes NO lock (section 19, M1). `countAttendance` runs inside the
 * transaction of the removal (`manager`), after it locked the class and the enrollment FOR UPDATE;
 * the roll call locks the lesson and the class before its own rows, so a count that locked them
 * could make the two wait for each other.
 */
export interface EnrollmentAttendanceReader {
  /**
   * The attendance rate of each enrollment (presences over the roll calls recorded for it in lessons
   * not cancelled, from 0 to 1 with two decimals), in ONE call for the whole page or history. An
   * enrollment without a recorded roll call is left out of the map: the caller reads it as null.
   */
  attendanceRates(enrollmentIds: readonly string[]): Promise<Map<string, number>>;

  /** How many attendances are signed for the enrollment, read with the `manager` of the caller. */
  countAttendance(manager: EntityManager, enrollmentId: string): Promise<number>;
}

/**
 * Where the module of the attendance plugs in the reader of the attendance of the enrollments.
 * `ClassesModule` exports it, `attendance` registers its reader in `onModuleInit`, and
 * `EnrollmentListingService` (the rates) and `EnrollmentsService.remove` (409
 * ENROLLMENT_NOT_REMOVABLE with attendance) ask it.
 *
 * It is a port, not an event: both are reads, the second one decides a write, and the 409 belongs to
 * the service of the enrollment (section 10.3).
 *
 * Without a reader registered there is no attendance as far as `classes` knows, so the rates come
 * empty (every `attendanceRate` is null) and the count is 0 (a null object): an application that
 * loads `classes` without `attendance` still lists and removes its enrollments.
 */
@Injectable()
export class EnrollmentAttendanceRegistry implements EnrollmentAttendanceReader {
  private reader: EnrollmentAttendanceReader | null = null;

  /**
   * Plugs the reader in. One only: a second one would split the truth about the attendance of an
   * enrollment, so it throws instead of choosing between them.
   */
  register(reader: EnrollmentAttendanceReader): void {
    if (this.reader !== null) {
      throw new Error("An enrollment attendance reader is already registered.");
    }
    this.reader = reader;
  }

  /** The attendance rate of each enrollment that has one (see the port). */
  async attendanceRates(enrollmentIds: readonly string[]): Promise<Map<string, number>> {
    if (this.reader === null) return new Map();

    return this.reader.attendanceRates(enrollmentIds);
  }

  /** The attendances of the enrollment, read with the `manager` of the caller (see the port). */
  countAttendance(manager: EntityManager, enrollmentId: string): Promise<number> {
    if (this.reader === null) return Promise.resolve(0);

    return this.reader.countAttendance(manager, enrollmentId);
  }
}
