import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import {
  classArchived,
  classNotFoundInBody,
  classNotFoundInPath,
  courseWithoutSequence,
  lessonCancelled,
  lessonNotFound,
  lessonPlanArchivedInBody,
  lessonPlanNotFoundInBody,
  lessonPlanNotInCourseSequence,
  lessonsAlreadyGenerated,
  lessonsOutsideClassPeriod,
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
    {
      name: "classNotFoundInPath",
      build: classNotFoundInPath,
      status: 404,
      code: "CLASS_NOT_FOUND",
    },
    {
      name: "lessonsAlreadyGenerated",
      build: lessonsAlreadyGenerated,
      status: 409,
      code: "LESSONS_ALREADY_GENERATED",
    },
    {
      name: "courseWithoutSequence",
      build: courseWithoutSequence,
      status: 409,
      code: "COURSE_WITHOUT_SEQUENCE",
    },
    {
      name: "lessonsOutsideClassPeriod",
      build: () => lessonsOutsideClassPeriod([{ sequenceOrder: 4, date: "2026-04-28" }]),
      status: 409,
      code: "LESSONS_OUTSIDE_CLASS_PERIOD",
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
    for (const failure of [
      lessonNotFound(),
      lessonCancelled(),
      classArchived(),
      classNotFoundInPath(),
      lessonsAlreadyGenerated(),
      courseWithoutSequence(),
    ]) {
      expect(failure.getResponse()).not.toHaveProperty("details");
    }
  });

  describe("the errors of the generation of the lessons of a class (GUS-154)", () => {
    it("classNotFoundInPath is the 404 of the class of the URL, and says what the classes module says", () => {
      const failure = classNotFoundInPath();

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "CLASS_NOT_FOUND",
        message: "Class not found.",
      });
      // Not the 400 of the body: here the id is in the URL, and carries no field.
      expect(failure.getResponse()).not.toEqual(classNotFoundInBody().getResponse());
    });

    it("lessonsAlreadyGenerated and courseWithoutSequence are 409 with a message in English", () => {
      expect(lessonsAlreadyGenerated().getStatus()).toBe(409);
      expect(lessonsAlreadyGenerated().getResponse()).toEqual({
        error: "LESSONS_ALREADY_GENERATED",
        message: "The lessons of this class were already generated from the course sequence.",
      });
      expect(courseWithoutSequence().getStatus()).toBe(409);
      expect(courseWithoutSequence().getResponse()).toEqual({
        error: "COURSE_WITHOUT_SEQUENCE",
        message: "The course of this class has no active lesson plan in its sequence.",
      });
    });

    it("lessonsOutsideClassPeriod is a 409, anchored on firstDate, naming the positions that fall outside", () => {
      const failure = lessonsOutsideClassPeriod([
        { sequenceOrder: 3, date: "2026-04-21" },
        { sequenceOrder: 4, date: "2026-04-28" },
      ]);

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "LESSONS_OUTSIDE_CLASS_PERIOD",
        message: "Some lessons would fall outside the period of the class.",
        details: [
          { field: "firstDate", message: "lessons 3, 4 fall outside the period of the class" },
        ],
      });
    });

    it("lessonsOutsideClassPeriod is not the 400 of a single lesson, which has another code", () => {
      const failure = lessonsOutsideClassPeriod([{ sequenceOrder: 1, date: "2026-03-01" }]);

      expect((failure.getResponse() as { error: string }).error).toBe(
        "LESSONS_OUTSIDE_CLASS_PERIOD",
      );
      expect(failure.getStatus()).not.toBe(400);
    });
  });

  it("says the same as the classes module for an archived class", () => {
    expect(classArchived().getResponse()).toEqual({
      error: "CLASS_ARCHIVED",
      message: "Archived classes are read-only.",
    });
  });
});
