import {
  CourseCategory,
  CourseStatus,
  CourseSummary,
} from "@modules/catalog/services/courses.service";
import { AccessibilityNeed } from "@modules/people/services/students.service";
import { Enrollment } from "../entities/enrollment.entity";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import { StudentEnrollmentItemResponseDto } from "../dto/student-enrollment-item.response.dto";
import {
  StudentEnrollmentRow,
  summarizeStudentEnrollments,
  toClassEnrollmentItem,
  toEnrollmentResponse,
  toStudentEnrollmentItem,
} from "../services/enrollment-response.mapper";

const ENROLLMENT_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";
const ENROLLED_AT = new Date("2026-03-03T13:00:00.000Z");

const BASIC: CourseSummary = {
  id: "01999a3e-7c1b-7000-8000-0000000000b1",
  name: "Informática Básica",
  category: CourseCategory.BASIC,
  status: CourseStatus.ACTIVE,
};
const SMARTPHONES: CourseSummary = {
  id: "01999a3e-7c1b-7000-8000-0000000000b2",
  name: "Smartphones",
  category: CourseCategory.INTERMEDIATE,
  status: CourseStatus.ACTIVE,
};
const ACCESS: CourseSummary = {
  id: "01999a3e-7c1b-7000-8000-0000000000b3",
  name: "Acesso a serviços",
  category: CourseCategory.BASIC,
  status: CourseStatus.ARCHIVED,
};
function historyRow(
  id: string,
  status: EnrollmentStatus,
  course: CourseSummary,
  statusChangedAt: string,
  enrolledAt: string,
): StudentEnrollmentRow {
  return {
    id,
    status,
    enrolledAt: new Date(enrolledAt),
    statusChangedAt,
    courseId: course.id,
    classId: `class-of-${id}`,
    classCode: "INFO-A",
    className: null,
    editionId: "01999a3e-7c1b-7000-8000-0000000000e1",
    editionName: "2025.2",
  };
}

/** One item of the history, with the course resolved, as `EnrollmentListingService` builds it. */
function historyItem(
  id: string,
  status: EnrollmentStatus,
  course: CourseSummary,
  statusChangedAt: string,
  enrolledAt: string,
): StudentEnrollmentItemResponseDto {
  return toStudentEnrollmentItem(
    historyRow(id, status, course, statusChangedAt, enrolledAt),
    course,
    null,
  );
}

function buildEnrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return Object.assign(new Enrollment(), {
    id: ENROLLMENT_ID,
    classId: CLASS_ID,
    studentId: STUDENT_ID,
    status: EnrollmentStatus.DROPPED,
    enrolledAt: ENROLLED_AT,
    statusChangedAt: "2026-04-10",
    statusReason: "Mudou de cidade.",
    createdById: "01999a3e-0000-7000-8000-0000000000aa",
    createdAt: ENROLLED_AT,
    updatedAt: ENROLLED_AT,
    deletedAt: null,
    ...overrides,
  });
}

