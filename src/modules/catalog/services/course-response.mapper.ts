import { CourseResponseDto } from "../dto/course.response.dto";
import { Course } from "../entities/course.entity";
import { CourseStatus } from "../enums/course-status.enum";

/**
 * The status is not a column: it follows `archived_at` (RN-27). For whoever only has the column,
 * like the rows of a raw query; with the entity at hand use `courseStatusOf`.
 */
export function courseStatusFromArchivedAt(archivedAt: Date | null): CourseStatus {
  return archivedAt != null ? CourseStatus.ARCHIVED : CourseStatus.ACTIVE;
}

export function courseStatusOf(course: Course): CourseStatus {
  return courseStatusFromArchivedAt(course.archive?.archivedAt ?? null);
}

export function toCourseResponse(
  course: Course,
  prerequisites: readonly Course[],
): CourseResponseDto {
  return {
    id: course.id,
    name: course.name,
    description: course.description,
    objective: course.objective ?? null,
    category: course.category,
    status: courseStatusOf(course),
    prerequisites: prerequisites
      .map((prerequisite) => ({ id: prerequisite.id, name: prerequisite.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    archivedAt: course.archive?.archivedAt ?? null,
    archivedById: course.archive?.archivedById ?? null,
    archiveReason: course.archive?.archiveReason ?? null,
    createdById: course.createdById,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  };
}
