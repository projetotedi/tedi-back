import { Lesson } from "../entities/lesson.entity";

/**
 * What the audit event LESSON_CREATED says about the lesson that was created: the same fields
 * whether it came from `POST /lessons` or from the generation of the lessons of a class (GUS-154),
 * so the trail does not tell the two apart by shape. The one place that builds it.
 *
 * Title, day, time, place and status go with their values. The free text that is written after the
 * fact (`postNotes`, `cancelReason`, `rescheduleReason`, `rescheduleNote`) is not here: a lesson is
 * born without any of them, and they can hold personal data about a student (RNF-13, L10).
 */
export function lessonCreatedPayload(lesson: Lesson): Record<string, unknown> {
  return {
    classId: lesson.classId,
    lessonPlanId: lesson.lessonPlanId,
    sequenceOrder: lesson.sequenceOrder,
    title: lesson.title,
    objective: lesson.objective,
    date: lesson.date,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    location: lesson.location,
    expectedStudents: lesson.expectedStudents,
    expectedMonitors: lesson.expectedMonitors,
    subject: lesson.subject,
    status: lesson.status,
  };
}
