import { CourseSummary } from "@modules/catalog/services/courses.service";
import { ClassListItemDto } from "../dto/class-list-item.response.dto";
import { ClassStatus } from "../enums/class-status.enum";

/** A row of the page of `ClassListService.list`, before the course and the enrollments. */
export interface ClassListRow {
  id: string;
  code: string;
  name: string | null;
  courseId: string;
  editionId: string;
  editionName: string;
  startDate: string;
  endDate: string;
  capacity: number;
  status: ClassStatus;
  archivedAt: Date | null;
}

/**
 * A line of the list. The course comes from the catalog (`CourseLookupService.getCourseSummaries`),
 * with its current category (RN-14); `enrolledCount` is the active enrollments of the class, 0 when
 * it has none.
 */
export function toClassListItem(
  row: ClassListRow,
  course: CourseSummary,
  enrolledCount: number,
): ClassListItemDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    course: { id: course.id, name: course.name, category: course.category, status: course.status },
    edition: { id: row.editionId, name: row.editionName },
    startDate: row.startDate,
    endDate: row.endDate,
    enrolledCount,
    capacity: row.capacity,
    status: row.status,
    archivedAt: row.archivedAt,
  };
}
