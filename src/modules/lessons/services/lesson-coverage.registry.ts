import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { ConfirmedStaffCount, LessonStaffCounter } from "./lesson-coverage";

/**
 * Where the module that assigns people to lessons plugs in the counter of the confirmed staff
 * (docs/ARCHITECTURE.md section 15). `LessonsModule` exports it, `assignments` registers its
 * counter in `onModuleInit`, and `lessons` (and the listing and the calendar, GUS-153) ask it.
 *
 * It is a port, not an event: coverage is a read, answered synchronously, and a count kept up to
 * date by events could drift from the assignments, which is the only source of it.
 *
 * Without a counter registered nobody is assigned as far as `lessons` knows, so it answers an empty
 * map and every lesson reads as `NO_CONFIRMED_STAFF` (a null object): an application that loads
 * `lessons` without `assignments` still serves its lessons.
 */
@Injectable()
export class LessonCoverageRegistry implements LessonStaffCounter {
  private counter: LessonStaffCounter | null = null;

  /**
   * Plugs the counter in. One only: a second one would silently split the truth about who is
   * confirmed in a lesson, so it throws instead of choosing between them.
   */
  register(counter: LessonStaffCounter): void {
    if (this.counter !== null) {
      throw new Error("A lesson staff counter is already registered.");
    }
    this.counter = counter;
  }

  /** The confirmed staff of the lessons, one entry per lesson that has someone (see the port). */
  async countConfirmedStaff(
    lessonIds: readonly string[],
    manager?: EntityManager,
  ): Promise<Map<string, ConfirmedStaffCount>> {
    if (this.counter === null) return new Map();

    return this.counter.countConfirmedStaff(lessonIds, manager);
  }
}
