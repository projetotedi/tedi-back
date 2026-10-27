import { CourseDetailDto } from "../dto/course-detail.response.dto";
import { CourseLessonPlansResponseDto } from "../dto/course-lesson-plans.response.dto";
import { RelatedCourseResponseDto } from "../dto/related-course.response.dto";
import { Course } from "../entities/course.entity";
import { CourseCategory } from "../enums/course-category.enum";
import { courseStatusFromArchivedAt, courseStatusOf } from "./course-response.mapper";

/**
 * One line of the query of related courses as CourseDetailService reads it: a course linked to the
 * one being read, either one that it requires (`prerequisite`) or one that requires it
 * (`requiredBy`).
 */
export interface RelatedCourseRow {
  relation: "prerequisite" | "requiredBy";
  id: string;
  name: string;
  category: CourseCategory;
  archivedAt: Date | null;
}

/** Id and name of the person who created the course, read through PeopleService. */
export interface CourseCreator {
  id: string;
  name: string;
}

function toRelatedCourse(row: RelatedCourseRow): RelatedCourseResponseDto {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    status: courseStatusFromArchivedAt(row.archivedAt),
  };
}

/** By name (pt-BR, the same order as `toCourseResponse`), and by id when two names are equal. */
function byNameThenId(a: RelatedCourseResponseDto, b: RelatedCourseResponseDto): number {
  return a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id);
}

function relatedCoursesOf(
  rows: readonly RelatedCourseRow[],
  relation: RelatedCourseRow["relation"],
): RelatedCourseResponseDto[] {
  return rows
    .filter((row) => row.relation === relation)
    .map(toRelatedCourse)
    .sort(byNameThenId);
}

/**
 * The page of a course: its data, both lists of related courses (archived ones included, with
 * their status, each ordered by name), the sequence as it was read and the workload it adds up to
 * (RN-24, never stored). `lessonPlanCount` is the number of items of the sequence.
 *
 * `createdBy` is copied field by field, so only the id and the name of the person ever leave here,
 * whatever object the caller hands over.
 */
export function toCourseDetail(
  course: Course,
  related: readonly RelatedCourseRow[],
  sequence: CourseLessonPlansResponseDto,
  createdBy: CourseCreator | null,
): CourseDetailDto {
  return {
    id: course.id,
    name: course.name,
    description: course.description,
    objective: course.objective ?? null,
    category: course.category,
    status: courseStatusOf(course),
    createdAt: course.createdAt,
    createdBy: createdBy === null ? null : { id: createdBy.id, name: createdBy.name },
    updatedAt: course.updatedAt,
    prerequisites: relatedCoursesOf(related, "prerequisite"),
    requiredBy: relatedCoursesOf(related, "requiredBy"),
    lessonPlans: sequence.items,
    plannedWorkloadMinutes: sequence.plannedWorkloadMinutes,
    lessonPlanCount: sequence.items.length,
  };
}
