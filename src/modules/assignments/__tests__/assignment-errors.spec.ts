import { HttpException } from "@nestjs/common";
import {
  alreadyApplied,
  applicationNotFound,
  applicationNotPending,
  dateRangeTooLong,
  invalidDateRange,
  lessonInPast,
  roleFull,
} from "../services/assignment-errors";

describe("the errors of the applications (GUS-160)", () => {
  it.each<[string, () => HttpException, number, Record<string, unknown>]>([
    [
      "alreadyApplied",
      alreadyApplied,
      409,
      {
        error: "ALREADY_APPLIED",
        message: "The member already has an assignment or an application in this lesson.",
      },
    ],
    [
      "roleFull",
      roleFull,
      409,
      { error: "ROLE_FULL", message: "The lesson has no open place for this role." },
    ],
    [
      "lessonInPast",
      lessonInPast,
      409,
      {
        error: "LESSON_IN_PAST",
        message: "Applications are only taken for lessons from today on.",
      },
    ],
    [
      "applicationNotFound",
      applicationNotFound,
      404,
      { error: "APPLICATION_NOT_FOUND", message: "Application not found." },
    ],
    [
      "applicationNotPending",
      applicationNotPending,
      409,
      {
        error: "APPLICATION_NOT_PENDING",
        message: "Only a pending application can be approved or declined.",
      },
    ],
    [
      "invalidDateRange",
      invalidDateRange,
      400,
      {
        error: "INVALID_DATE_RANGE",
        message: "to must be on or after from.",
        details: [{ field: "to", message: "to must be on or after from" }],
      },
    ],
    [
      "dateRangeTooLong(42)",
      () => dateRangeTooLong(42),
      400,
      {
        error: "DATE_RANGE_TOO_LONG",
        message: "The period cannot be longer than 42 days, counting both ends.",
        details: [{ field: "to", message: "to must be at most 41 days after from" }],
      },
    ],
  ])("%s answers its status and its exact body", (_name, build, status, body) => {
    const error = build();

    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toEqual(body);
  });
});
