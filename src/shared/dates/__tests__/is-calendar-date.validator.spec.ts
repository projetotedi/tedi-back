import "reflect-metadata";
import { validate } from "class-validator";
import { IsCalendarDate } from "../is-calendar-date.validator";

class Probe {
  @IsCalendarDate()
  day!: unknown;
}

class ProbeWithMessage {
  @IsCalendarDate({ message: "custom message" })
  day!: unknown;
}

async function errorsOf(day: unknown, target: new () => object = Probe) {
  return validate(Object.assign(new target(), { day }));
}

describe("IsCalendarDate", () => {
  it("accepts a date that exists, including the 29th of February of a leap year", async () => {
    for (const day of ["2026-03-03", "2026-06-27", "2028-02-29", "2000-02-29", "2026-12-31"]) {
      expect(await errorsOf(day)).toHaveLength(0);
    }
  });

  it("accepts any year from 0001 on, with no upper bound and no relation to today", async () => {
    for (const day of ["0001-01-01", "1900-01-01", "2999-12-31", "9999-12-31"]) {
      expect(await errorsOf(day)).toHaveLength(0);
    }
  });

  it("rejects a day that does not exist in the calendar", async () => {
    for (const day of ["2026-02-30", "2027-02-29", "2100-02-29", "2026-04-31", "2026-13-01"]) {
      expect(await errorsOf(day)).toHaveLength(1);
    }
    expect(await errorsOf("2026-00-10")).toHaveLength(1);
    expect(await errorsOf("2026-01-00")).toHaveLength(1);
  });

  it("rejects the year 0000, which Postgres does not store", async () => {
    expect(await errorsOf("0000-01-01")).toHaveLength(1);
    expect(await errorsOf("0000-12-31")).toHaveLength(1);
  });

  it("rejects a string that is not exactly YYYY-MM-DD", async () => {
    for (const day of [
      "2026-3-3",
      "2026-03-3",
      "26-03-03",
      "03/03/2026",
      "2026/03/03",
      "20260303",
      "2026-03-03T00:00:00Z",
      "2026-03-03T00:00:00.000Z",
      "2026-03-03 ",
      " 2026-03-03",
      "2026-03-03\n",
      "",
      "not a date",
    ]) {
      expect(await errorsOf(day)).toHaveLength(1);
    }
  });

  it("rejects a value that is not a string", async () => {
    for (const day of [
      20260303,
      0,
      null,
      undefined,
      true,
      {},
      [],
      ["2026-03-03"],
      new Date("2026-03-03T00:00:00Z"),
    ]) {
      expect(await errorsOf(day)).toHaveLength(1);
    }
  });

  it("explains the error by the field and the format", async () => {
    const [error] = await errorsOf("2026-02-30");

    expect(error.property).toBe("day");
    expect(error.constraints).toEqual({
      isCalendarDate: "day must be a date in YYYY-MM-DD format",
    });
  });

  it("uses the message it is given", async () => {
    const [error] = await errorsOf("nope", ProbeWithMessage);

    expect(error.constraints).toEqual({ isCalendarDate: "custom message" });
  });
});
