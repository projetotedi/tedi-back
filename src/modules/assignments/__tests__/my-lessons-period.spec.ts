import { HttpException } from "@nestjs/common";
import { resolveMyLessonsPeriod } from "../services/my-lessons-period";

const TODAY = "2026-03-09";

function failureOf(run: () => unknown): HttpException {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error("Expected an HttpException");
}

describe("resolveMyLessonsPeriod", () => {
  it("defaults to today and 27 days after it: four weeks, both ends counted", () => {
    expect(resolveMyLessonsPeriod({}, TODAY)).toEqual({ from: "2026-03-09", to: "2026-04-05" });
  });

  it("takes from alone and ends 27 days after it", () => {
    expect(resolveMyLessonsPeriod({ from: "2026-03-01" }, TODAY)).toEqual({
      from: "2026-03-01",
      to: "2026-03-28",
    });
  });

  it("takes to alone and starts today", () => {
    expect(resolveMyLessonsPeriod({ to: "2026-03-20" }, TODAY)).toEqual({
      from: TODAY,
      to: "2026-03-20",
    });
  });

  it("takes both, one day included (from equal to to)", () => {
    expect(resolveMyLessonsPeriod({ from: "2026-03-10", to: "2026-03-10" }, TODAY)).toEqual({
      from: "2026-03-10",
      to: "2026-03-10",
    });
    expect(resolveMyLessonsPeriod({ from: "2026-02-01", to: "2026-02-20" }, TODAY)).toEqual({
      from: "2026-02-01",
      to: "2026-02-20",
    });
  });

  it("throws 400 INVALID_DATE_RANGE with details.field to when to is before from, and when to alone is before today", () => {
    for (const query of [{ from: "2026-03-10", to: "2026-03-09" }, { to: "2026-03-08" }]) {
      const failure = failureOf(() => resolveMyLessonsPeriod(query, TODAY));

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toEqual({
        error: "INVALID_DATE_RANGE",
        message: "to must be on or after from.",
        details: [{ field: "to", message: "to must be on or after from" }],
      });
    }
  });

  it("throws 400 DATE_RANGE_TOO_LONG over 42 days counting both ends, and accepts exactly 42", () => {
    expect(resolveMyLessonsPeriod({ from: "2026-03-01", to: "2026-04-11" }, TODAY)).toEqual({
      from: "2026-03-01",
      to: "2026-04-11",
    });

    const failure = failureOf(() =>
      resolveMyLessonsPeriod({ from: "2026-03-01", to: "2026-04-12" }, TODAY),
    );

    expect(failure.getStatus()).toBe(400);
    expect(failure.getResponse()).toEqual({
      error: "DATE_RANGE_TOO_LONG",
      message: "The period cannot be longer than 42 days, counting both ends.",
      details: [{ field: "to", message: "to must be at most 41 days after from" }],
    });
  });

  it("crosses months and years", () => {
    expect(resolveMyLessonsPeriod({}, "2026-12-20")).toEqual({
      from: "2026-12-20",
      to: "2027-01-16",
    });
  });
});
