import { occupancyRateOf } from "../services/class-occupancy";

describe("occupancyRateOf()", () => {
  it.each([
    [12, 15, 0.8],
    [0, 15, 0],
    [15, 15, 1],
    [1, 1, 1],
    [1, 2, 0.5],
    [7, 10, 0.7],
  ])("answers %i of %i seats as %d", (enrolledCount, capacity, expected) => {
    expect(occupancyRateOf(enrolledCount, capacity)).toBe(expected);
  });

  it.each([
    [1, 3, 0.33],
    [2, 3, 0.67],
    [1, 6, 0.17],
    [5, 6, 0.83],
    [1, 7, 0.14],
  ])("rounds %i of %i seats to two decimals: %d", (enrolledCount, capacity, expected) => {
    expect(occupancyRateOf(enrolledCount, capacity)).toBe(expected);
  });

  it("rounds a half up, as 5 of 1000 (0.005) answers 0.01 and 1 of 1000 (0.001) answers 0", () => {
    expect(occupancyRateOf(5, 1000)).toBe(0.01);
    expect(occupancyRateOf(1, 1000)).toBe(0);
  });

  it("does not cap a class over capacity: 16 of 15 reads above 1", () => {
    expect(occupancyRateOf(16, 15)).toBe(1.07);
    expect(occupancyRateOf(30, 15)).toBe(2);
  });

  it("answers no more than two decimals, even where dividing first would carry a float error", () => {
    for (let capacity = 1; capacity <= 40; capacity++) {
      for (let enrolledCount = 0; enrolledCount <= capacity + 5; enrolledCount++) {
        const rate = occupancyRateOf(enrolledCount, capacity);

        expect(Number.isFinite(rate)).toBe(true);
        expect(Number((rate * 100).toFixed(6)) % 1).toBe(0);
      }
    }
  });

  it("answers 0, never Infinity or NaN, when the seats are 0 or fewer", () => {
    expect(occupancyRateOf(0, 0)).toBe(0);
    expect(occupancyRateOf(3, 0)).toBe(0);
    expect(occupancyRateOf(3, -5)).toBe(0);
  });
});
