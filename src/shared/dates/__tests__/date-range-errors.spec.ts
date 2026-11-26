import { dateRangeTooLong, invalidDateRange } from "../date-range-errors";

describe("invalidDateRange", () => {
  it("is a 400 INVALID_DATE_RANGE with the end of the period as the field", () => {
    const failure = invalidDateRange();

    expect(failure.getStatus()).toBe(400);
    expect(failure.getResponse()).toEqual({
      error: "INVALID_DATE_RANGE",
      message: "to must be on or after from.",
      details: [{ field: "to", message: "to must be on or after from" }],
    });
  });
});

describe("dateRangeTooLong", () => {
  it("is a 400 DATE_RANGE_TOO_LONG that says the limit, with the end of the period as the field", () => {
    const failure = dateRangeTooLong(42);

    expect(failure.getStatus()).toBe(400);
    expect(failure.getResponse()).toEqual({
      error: "DATE_RANGE_TOO_LONG",
      message: "The period cannot be longer than 42 days, counting both ends.",
      details: [{ field: "to", message: "to must be at most 41 days after from" }],
    });
  });

  it("repeats the limit it is given", () => {
    expect(dateRangeTooLong(7).getResponse()).toMatchObject({
      message: "The period cannot be longer than 7 days, counting both ends.",
      details: [{ field: "to", message: "to must be at most 6 days after from" }],
    });
  });
});
