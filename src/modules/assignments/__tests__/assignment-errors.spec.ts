import { HttpException } from "@nestjs/common";
import { alreadyApplied, lessonInPast, roleFull } from "../services/assignment-errors";

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
  ])("%s answers its status and its exact body", (_name, build, status, body) => {
    const error = build();

    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toEqual(body);
  });
});
