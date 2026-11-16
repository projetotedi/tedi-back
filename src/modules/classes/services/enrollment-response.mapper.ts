import { CourseSummary } from "@modules/catalog/services/courses.service";
import { StudentRef } from "@modules/people/services/students.service";
import { ClassEnrollmentItemResponseDto } from "../dto/class-enrollment-item.response.dto";
import { EnrollmentClassRefResponseDto } from "../dto/enrollment-class-ref.response.dto";
import { EnrollmentResponseDto } from "../dto/enrollment.response.dto";
import {
  CompletedCourseResponseDto,
  StudentEnrollmentsSummaryResponseDto,
} from "../dto/student-enrollments.response.dto";
import { Enrollment } from "../entities/enrollment.entity";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";

/** Who the student of an enrollment is, as the writes answer it. */
export interface EnrollmentStudentRef {
  id: string;
  name: string;
}

/** One enrollment of the list of a class, as the listing reads it (the date as text). */
export interface ClassEnrollmentRow {
  id: string;
  studentId: string;
  status: EnrollmentStatus;
  enrolledAt: Date;
  statusChangedAt: string;
}

/** A class with its edition, as the lists of the enrollments read it. */
export interface EnrollmentClassRow {
  classId: string;
  classCode: string;
  className: string | null;
  editionId: string;
  editionName: string;
}

/** One enrollment of the history of a student, with its class and the course of the class. */
export interface StudentEnrollmentRow extends EnrollmentClassRow {
  id: string;
  status: EnrollmentStatus;
  enrolledAt: Date;
  statusChangedAt: string;
  courseId: string;
}

/**
 * The enrollment as the writes answer it. Explicit projection: no internal column (createdById,
 * the timestamps of the row) reaches the response by accident.
 */
export function toEnrollmentResponse(
  enrollment: Enrollment,
  student: EnrollmentStudentRef,
): EnrollmentResponseDto {
  return {
    id: enrollment.id,
    classId: enrollment.classId,
    student: { id: student.id, name: student.name },
    status: enrollment.status,
    enrolledAt: enrollment.enrolledAt,
    statusChangedAt: enrollment.statusChangedAt,
    statusReason: enrollment.statusReason,
  };
}

/**
 * One enrollment of the list of a class. `canSeeStudentContact` is the decision of the policy
 * (students.view) and has no default on purpose: whoever calls decides, every time, whether the phone
 * and the accessibility need of the student go out (RNF-13); without it they are null.
 *
 * `attendanceRate` is null until the roll call of the students (GUS-166), which plugs its reader
 * here and in `EnrollmentListingService.listClassEnrollments` (one call per page). The contract
 * (`number | null`) does not change.
 */
export function toClassEnrollmentItem(
  row: ClassEnrollmentRow,
  student: StudentRef,
  options: { canSeeStudentContact: boolean },
): ClassEnrollmentItemResponseDto {
  return {
    id: row.id,
    student: {
      id: student.id,
      name: student.name,
      age: student.age,
      phone: options.canSeeStudentContact ? student.phone : null,
      accessibilityNeed: options.canSeeStudentContact ? student.accessibilityNeed : null,
    },
    status: row.status,
    enrolledAt: row.enrolledAt,
    statusChangedAt: row.statusChangedAt,
    attendanceRate: null,
  };
}

/** The class of an enrollment with its edition. */
export function toEnrollmentClassRef(row: EnrollmentClassRow): EnrollmentClassRefResponseDto {
  return {
    id: row.classId,
    code: row.classCode,
    name: row.className,
    edition: { id: row.editionId, name: row.editionName },
  };
}

/**
 * What the history of a student adds up to (pure): `activeClasses`, the active enrollments;
 * `completedCourses`, one per course with a completed enrollment (RN-16), with the latest
 * `statusChangedAt` of that course as `completedAt` ("YYYY-MM-DD" strings compare as dates), by
 * `completedAt` and then name; and `firstEnrollmentAt`, the earliest `enrolledAt`, or null.
 *
 * Every course of `rows` must be in `coursesById`: the foreign key keeps the course of a class, so a
 * missing one is a broken invariant and throws.
 */
export function summarizeStudentEnrollments(
  rows: readonly StudentEnrollmentRow[],
  coursesById: ReadonlyMap<string, CourseSummary>,
): StudentEnrollmentsSummaryResponseDto {
  const completedAtByCourse = new Map<string, string>();
  for (const row of rows) {
    if (row.status !== EnrollmentStatus.COMPLETED) continue;
    const latest = completedAtByCourse.get(row.courseId);
    if (latest === undefined || row.statusChangedAt > latest) {
      completedAtByCourse.set(row.courseId, row.statusChangedAt);
    }
  }

  const completedCourses: CompletedCourseResponseDto[] = [...completedAtByCourse].map(
    ([courseId, completedAt]) => {
      const course = coursesById.get(courseId);
      if (course === undefined) throw new Error(`The course ${courseId} of a class is gone.`);
      return { courseId, name: course.name, completedAt };
    },
  );
  completedCourses.sort(
    (left, right) =>
      left.completedAt.localeCompare(right.completedAt) || left.name.localeCompare(right.name),
  );

  let firstEnrollmentAt: Date | null = null;
  for (const row of rows) {
    if (firstEnrollmentAt === null || row.enrolledAt < firstEnrollmentAt) {
      firstEnrollmentAt = row.enrolledAt;
    }
  }

  return {
    activeClasses: rows.filter((row) => row.status === EnrollmentStatus.ACTIVE).length,
    completedCourses,
    firstEnrollmentAt,
  };
}
