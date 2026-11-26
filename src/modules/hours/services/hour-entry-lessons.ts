import { LessonsService, LessonStatus } from "@modules/lessons/services/lessons.service";
import { HourEntry } from "../entities/hour-entry.entity";

/**
 * No lesson is cancelled: the answer of an entry just logged, which cannot be linked to a cancelled
 * lesson (409 LESSON_CANCELLED).
 */
export const NO_CANCELLED_LESSONS: ReadonlySet<string> = new Set();

/**
 * The lessons of these entries that are cancelled, in one query through `LessonsService` (the
 * `hours` module never reads the table of `lessons`). An entry linked to a lesson cancelled after it
 * was logged stays, and its answer says so (`lessonCancelled`): the coordination decides in the
 * review (PO, GUS-172). Without a lesson to ask, it answers without a query.
 */
export async function findCancelledLessonIds(
  lessons: LessonsService,
  entries: readonly Pick<HourEntry, "lessonId">[],
): Promise<ReadonlySet<string>> {
  const ids = entries.flatMap((entry) => (entry.lessonId === null ? [] : [entry.lessonId]));
  if (ids.length === 0) return NO_CANCELLED_LESSONS;

  const summaries = await lessons.findLessonSummaries(ids);
  return new Set(
    summaries
      .filter((lesson) => lesson.status === LessonStatus.CANCELLED)
      .map((lesson) => lesson.id),
  );
}
