import { ClassSummary } from "@modules/classes/services/classes.service";
import { CourseSummary } from "@modules/catalog/services/courses.service";
import { LessonPlanSummary } from "@modules/catalog/services/lesson-plans.service";
import { minutesBetween } from "@shared/dates/time-of-day";
import { LessonResponseDto } from "../dto/lesson.response.dto";
import { Lesson } from "../entities/lesson.entity";

/** What the answer shows next to the lesson, read through the services the other modules export. */
export interface LessonRefs {
  schoolClass: ClassSummary;
  course: CourseSummary;
  /** Null for a lesson created on its own. */
  lessonPlan: LessonPlanSummary | null;
}

/**
 * The answer of every route: the lesson with its class, course, edition and lesson plan. The
 * duration is not a column, it is the difference of the two times, calculated here (RF-039).
 */
export function toLessonResponse(lesson: Lesson, refs: LessonRefs): LessonResponseDto {
  const { schoolClass, course, lessonPlan } = refs;

  return {
    id: lesson.id,
    class: {
      id: schoolClass.id,
      code: schoolClass.code,
      name: schoolClass.name,
      startDate: schoolClass.startDate,
      endDate: schoolClass.endDate,
      archivedAt: schoolClass.archivedAt,
    },
    course: { id: course.id, name: course.name },
    edition: { id: schoolClass.edition.id, name: schoolClass.edition.name },
    lessonPlan:
      lessonPlan === null
        ? null
        : { id: lessonPlan.id, title: lessonPlan.title, archivedAt: lessonPlan.archivedAt },
    // The optional columns are missing (undefined) on an entity that was just inserted, not loaded.
    sequenceOrder: lesson.sequenceOrder ?? null,
    title: lesson.title,
    objective: lesson.objective ?? null,
    date: lesson.date,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    durationMinutes: minutesBetween(lesson.startTime, lesson.endTime),
    location: lesson.location ?? null,
    expectedStudents: lesson.expectedStudents ?? null,
    expectedMonitors: lesson.expectedMonitors ?? null,
    subject: lesson.subject ?? null,
    postNotes: lesson.postNotes ?? null,
    status: lesson.status,
    cancelReason: lesson.cancelReason ?? null,
    cancelledAt: lesson.cancelledAt ?? null,
    cancelledById: lesson.cancelledById ?? null,
    originalDate: lesson.originalDate ?? null,
    rescheduleReason: lesson.rescheduleReason ?? null,
    rescheduleNote: lesson.rescheduleNote ?? null,
    createdById: lesson.createdById,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
  };
}
