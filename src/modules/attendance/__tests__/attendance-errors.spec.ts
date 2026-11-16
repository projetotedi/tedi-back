import { HttpException } from "@nestjs/common";
import {
  assignmentNotConfirmed,
  attendanceCorrectionForbidden,
  duplicateAssignment,
  lessonCancelled,
  lessonInFuture,
  lessonNotFound,
  memberNotFound,
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
});
