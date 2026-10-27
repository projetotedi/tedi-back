import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { invalidPeriod, isValidPeriod } from "../services/class-period";

describe("isValidPeriod", () => {
  it("is false when the class ends before it starts", () => {
    expect(isValidPeriod("2026-06-27", "2026-03-03")).toBe(false);
    expect(isValidPeriod("2026-03-04", "2026-03-03")).toBe(false);
  });

  it("is true when the class starts and ends on the same day", () => {
    expect(isValidPeriod("2026-03-03", "2026-03-03")).toBe(true);
  });

  it("is true when the class ends after it starts", () => {
    expect(isValidPeriod("2026-03-03", "2026-06-27")).toBe(true);
    expect(isValidPeriod("2026-03-03", "2026-03-04")).toBe(true);
  });

  it("compares the whole date, across the turn of the year", () => {
    expect(isValidPeriod("2026-12-01", "2027-02-15")).toBe(true);
    expect(isValidPeriod("2027-02-15", "2026-12-01")).toBe(false);
    expect(isValidPeriod("2026-12-31", "2027-01-01")).toBe(true);
    expect(isValidPeriod("2027-01-01", "2026-12-31")).toBe(false);
  });

  it("puts September before October, because months and days are zero-padded", () => {
    expect(isValidPeriod("2026-09-30", "2026-10-01")).toBe(true);
    expect(isValidPeriod("2026-10-01", "2026-09-30")).toBe(false);
  });
});

describe("invalidPeriod", () => {
  it("is a 400 INVALID_PERIOD that points at the end date", () => {
    const failure = invalidPeriod();

    expect(failure).toBeInstanceOf(HttpException);
    expect(failure.getStatus()).toBe(400);
    expect(failure.getResponse()).toEqual({
      error: "INVALID_PERIOD",
      message: "endDate must be on or after startDate.",
      details: [{ field: "endDate", message: "endDate must be on or after startDate" }],
    });
  });
});