describe("enrollment response mapper", () => {
  it("projects the enrollment response without the internal columns", () => {
    // A field the caller happens to carry (the summary of people) never leaks into the answer.
    const student = { id: STUDENT_ID, name: "Maria Silva", archivedAt: null };
    const response = toEnrollmentResponse(buildEnrollment(), student);

    expect(response).toEqual({
      id: ENROLLMENT_ID,
      classId: CLASS_ID,
      student: { id: STUDENT_ID, name: "Maria Silva" },
      status: EnrollmentStatus.DROPPED,
      enrolledAt: ENROLLED_AT,
      statusChangedAt: "2026-04-10",
      statusReason: "Mudou de cidade.",
    });
  });

  it("summarizes completedCourses one per course with the latest statusChangedAt, in completedAt and name order", () => {
    const summary = summarizeStudentEnrollments([
      historyItem(
        "e1",
        EnrollmentStatus.COMPLETED,
        BASIC,
        "2025-06-30",
        "2025-03-01T13:00:00.000Z",
      ),
      // Básica completed again later: the latest date is the one that counts.
      historyItem(
        "e2",
        EnrollmentStatus.COMPLETED,
        BASIC,
        "2025-12-12",
        "2025-08-04T13:00:00.000Z",
      ),
      historyItem(
        "e3",
        EnrollmentStatus.COMPLETED,
        SMARTPHONES,
        "2025-12-12",
        "2025-08-05T13:00:00.000Z",
      ),
      historyItem(
        "e4",
        EnrollmentStatus.COMPLETED,
        ACCESS,
        "2025-07-01",
        "2025-03-02T13:00:00.000Z",
      ),
      historyItem(
        "e5",
        EnrollmentStatus.DROPPED,
        SMARTPHONES,
        "2026-04-01",
        "2026-03-03T13:00:00.000Z",
      ),
    ]);

    // Same day: by name. An archived course still counts as completed.
    expect(summary.completedCourses).toEqual([
      { courseId: ACCESS.id, name: "Acesso a serviços", completedAt: "2025-07-01" },
      { courseId: BASIC.id, name: "Informática Básica", completedAt: "2025-12-12" },
      { courseId: SMARTPHONES.id, name: "Smartphones", completedAt: "2025-12-12" },
    ]);
  });

  it("counts activeClasses and answers firstEnrollmentAt as the earliest enrolledAt, or null without enrollments", () => {
    const summary = summarizeStudentEnrollments([
      historyItem(
        "e1",
        EnrollmentStatus.ACTIVE,
        SMARTPHONES,
        "2026-03-03",
        "2026-03-03T13:00:00.000Z",
      ),
      historyItem("e2", EnrollmentStatus.ACTIVE, ACCESS, "2026-03-04", "2026-03-04T13:00:00.000Z"),
      historyItem(
        "e3",
        EnrollmentStatus.COMPLETED,
        BASIC,
        "2025-12-12",
        "2025-08-04T13:00:00.000Z",
      ),
      historyItem("e4", EnrollmentStatus.DROPPED, BASIC, "2025-04-01", "2025-03-01T13:00:00.000Z"),
    ]);

    expect(summary.activeClasses).toBe(2);
    expect(summary.firstEnrollmentAt).toEqual(new Date("2025-03-01T13:00:00.000Z"));

    expect(summarizeStudentEnrollments([])).toEqual({
      activeClasses: 0,
      completedCourses: [],
      firstEnrollmentAt: null,
    });
  });

  it("projects the history item with its class, its edition and the course of the class", () => {
    expect(
      toStudentEnrollmentItem(
        historyRow(
          "e1",
          EnrollmentStatus.COMPLETED,
          ACCESS,
          "2025-07-01",
          "2025-03-02T13:00:00.000Z",
        ),
        ACCESS,
        null,
      ),
    ).toEqual({
      id: "e1",
      status: EnrollmentStatus.COMPLETED,
      enrolledAt: new Date("2025-03-02T13:00:00.000Z"),
      statusChangedAt: "2025-07-01",
      class: {
        id: "class-of-e1",
        code: "INFO-A",
        name: null,
        edition: { id: "01999a3e-7c1b-7000-8000-0000000000e1", name: "2025.2" },
      },
      course: {
        id: ACCESS.id,
        name: "Acesso a serviços",
        category: CourseCategory.BASIC,
        status: CourseStatus.ARCHIVED,
      },
      attendanceRate: null,
    });
  });

  it("answers the attendanceRate it is given in the history item", () => {
    const row = historyRow(
      "e1",
      EnrollmentStatus.ACTIVE,
      BASIC,
      "2026-03-03",
      ENROLLED_AT.toISOString(),
    );

    expect(toStudentEnrollmentItem(row, BASIC, 0.67).attendanceRate).toBe(0.67);
    expect(toStudentEnrollmentItem(row, BASIC, 0).attendanceRate).toBe(0);
    expect(toStudentEnrollmentItem(row, BASIC, null).attendanceRate).toBeNull();
  });

  it("answers the attendanceRate it is given, and phone and accessibilityNeed only with canSeeStudentContact", () => {
    const row = {
      id: ENROLLMENT_ID,
      studentId: STUDENT_ID,
      status: EnrollmentStatus.ACTIVE,
      enrolledAt: ENROLLED_AT,
      statusChangedAt: "2026-03-03",
    };
    const student = {
      id: STUDENT_ID,
      name: "Maria Silva",
      birthDate: "1958-03-03",
      age: 68,
      phone: "43999990000",
      email: "maria.silva@example.com",
      accessibilityNeed: AccessibilityNeed.VISUAL,
      createdAt: ENROLLED_AT,
    };

    // toEqual: the birth date, the e-mail and createdAt of the student never reach the list of a class.
    expect(
      toClassEnrollmentItem(row, student, { canSeeStudentContact: true, attendanceRate: 0.75 }),
    ).toEqual({
      id: ENROLLMENT_ID,
      student: {
        id: STUDENT_ID,
        name: "Maria Silva",
        age: 68,
        phone: "43999990000",
        accessibilityNeed: AccessibilityNeed.VISUAL,
      },
      status: EnrollmentStatus.ACTIVE,
      enrolledAt: ENROLLED_AT,
      statusChangedAt: "2026-03-03",
      attendanceRate: 0.75,
    });

    const hidden = toClassEnrollmentItem(row, student, {
      canSeeStudentContact: false,
      attendanceRate: null,
    });
    expect(hidden.student.phone).toBeNull();
    expect(hidden.student.accessibilityNeed).toBeNull();
    expect(hidden.attendanceRate).toBeNull();
  });
});
