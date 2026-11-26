import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";

/**
 * What `people` asks the enrollments before it archives a student (docs/ARCHITECTURE.md section
 * 19, M1): how many ACTIVE enrollments the student has. `classes` implements it, because the
 * enrollments live there and `people` cannot import `classes` (the arrow is `classes -> people`).
 *
 * Invariant: the implementation takes NO lock. It is a plain count, run inside the transaction of
 * the archive (`manager`), after that transaction locked the student profile FOR UPDATE. An
 * enrollment locks the class first and the profile after it, so a count that locked a class would
 * make the archive (profile -> class) and the enrollment (class -> profile) wait for each other.
 */
export interface StudentEnrollmentsReader {
  countActiveEnrollments(manager: EntityManager, studentId: string): Promise<number>;
}

/**
 * Where the module of the enrollments plugs in the reader of the active enrollments of a student.
 * `PeopleModule` exports it, `classes` registers its reader in `onModuleInit`, and
 * `StudentsService.archive` asks it (409 STUDENT_HAS_ACTIVE_ENROLLMENTS).
 *
 * It is a port, not an event: "does the student have an active enrollment?" is a read that decides
 * a write, answered synchronously, and the 409 belongs to the service of the student (section
 * 10.3). A listener of `@nestjs/event-emitter` would also have its error swallowed by default
 * (`suppressErrors`), and the archive would pass in silence.
 *
 * Without a reader registered there are no enrollments as far as `people` knows, so it answers 0
 * (a null object): an application that loads `people` without `classes` still archives students.
 */
@Injectable()
export class StudentEnrollmentsRegistry implements StudentEnrollmentsReader {
  private reader: StudentEnrollmentsReader | null = null;

  /**
   * Plugs the reader in. One only: a second one would split the truth about the enrollments of a
   * student, so it throws instead of choosing between them.
   */
  register(reader: StudentEnrollmentsReader): void {
    if (this.reader !== null) {
      throw new Error("A student enrollments reader is already registered.");
    }
    this.reader = reader;
  }

  /** The active enrollments of the student, read with the `manager` of the caller (see the port). */
  countActiveEnrollments(manager: EntityManager, studentId: string): Promise<number> {
    if (this.reader === null) return Promise.resolve(0);

    return this.reader.countActiveEnrollments(manager, studentId);
  }
}
