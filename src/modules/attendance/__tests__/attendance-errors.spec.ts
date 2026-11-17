import { HttpException } from "@nestjs/common";
import {
  assignmentNotConfirmed,
  attendanceCorrectionForbidden,
  classArchived,
  duplicateAssignment,
  duplicateEnrollment,
  enrollmentNotInRollCall,
  lessonCancelled,
  lessonInFuture,
  lessonNotFound,
  memberNotFound,
  studentAttendanceAlreadySigned,
  studentAttendanceNotAbsent,
  studentAttendanceNotFound,
  studentAttendanceStatusUnchanged,
} from "../services/attendance-errors";

function shapeOf(error: HttpException): { status: number; body: unknown } {
  return { status: error.getStatus(), body: error.getResponse() };
}

describe("attendance errors", () => {
  it("answers each code with its status, its message and, for the errors of the body, the positions in details", () => {
    expect(shapeOf(lessonNotFound())).toEqual({
      status: 404,
      body: { error: "LESSON_NOT_FOUND", message: "Lesson not found." },
    });
    expect(shapeOf(lessonCancelled())).toEqual({
      status: 409,
      body: { error: "LESSON_CANCELLED", message: "Cancelled lessons do not take attendance." },
    });
    expect(shapeOf(lessonInFuture())).toEqual({
      status: 409,
      body: {
        error: "LESSON_IN_FUTURE",
        message: "Attendance is signed for lessons of today or before.",
      },
    });
    expect(shapeOf(memberNotFound())).toEqual({
      status: 404,
      body: { error: "MEMBER_NOT_FOUND", message: "Member not found." },
    });
    expect(shapeOf(attendanceCorrectionForbidden())).toEqual({
      status: 403,
      body: {
        error: "FORBIDDEN",
        message: "Only coordination and directors correct a signed attendance.",
      },
    });

    expect(shapeOf(duplicateAssignment(["entries.1.assignmentId"]))).toEqual({
      status: 400,
      body: {
        error: "DUPLICATE_ASSIGNMENT",
        message: "The same assignment appears more than once.",
        details: [
          { field: "entries.1.assignmentId", message: "assignment appears more than once" },
        ],
      },
    });
    expect(
      shapeOf(assignmentNotConfirmed(["entries.0.assignmentId", "entries.2.assignmentId"])),
    ).toEqual({
      status: 400,
      body: {
        error: "ASSIGNMENT_NOT_CONFIRMED",
        message: "One or more assignments are not confirmed in this lesson.",
        details: [
          {
            field: "entries.0.assignmentId",
            message: "assignment is not confirmed in this lesson",
          },
          {
            field: "entries.2.assignmentId",
            message: "assignment is not confirmed in this lesson",
          },
        ],
      },
    });
    // Without positions there is no `details` at all.
    expect(duplicateAssignment([]).getResponse()).not.toHaveProperty("details");
    expect(assignmentNotConfirmed([]).getResponse()).not.toHaveProperty("details");
  });

  it("builds DUPLICATE_ENROLLMENT, ENROLLMENT_NOT_IN_ROLL_CALL and STUDENT_ATTENDANCE_ALREADY_SIGNED with one detail per position", () => {
    expect(shapeOf(duplicateEnrollment(["entries.2.enrollmentId"]))).toEqual({
      status: 400,
      body: {
        error: "DUPLICATE_ENROLLMENT",
        message: "The same enrollment appears more than once.",
        details: [
          { field: "entries.2.enrollmentId", message: "enrollment appears more than once" },
        ],
      },
    });
    expect(
      shapeOf(enrollmentNotInRollCall(["entries.0.enrollmentId", "entries.3.enrollmentId"])),
    ).toEqual({
      status: 400,
      body: {
        error: "ENROLLMENT_NOT_IN_ROLL_CALL",
        message: "One or more enrollments are not in the roll call of this lesson.",
        details: [
          {
            field: "entries.0.enrollmentId",
            message: "enrollment is not in the roll call of this lesson",
          },
          {
            field: "entries.3.enrollmentId",
            message: "enrollment is not in the roll call of this lesson",
          },
        ],
      },
    });
    expect(shapeOf(studentAttendanceAlreadySigned(["entries.1.enrollmentId"]))).toEqual({
      status: 409,
      body: {
        error: "STUDENT_ATTENDANCE_ALREADY_SIGNED",
        message:
          "One or more attendances are already signed with another status; use the correction.",
        details: [
          {
            field: "entries.1.enrollmentId",
            message: "attendance already signed with another status",
          },
        ],
      },
    });
    for (const error of [
      duplicateEnrollment([]),
      enrollmentNotInRollCall([]),
      studentAttendanceAlreadySigned([]),
    ]) {
      expect(error.getResponse()).not.toHaveProperty("details");
    }
  });

  it("builds STUDENT_ATTENDANCE_NOT_FOUND 404, STUDENT_ATTENDANCE_NOT_ABSENT 409, STUDENT_ATTENDANCE_STATUS_UNCHANGED 400 on status and CLASS_ARCHIVED 409", () => {
    expect(shapeOf(studentAttendanceNotFound())).toEqual({
      status: 404,
      body: { error: "STUDENT_ATTENDANCE_NOT_FOUND", message: "Student attendance not found." },
    });
    expect(shapeOf(studentAttendanceNotAbsent())).toEqual({
      status: 409,
      body: {
        error: "STUDENT_ATTENDANCE_NOT_ABSENT",
        message: "Only an absence can be justified.",
      },
    });
    expect(shapeOf(studentAttendanceStatusUnchanged())).toEqual({
      status: 400,
      body: {
        error: "STUDENT_ATTENDANCE_STATUS_UNCHANGED",
        message: "The attendance already has this status.",
        details: [{ field: "status", message: "must differ from the current status" }],
      },
    });
    expect(shapeOf(classArchived())).toEqual({
      status: 409,
      body: { error: "CLASS_ARCHIVED", message: "Archived classes are read-only." },
    });
  });
});
