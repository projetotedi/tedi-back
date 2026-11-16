import { ClassRef } from "@modules/classes/services/classes.service";
import { LESSON_CALENDAR_COLOR_COUNT } from "../dto/lesson-limits";
import { LessonListItemResponseDto } from "../dto/lesson-list-item.response.dto";
import { Lesson } from "../entities/lesson.entity";
import { ConfirmedStaff, isBelowExpectedMonitors } from "./lesson-coverage";

/**
 * The color slot of a class in the calendar, from 0 to `LESSON_CALENDAR_COLOR_COUNT - 1`. It comes
 * from the position of the class by creation, so it is the same for a class whatever the filter,
 * the page or the period, and classes created one after the other get different slots until the
 * slots run out and the sequence starts again (rank 9 is slot 0 again).
 *
 * The rank starts at 1 (it is a ROW_NUMBER). Anything else is a broken invariant of whoever read
 * the classes, not a business error, and a negative slot would break the contract of the answer.
 */
export function calendarColorIndex(creationRank: number): number {
  if (!Number.isInteger(creationRank) || creationRank < 1) {
    throw new Error(`The creation rank of a class starts at 1, got ${creationRank}.`);
  }

  return (creationRank - 1) % LESSON_CALENDAR_COLOR_COUNT;
}

/**
 * The item of the list and of the calendar: the lesson with the class it belongs to, which the
 * caller read through `ClassesService.listClassRefs`. Nothing else of the lesson goes out (the
 * page of a lesson is the full one).
 *
 * - `class.name` is the name of the class or, when it has none, its code: the row shows one label;
 * - `teacher` is the confirmed teacher of the lesson (E5, GUS-158), with the id and the name and
 *   nothing else of her, or null when the lesson has none (a pending teacher is not the teacher);
 * - `belowExpectedMonitors` is the rule of the coverage (`isBelowExpectedMonitors`): fewer
 *   confirmed monitors than `expectedMonitors`, false for a cancelled lesson and for a lesson that
 *   does not say how many it expects.
 *
 * `staff` is what the caller read for the lesson through the `LessonCoverageRegistry`, in one call
 * for the whole page; it has no default, so a caller that forgets to ask does not compile.
 */
export function toLessonListItem(
  lesson: Lesson,
  schoolClass: ClassRef,
  staff: ConfirmedStaff,
): LessonListItemResponseDto {
  return {
    id: lesson.id,
    class: {
      id: schoolClass.id,
      code: schoolClass.code,
      name: schoolClass.name ?? schoolClass.code,
      colorIndex: calendarColorIndex(schoolClass.creationRank),
    },
    date: lesson.date,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    title: lesson.title,
    status: lesson.status,
    teacher: staff.teacher === null ? null : { id: staff.teacher.id, name: staff.teacher.name },
    belowExpectedMonitors: isBelowExpectedMonitors(lesson, staff),
  };
}
