import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import {
  classArchived,
  classNotFoundInBody,
  lessonCancelled,
  lessonNotFound,
  lessonPlanArchivedInBody,
  lessonPlanNotFoundInBody,
  lessonPlanNotInCourseSequence,
} from "../services/lesson-errors";

describe("lesson errors", () => {
  it.each([
    { name: "lessonNotFound", build: lessonNotFound, status: 404, code: "LESSON_NOT_FOUND" },
    { name: "lessonCancelled", build: lessonCancelled, status: 409, code: "LESSON_CANCELLED" },
    {
      name: "classNotFoundInBody",
      build: classNotFoundInBody,
      status: 400,
      code: "CLASS_NOT_FOUND",
    },
    { name: "classArchived", build: classArchived, status: 409, code: "CLASS_ARCHIVED" },
    {
      name: "lessonPlanNotFoundInBody",
      build: lessonPlanNotFoundInBody,
      status: 400,
      code: "LESSON_PLAN_NOT_FOUND",
    },
    {
      name: "lessonPlanArchivedInBody",
      build: lessonPlanArchivedInBody,
      status: 400,
      code: "LESSON_PLAN_ARCHIVED",
    },
    {
      name: "lessonPlanNotInCourseSequence",
      build: lessonPlanNotInCourseSequence,
      status: 400,
      code: "LESSON_PLAN_NOT_IN_COURSE_SEQUENCE",
    },
  ])("$name is an HttpException $status with the stable code $code", ({ build, status, code }) => {
    const failure = build();

    expect(failure).toBeInstanceOf(HttpException);
    expect(failure.getStatus()).toBe(status);
    const response = failure.getResponse() as { error: string; message: string };
    expect(response.error).toBe(code);
    // The message is an English literal sentence: the front translates by the code.
    expect(response.message).toMatch(/^[A-Z][A-Za-z -]+\.$/);
  });

  it("builds a new exception each time, so a caller cannot change another one", () => {
    expect(lessonNotFound()).not.toBe(lessonNotFound());
  });

  it("anchors the errors about an id of the body on the field of the body", () => {
    const fieldOf = (failure: HttpException): string[] =>
      (failure.getResponse() as { details?: Array<{ field: string }> }).details?.map(
        (detail) => detail.field,
      ) ?? [];

    expect(fieldOf(classNotFoundInBody())).toEqual(["classId"]);
    expect(fieldOf(lessonPlanNotFoundInBody())).toEqual(["lessonPlanId"]);
    expect(fieldOf(lessonPlanArchivedInBody())).toEqual(["lessonPlanId"]);
    expect(fieldOf(lessonPlanNotInCourseSequence())).toEqual(["sequenceOrder"]);
  });

  it("carries no field for the errors about the lesson or the class of the route", () => {
    for (const failure of [lessonNotFound(), lessonCancelled(), classArchived()]) {
      expect(failure.getResponse()).not.toHaveProperty("details");
    }
  });

  it("says the same as the classes module for an archived class", () => {
    expect(classArchived().getResponse()).toEqual({
      error: "CLASS_ARCHIVED",
      message: "Archived classes are read-only.",
    });
  });
});
