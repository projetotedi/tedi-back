import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import {
  invalidTimeRange,
  isValidTimeRange,
  isWithinClassPeriod,
  lessonOutsideClassPeriod,
} from "../services/lesson-schedule";

const PERIOD = { startDate: "2026-03-03", endDate: "2026-06-27" };

describe("isWithinClassPeriod", () => {
  it("accepts the first and last day and rejects the day outside", () => {
    expect(isWithinClassPeriod("2026-03-03", PERIOD)).toBe(true);
    expect(isWithinClassPeriod("2026-06-27", PERIOD)).toBe(true);

    expect(isWithinClassPeriod("2026-03-02", PERIOD)).toBe(false);
    expect(isWithinClassPeriod("2026-06-28", PERIOD)).toBe(false);
  });

  it("accepts any day in between", () => {
    expect(isWithinClassPeriod("2026-03-04", PERIOD)).toBe(true);
    expect(isWithinClassPeriod("2026-05-15", PERIOD)).toBe(true);
    expect(isWithinClassPeriod("2026-06-26", PERIOD)).toBe(true);
  });

  it("rejects a day far before or after the period", () => {
    expect(isWithinClassPeriod("2025-03-10", PERIOD)).toBe(false);
    expect(isWithinClassPeriod("2027-03-10", PERIOD)).toBe(false);
    expect(isWithinClassPeriod("0001-01-01", PERIOD)).toBe(false);
  });

  it("takes a class of a single day: only that day is inside", () => {
    const oneDay = { startDate: "2026-03-03", endDate: "2026-03-03" };

    expect(isWithinClassPeriod("2026-03-03", oneDay)).toBe(true);
    expect(isWithinClassPeriod("2026-03-02", oneDay)).toBe(false);
    expect(isWithinClassPeriod("2026-03-04", oneDay)).toBe(false);
  });

  it("compares the whole date, across the turn of the year and the months", () => {
    const winter = { startDate: "2026-12-01", endDate: "2027-02-15" };

    expect(isWithinClassPeriod("2026-12-31", winter)).toBe(true);
    expect(isWithinClassPeriod("2027-01-01", winter)).toBe(true);
    expect(isWithinClassPeriod("2027-02-16", winter)).toBe(false);
    expect(isWithinClassPeriod("2026-11-30", winter)).toBe(false);

    // September before October: months and days are zero-padded.
    const autumn = { startDate: "2026-09-30", endDate: "2026-10-01" };
    expect(isWithinClassPeriod("2026-09-30", autumn)).toBe(true);
    expect(isWithinClassPeriod("2026-10-01", autumn)).toBe(true);
    expect(isWithinClassPeriod("2026-09-29", autumn)).toBe(false);
    expect(isWithinClassPeriod("2026-10-02", autumn)).toBe(false);
  });
});

describe("isValidTimeRange", () => {
  it("accepts an end after the start", () => {
    expect(isValidTimeRange("14:00", "15:30")).toBe(true);
    expect(isValidTimeRange("14:00", "14:01")).toBe(true);
    expect(isValidTimeRange("00:00", "23:59")).toBe(true);
  });

  it("rejects equal and inverted times", () => {
    expect(isValidTimeRange("14:00", "14:00")).toBe(false);
    expect(isValidTimeRange("15:30", "14:00")).toBe(false);
    expect(isValidTimeRange("14:01", "14:00")).toBe(false);
    expect(isValidTimeRange("23:59", "00:00")).toBe(false);
  });

  it("compares the hour before the minute", () => {
    expect(isValidTimeRange("09:59", "10:00")).toBe(true);
    expect(isValidTimeRange("10:00", "09:59")).toBe(false);
  });
});

describe("lessonOutsideClassPeriod", () => {
  it("is a 400 LESSON_OUTSIDE_CLASS_PERIOD that points at the date", () => {
    const failure = lessonOutsideClassPeriod();

    expect(failure).toBeInstanceOf(HttpException);
    expect(failure.getStatus()).toBe(400);
    expect(failure.getResponse()).toEqual({
      error: "LESSON_OUTSIDE_CLASS_PERIOD",
      message: "The date of the lesson must fall inside the period of the class.",
      details: [
        { field: "date", message: "date must fall inside the period of the class, ends included" },
      ],
    });
  });
});

describe("invalidTimeRange", () => {
  it("is a 400 INVALID_TIME_RANGE that points at the end time", () => {
    const failure = invalidTimeRange();

    expect(failure).toBeInstanceOf(HttpException);
    expect(failure.getStatus()).toBe(400);
    expect(failure.getResponse()).toEqual({
      error: "INVALID_TIME_RANGE",
      message: "endTime must be after startTime.",
      details: [{ field: "endTime", message: "endTime must be after startTime" }],
    });
  });
});
