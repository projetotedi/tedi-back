import {
  isValidTimeOfDay,
  minutesBetween,
  minutesOfDay,
  TIME_OF_DAY_PATTERN,
} from "../time-of-day";

describe("time-of-day", () => {
  describe("isValidTimeOfDay", () => {
    it("accepts every hour of the day, from 00:00 to 23:59", () => {
      for (const time of ["00:00", "00:01", "09:00", "12:30", "14:00", "19:45", "23:59"]) {
        expect(isValidTimeOfDay(time)).toBe(true);
      }
    });

    it("rejects an hour or a minute that does not exist", () => {
      for (const time of ["24:00", "25:00", "99:99", "12:60", "12:99", "23:60"]) {
        expect(isValidTimeOfDay(time)).toBe(false);
      }
    });

    it("rejects a time that is not exactly HH:mm: no padding, seconds, spaces, 12-hour clock or text", () => {
      for (const time of [
        "9:00",
        "09:0",
        "9:0",
        "14:00:00",
        "14:00:00.000",
        "14h00",
        "14.00",
        "1400",
        " 14:00",
        "14:00 ",
        "14:00\n",
        "2:00 pm",
        "14:00Z",
        "2026-03-03T14:00",
        "",
        "noon",
      ]) {
        expect(isValidTimeOfDay(time)).toBe(false);
      }
    });

    it("exposes the pattern it checks with", () => {
      expect(TIME_OF_DAY_PATTERN.test("07:15")).toBe(true);
      expect(TIME_OF_DAY_PATTERN.test("7:15")).toBe(false);
    });
  });

  describe("minutesOfDay", () => {
    it("counts the minutes since midnight", () => {
      expect(minutesOfDay("00:00")).toBe(0);
      expect(minutesOfDay("00:01")).toBe(1);
      expect(minutesOfDay("01:00")).toBe(60);
      expect(minutesOfDay("14:30")).toBe(870);
      expect(minutesOfDay("23:59")).toBe(1439);
    });
  });

  describe("minutesBetween", () => {
    it("is the length of the interval in minutes", () => {
      expect(minutesBetween("14:00", "15:30")).toBe(90);
      expect(minutesBetween("08:00", "08:45")).toBe(45);
      expect(minutesBetween("00:00", "23:59")).toBe(1439);
    });

    it("crosses the turn of the hour", () => {
      expect(minutesBetween("13:50", "14:10")).toBe(20);
    });

    it("is 0 for equal times and negative when the end is before the start", () => {
      expect(minutesBetween("14:00", "14:00")).toBe(0);
      expect(minutesBetween("15:30", "14:00")).toBe(-90);
    });
  });
});
