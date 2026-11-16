import { HttpException } from "@nestjs/common";
import {
  alreadyEnrolled,
  classClosed,
  classFull,
  duplicateStudent,
  effectiveDateBeforeEnrollment,
  effectiveDateInFuture,
  enrollmentNotFound,
  enrollmentNotRemovable,
  studentArchived,
  studentNotFoundInBody,
} from "../services/enrollment-errors";

function shape(error: HttpException): { status: number; body: unknown } {
  return { status: error.getStatus(), body: error.getResponse() };
}

describe("enrollment errors", () => {
  it("builds CLASS_FULL with the seats left as a decimal string in details[0].message and in the message", () => {
    expect(shape(classFull(2, 3, "studentIds"))).toEqual({
      status: 409,
      body: {
        error: "CLASS_FULL",
        message: "The class has 2 seats left and 3 students were asked.",
        details: [{ field: "studentIds", message: "2" }],
      },
    });
    expect(shape(classFull(0, 1, "status")).body).toMatchObject({
      details: [{ field: "status", message: "0" }],
    });
  });

  it("builds DUPLICATE_STUDENT, STUDENT_NOT_FOUND and STUDENT_ARCHIVED with one detail per position", () => {
    expect(shape(duplicateStudent(["studentIds.2", "studentIds.3"]))).toEqual({
      status: 400,
      body: {
        error: "DUPLICATE_STUDENT",
        message: "The same student appears more than once.",
        details: [
          { field: "studentIds.2", message: "student appears more than once" },
          { field: "studentIds.3", message: "student appears more than once" },
        ],
      },
    });
    expect(shape(studentNotFoundInBody(["studentIds.0"]))).toEqual({
      status: 400,
      body: {
        error: "STUDENT_NOT_FOUND",
        message: "One or more students were not found.",
        details: [{ field: "studentIds.0", message: "student not found" }],
      },
    });
    expect(shape(studentArchived(["studentIds.1"]))).toEqual({
      status: 409,
      body: {
        error: "STUDENT_ARCHIVED",
        message: "Archived students cannot be enrolled.",
        details: [{ field: "studentIds.1", message: "student is archived" }],
      },
    });
    // Without positions (the reactivation of one enrollment) there are no details at all.
    expect(shape(studentArchived()).body).toEqual({
      error: "STUDENT_ARCHIVED",
      message: "Archived students cannot be enrolled.",
    });
  });

  it("builds EFFECTIVE_DATE_IN_FUTURE and EFFECTIVE_DATE_BEFORE_ENROLLMENT pointing to effectiveDate", () => {
    expect(shape(effectiveDateInFuture())).toEqual({
      status: 400,
      body: {
        error: "EFFECTIVE_DATE_IN_FUTURE",
        message: "The effective date cannot be after today.",
        details: [{ field: "effectiveDate", message: "must not be after today" }],
      },
    });
    expect(shape(effectiveDateBeforeEnrollment())).toEqual({
      status: 400,
      body: {
        error: "EFFECTIVE_DATE_BEFORE_ENROLLMENT",
        message: "The effective date cannot be before the day of the enrollment.",
        details: [
          { field: "effectiveDate", message: "must not be before the day of the enrollment" },
        ],
      },
    });
  });

  it("builds the errors without positions with their status and code", () => {
    expect(
      [enrollmentNotFound(), classClosed(), alreadyEnrolled(), enrollmentNotRemovable()].map(
        (error) => [error.getStatus(), (error.getResponse() as { error: string }).error],
      ),
    ).toEqual([
      [404, "ENROLLMENT_NOT_FOUND"],
      [409, "CLASS_CLOSED"],
      [409, "ALREADY_ENROLLED"],
      [409, "ENROLLMENT_NOT_REMOVABLE"],
    ]);
  });
});
