import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { LESSON_CALENDAR_MAX_DAYS } from "../dto/lesson-limits";
import { assertDateRange } from "../services/lesson-date-range";

function failureOf(work: () => void): HttpException {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error("Expected the call to throw an HttpException");
}

describe("assertDateRange", () => {
  it("accepts a period of a single day, from equal to to, with and without a limit", () => {
    expect(() => assertDateRange("2026-03-10", "2026-03-10")).not.toThrow();
    expect(() => assertDateRange("2026-03-10", "2026-03-10", 1)).not.toThrow();
    expect(() =>
      assertDateRange("2026-03-10", "2026-03-10", LESSON_CALENDAR_MAX_DAYS),
    ).not.toThrow();
  });

  it("accepts 42 days, counting both ends: the month grid of six weeks", () => {
    expect(() =>
      assertDateRange("2026-03-01", "2026-04-11", LESSON_CALENDAR_MAX_DAYS),
    ).not.toThrow();
  });

  it("answers 400 DATE_RANGE_TOO_LONG for 43 days", () => {
    const failure = failureOf(() =>
      assertDateRange("2026-03-01", "2026-04-12", LESSON_CALENDAR_MAX_DAYS),
    );

    expect(failure.getStatus()).toBe(400);
    expect(failure.getResponse()).toMatchObject({ error: "DATE_RANGE_TOO_LONG" });
  });

  it("counts the days of the real calendar: a leap February has 29", () => {
    // 29 days of February 2024 plus 13 of March make 42.
    expect(() => assertDateRange("2024-02-01", "2024-03-13", 42)).not.toThrow();
    expect(
      failureOf(() => assertDateRange("2024-02-01", "2024-03-14", 42)).getResponse(),
    ).toMatchObject({ error: "DATE_RANGE_TOO_LONG" });
    // In a common year February has 28 days, so the 42nd day is March 14, one day later.
    expect(() => assertDateRange("2026-02-01", "2026-03-14", 42)).not.toThrow();
    expect(
      failureOf(() => assertDateRange("2026-02-01", "2026-03-15", 42)).getResponse(),
    ).toMatchObject({ error: "DATE_RANGE_TOO_LONG" });
  });

  it("counts a period that crosses the end of the year", () => {
    expect(() => assertDateRange("2025-12-20", "2026-01-30", 42)).not.toThrow();
    expect(
      failureOf(() => assertDateRange("2025-12-20", "2026-01-31", 42)).getResponse(),
    ).toMatchObject({ error: "DATE_RANGE_TOO_LONG" });
  });

  it("answers 400 INVALID_DATE_RANGE when to is before from, with and without a limit", () => {
    for (const maxDays of [undefined, LESSON_CALENDAR_MAX_DAYS]) {
      const failure = failureOf(() => assertDateRange("2026-03-11", "2026-03-10", maxDays));

      expect(failure.getStatus()).toBe(400);
      expect(failure.getResponse()).toMatchObject({ error: "INVALID_DATE_RANGE" });
    }
  });

  it("answers INVALID_DATE_RANGE, and not DATE_RANGE_TOO_LONG, for a long period upside down", () => {
    const failure = failureOf(() => assertDateRange("2026-12-31", "2026-01-01", 42));

    expect(failure.getResponse()).toMatchObject({ error: "INVALID_DATE_RANGE" });
  });

  it("does not limit the length without a limit: the list is paginated", () => {
    expect(() => assertDateRange("2020-01-01", "2026-12-31")).not.toThrow();
    expect(() => assertDateRange("0001-01-01", "9999-12-31")).not.toThrow();
  });

  it("checks nothing when only one of the two days is there, or neither", () => {
    expect(() => assertDateRange(undefined, undefined)).not.toThrow();
    expect(() => assertDateRange("2026-03-10", undefined)).not.toThrow();
    expect(() => assertDateRange(undefined, "2026-03-10")).not.toThrow();
    expect(() => assertDateRange("2026-03-10", undefined, 1)).not.toThrow();
    expect(() => assertDateRange(undefined, "2026-03-10", 1)).not.toThrow();
  });

  it("takes the limit it is given", () => {
    expect(() => assertDateRange("2026-03-01", "2026-03-07", 7)).not.toThrow();
    expect(
      failureOf(() => assertDateRange("2026-03-01", "2026-03-08", 7)).getResponse(),
    ).toMatchObject({ error: "DATE_RANGE_TOO_LONG" });
  });
});
