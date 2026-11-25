import { CourseSummary } from "@modules/catalog/services/courses.service";
import { ClassResponseDto } from "../dto/class.response.dto";
import { SchoolClass } from "../entities/class.entity";
import { Edition } from "../entities/edition.entity";

/**
 * The answer of a class. `course` comes from the course itself, read for this answer: the class
 * stores no category, and shows the current one of its course (RN-14).
 */
export function toClassResponse(
  schoolClass: SchoolClass,
  edition: Edition,
  course: CourseSummary,
): ClassResponseDto {
  return {
    id: schoolClass.id,
    code: schoolClass.code,
    name: schoolClass.name ?? null,
    courseId: schoolClass.courseId,
    course: {
      id: course.id,
      name: course.name,
      category: course.category,
      status: course.status,
    },
    edition: { id: edition.id, name: edition.name },
    startDate: schoolClass.startDate,
    endDate: schoolClass.endDate,
    location: schoolClass.location ?? null,
    capacity: schoolClass.capacity,
    status: schoolClass.status,
    // The embedded columns are missing on an entity that was just inserted, not loaded.
    archivedAt: schoolClass.archive?.archivedAt ?? null,
    archivedById: schoolClass.archive?.archivedById ?? null,
    archiveReason: schoolClass.archive?.archiveReason ?? null,
    createdById: schoolClass.createdById,
    createdAt: schoolClass.createdAt,
    updatedAt: schoolClass.updatedAt,
  };
}
