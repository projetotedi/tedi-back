import { CourseRef } from "@modules/catalog/services/courses.service";
import { EnrollmentWarningCode } from "../enums/enrollment-warning-code.enum";

/**
 * Who completed what: a student with a completed enrollment in a course (in any class of it,
 * archived included). A pair of ids, not the `CompletedCourseResponseDto` of the history.
 */
export interface StudentCourseCompletion {
  studentId: string;
  courseId: string;
}

/** One prerequisite a student is enrolled without (RF-032): a warning, not a refusal. */
export interface EnrollmentWarning {
  studentId: string;
  code: EnrollmentWarningCode;
  courseId: string;
  courseName: string;
}

/**
 * The prerequisites each student did not complete, one warning per student and missing course, in
 * the order of `studentIds` and then in the order of `prerequisites` (the catalog answers them by
 * name, then id). A prerequisite counts as done only by a completed enrollment in THAT course: a
 * duplicate of it (GUS-117) is another course.
 */
export function missingPrerequisites(
  studentIds: readonly string[],
  prerequisites: readonly CourseRef[],
  completions: readonly StudentCourseCompletion[],
): EnrollmentWarning[] {
  const done = new Set(completions.map((pair) => `${pair.studentId}:${pair.courseId}`));

  return studentIds.flatMap((studentId) =>
    prerequisites
      .filter((course) => !done.has(`${studentId}:${course.id}`))
      .map((course) => ({
        studentId,
        code: EnrollmentWarningCode.PREREQUISITE_NOT_COMPLETED,
        courseId: course.id,
        courseName: course.name,
      })),
  );
}
