import { ageOn, isValidCalendarDate, todayInAppTimeZone } from "../calendar-date";

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
