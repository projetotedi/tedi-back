import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { HourEntry } from "../entities/hour-entry.entity";

/**
 * The answer of an hour entry, copied field by field: the entity has columns the contract does not
 * show (`deletedAt`), and a spread would publish whatever column comes next. `cancelledLessonIds` are
 * the cancelled lessons among the ones of the entries answered (`findCancelledLessonIds`).
 */
export function toHourEntryResponse(
  entry: HourEntry,
  cancelledLessonIds: ReadonlySet<string>,
): HourEntryResponseDto {
  return {
    id: entry.id,
    personId: entry.personId,
    activity: entry.activity,
    category: entry.category,
    date: entry.date,
    declaredMinutes: entry.declaredMinutes,
    validatedMinutes: entry.validatedMinutes,
    notes: entry.notes,
    status: entry.status,
    origin: entry.origin,
    createdById: entry.createdById,
    classId: entry.classId,
    lessonId: entry.lessonId,
    lessonCancelled: entry.lessonId !== null && cancelledLessonIds.has(entry.lessonId),
    reviewNote: entry.reviewNote,
    reviewedById: entry.reviewedById,
    reviewedAt: entry.reviewedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
