import {
  ageOn,
  calendarDaysBetween,
  isValidCalendarDate,
  todayInAppTimeZone,
} from "../calendar-date";

describe("calendar-date", () => {
  it("computes 68 for 1958-04-12 on 2026-10-01", () => {
    expect(ageOn("1958-04-12", "2026-10-01")).toBe(68);
  });

  it("computes 67 on 2026-04-11, the day before the birthday", () => {
    expect(ageOn("1958-04-12", "2026-04-11")).toBe(67);
  });

  it("computes 68 on 2026-04-12, the birthday", () => {
    expect(ageOn("1958-04-12", "2026-04-12")).toBe(68);
  });

  it("computes 68 on 2026-04-13, the day after the birthday", () => {
    expect(ageOn("1958-04-12", "2026-04-13")).toBe(68);
  });

  it("treats a Feb 29 birthday as reached on Mar 1 of a non-leap year", () => {
    expect(ageOn("2000-02-29", "2025-02-28")).toBe(24);
    expect(ageOn("2000-02-29", "2025-03-01")).toBe(25);
  });

  it("returns the São Paulo date, not the UTC date, at 22:30 BRT", () => {
    // 22:30 BRT on 2026-10-01 is already 2026-10-02 in UTC.
    expect(todayInAppTimeZone(new Date("2026-10-02T01:30:00Z"))).toBe("2026-10-01");
    expect(todayInAppTimeZone(new Date("2026-10-01T15:00:00Z"))).toBe("2026-10-01");
  });

  it("accepts real calendar dates and rejects 2023-02-30, 1958-4-12, 12/04/1958 and datetimes", () => {
    expect(isValidCalendarDate("1958-04-12")).toBe(true);
    expect(isValidCalendarDate("2024-02-29")).toBe(true);

    expect(isValidCalendarDate("2023-02-29")).toBe(false);
    expect(isValidCalendarDate("2023-02-30")).toBe(false);
    expect(isValidCalendarDate("1958-4-12")).toBe(false);
    expect(isValidCalendarDate("12/04/1958")).toBe(false);
    expect(isValidCalendarDate("1958-04-12T00:00:00Z")).toBe(false);
  });
});

describe("calendarDaysBetween", () => {
  it("is 0 for the same day", () => {
    expect(calendarDaysBetween("2026-03-01", "2026-03-01")).toBe(0);
    expect(calendarDaysBetween("2024-02-29", "2024-02-29")).toBe(0);
  });

  it("is 1 for the next day", () => {
    expect(calendarDaysBetween("2026-03-01", "2026-03-02")).toBe(1);
  });

  it("is 41 from 2026-03-01 to 2026-04-11, the 42 days of a month grid minus one", () => {
    expect(calendarDaysBetween("2026-03-01", "2026-04-11")).toBe(41);
  });

  it("crosses the end of the year", () => {
    expect(calendarDaysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(calendarDaysBetween("2025-12-25", "2026-01-05")).toBe(11);
    expect(calendarDaysBetween("2025-01-01", "2026-01-01")).toBe(365);
  });

  it("counts February 29 in a leap year and not in the others", () => {
    expect(calendarDaysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(calendarDaysBetween("2023-02-28", "2023-03-01")).toBe(1);
    expect(calendarDaysBetween("2024-01-01", "2025-01-01")).toBe(366);
  });

  it("is negative when `to` is before `from`", () => {
    expect(calendarDaysBetween("2026-04-11", "2026-03-01")).toBe(-41);
    expect(calendarDaysBetween("2026-01-01", "2025-12-31")).toBe(-1);
  });

  it("is not moved by the daylight saving of any zone: a day is 24 hours long", () => {
    // Spans that cross a clock change (Brazil in 2018 and 2019, the United States in 2026): in UTC
    // a day is always 24 hours, whatever the zone of the server.
    expect(calendarDaysBetween("2018-11-03", "2018-11-05")).toBe(2);
    expect(calendarDaysBetween("2019-02-15", "2019-02-18")).toBe(3);
    expect(calendarDaysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(calendarDaysBetween("2026-10-24", "2026-11-01")).toBe(8);
  });

  it("works for the first years of the calendar, which Date.UTC would map to 19xx", () => {
    expect(calendarDaysBetween("0001-01-01", "0001-01-02")).toBe(1);
    expect(calendarDaysBetween("0099-12-31", "0100-01-01")).toBe(1);
  });

  it("throws for a date that does not exist or is not YYYY-MM-DD, instead of answering NaN", () => {
    for (const invalid of ["2026-02-30", "2026-3-1", "01/03/2026", "2026-03-01T00:00:00Z", ""]) {
      expect(() => calendarDaysBetween(invalid, "2026-03-01")).toThrow("Invalid calendar date");
      expect(() => calendarDaysBetween("2026-03-01", invalid)).toThrow("Invalid calendar date");
    }
  });
});
