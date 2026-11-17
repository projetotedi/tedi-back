import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { LessonRollCallCounter, RollCallLesson, StudentRollCallCount } from "./lesson-roll-call";

/**
 * Where the module of the attendance plugs in the counter of the roll call of the students
 * (docs/ARCHITECTURE.md section 18.1). `LessonsModule` exports it, `attendance` registers its
 * counter in `onModuleInit`, and every answer of `lessons` (the detail, the writes, the generation,
 * the list and the calendar) asks it.
 *
 * It is a port, not an event: the numbers of a roll call are a read, answered synchronously, and a
 * count kept by events could drift from the attendance, which is the only source of it. It is not
 * the `LessonCoverageRegistry` either: that one already has the counter of the assignments.
 *
 * Without a counter registered nobody is in a roll call as far as `lessons` knows, so it answers an
 * empty map and every lesson reads as `NO_STUDENT_ROLL_CALL` (a null object): an application that
 * loads `lessons` without `attendance` still serves its lessons, never pending.
 */
@Injectable()
export class LessonRollCallRegistry implements LessonRollCallCounter {
  private counter: LessonRollCallCounter | null = null;

  /**
   * Plugs the counter in. One only: a second one would silently split the truth about a roll call,
   * so it throws instead of choosing between them.
   */
  register(counter: LessonRollCallCounter): void {
    if (this.counter !== null) {
      throw new Error("A student roll call counter is already registered.");
    }
    this.counter = counter;
  }

  /** The numbers of the roll call of the lessons, one entry per lesson with someone (see the port). */
  async countStudentRollCalls(
    lessons: readonly RollCallLesson[],
    manager?: EntityManager,
  ): Promise<Map<string, StudentRollCallCount>> {
    if (this.counter === null) return new Map();

    return this.counter.countStudentRollCalls(lessons, manager);
  }
}
