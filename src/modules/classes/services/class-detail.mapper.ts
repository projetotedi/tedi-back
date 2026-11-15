import { CourseSummary } from "@modules/catalog/services/courses.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { ClassDetailDto } from "../dto/class-detail.response.dto";
import { ClassEnrollmentPreviewItemResponseDto } from "../dto/class-enrollment-preview-item.response.dto";
import { SchoolClass } from "../entities/class.entity";
import { Edition } from "../entities/edition.entity";
import { occupancyRateOf } from "./class-occupancy";
import { ActiveEnrollmentPreviewRow } from "./enrollment-counts.service";

/** Everything `ClassDetailService` has read, ready to be put together. */
export interface ClassDetailInput {
  schoolClass: SchoolClass;
  edition: Edition;
  /** The course as the catalog gives it now: the category here is the one the sheet shows. */
  course: CourseSummary;
  /** Items of the sequence of lesson plans of the course. */
  lessonPlanCount: number;
  plannedWorkloadMinutes: number;
  createdBy: PersonRefDto | null;
  /** Active enrollments of the class. */
  enrolledCount: number;
  /** The first active enrollments, in the order they must be shown. */
  previewRows: readonly ActiveEnrollmentPreviewRow[];
  /** The people found for the students of `previewRows`, by id. */
  peopleById: ReadonlyMap<string, PersonRefDto>;
}

/**
 * A row of the preview with the name of its student, or null when the person was not found (it
 * was removed): a row without a name is left out, never shown as an empty one.
 */
function toPreviewItem(
  row: ActiveEnrollmentPreviewRow,
  peopleById: ReadonlyMap<string, PersonRefDto>,
): ClassEnrollmentPreviewItemResponseDto | null {
  const student = peopleById.get(row.studentId);
  if (student === undefined) return null;

  return {
    id: row.enrollmentId,
    student: { id: student.id, name: student.name },
    enrolledAt: row.enrolledAt,
  };
}

/**
 * The sheet of a class (GUS-104). Field by field, so only what the contract lists leaves here.
 *
 * - `course.category` is the one of the course summary, never one of the class (RN-14, RF-029).
 * - `summary` carries `lessonsDone`, `lessonsTotal` and `averageAttendance` as an explicit `null`:
 *   the keys are in every answer and the front reads `number | null` (the lessons and the
 *   attendance do not feed the sheet yet).
 * - `enrollmentsPreview` keeps the order of the rows. `enrollmentsTotal` is the number of active
 *   enrollments, the same as `summary.enrolledCount`, and it can be larger than the preview.
 * - `createdBy` copies only the id and the name of the person.
 */
export function toClassDetail(input: ClassDetailInput): ClassDetailDto {
  const { schoolClass, edition, course, createdBy, enrolledCount } = input;

  return {
    id: schoolClass.id,
    code: schoolClass.code,
    name: schoolClass.name ?? null,
    edition: { id: edition.id, name: edition.name },
    startDate: schoolClass.startDate,
    endDate: schoolClass.endDate,
    location: schoolClass.location ?? null,
    capacity: schoolClass.capacity,
    status: schoolClass.status,
    // The embedded columns are missing on an entity that was just inserted, not loaded.
    archivedAt: schoolClass.archive?.archivedAt ?? null,
    createdAt: schoolClass.createdAt,
    createdBy: createdBy === null ? null : { id: createdBy.id, name: createdBy.name },
    course: {
      id: course.id,
      name: course.name,
      category: course.category,
      status: course.status,
      lessonPlanCount: input.lessonPlanCount,
      plannedWorkloadMinutes: input.plannedWorkloadMinutes,
    },
    summary: {
      enrolledCount,
      capacity: schoolClass.capacity,
      occupancyRate: occupancyRateOf(enrolledCount, schoolClass.capacity),
      lessonsDone: null,
      lessonsTotal: null,
      averageAttendance: null,
    },
    enrollmentsPreview: input.previewRows
      .map((row) => toPreviewItem(row, input.peopleById))
      .filter((item): item is ClassEnrollmentPreviewItemResponseDto => item !== null),
    enrollmentsTotal: enrolledCount,
  };
}
