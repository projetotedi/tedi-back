import { timeOfDayTransformer } from "../time-of-day.transformer";

describe("timeOfDayTransformer", () => {
  const from = timeOfDayTransformer.from as (value: string | null | undefined) => unknown;
  const to = timeOfDayTransformer.to as (value: string | null | undefined) => unknown;

  describe("from (database to entity)", () => {
    it("cuts the seconds Postgres adds: 14:00:00 is read as 14:00", () => {
      expect(from("14:00:00")).toBe("14:00");
      expect(from("09:05:00")).toBe("09:05");
      expect(from("00:00:00")).toBe("00:00");
      expect(from("23:59:00")).toBe("23:59");
    });

    it("cuts fractions of a second too", () => {
      expect(from("14:30:00.5")).toBe("14:30");
      expect(from("14:30:59.123456")).toBe("14:30");
    });

    it("leaves a value that is already HH:mm as it is", () => {
      expect(from("14:30")).toBe("14:30");
    });

    it("lets null and undefined pass", () => {
      expect(from(null)).toBeNull();
      expect(from(undefined)).toBeUndefined();
    });
  });

  describe("to (entity to database)", () => {
    it("passes the value on as it is: HH:mm is a valid time literal", () => {
      expect(to("14:30")).toBe("14:30");
    });

    it("lets null and undefined pass, so a column left out keeps its default", () => {
      expect(to(null)).toBeNull();
      expect(to(undefined)).toBeUndefined();
    });
  });
});
