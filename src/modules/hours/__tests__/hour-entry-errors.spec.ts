import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import {
  entryNotPending,
  hourEntryDateInFuture,
  hourEntryNotFound,
  invalidPeriod,
  memberNotFound,
  selfOnBehalfNotAllowed,
} from "../services/hour-entry-errors";

describe("hour entry errors", () => {
  it.each([
    {
      name: "hourEntryNotFound",
      build: hourEntryNotFound,
      status: 404,
      body: { error: "HOUR_ENTRY_NOT_FOUND", message: "Hour entry not found." },
    },
    {
      name: "entryNotPending",
      build: entryNotPending,
      status: 409,
      body: { error: "ENTRY_NOT_PENDING", message: "Only pending hour entries can be removed." },
    },
    {
      name: "hourEntryDateInFuture",
      build: hourEntryDateInFuture,
      status: 400,
      body: {
        error: "HOUR_ENTRY_DATE_IN_FUTURE",
        message: "Hours cannot be logged for a future date.",
        details: [{ field: "date", message: "date must not be after today" }],
      },
    },
    {
      name: "memberNotFound",
      build: memberNotFound,
      status: 404,
      body: { error: "MEMBER_NOT_FOUND", message: "Member not found." },
    },
    {
      name: "selfOnBehalfNotAllowed",
      build: selfOnBehalfNotAllowed,
      status: 400,
      body: {
        error: "SELF_ON_BEHALF_NOT_ALLOWED",
        message: "Log your own hours with POST /me/hour-entries.",
      },
    },
    {
      name: "invalidPeriod",
      build: invalidPeriod,
      status: 400,
      body: {
        error: "INVALID_PERIOD",
        message: "from must be on or before to.",
        details: [{ field: "to", message: "to must be on or after from" }],
      },
    },
  ])(
    "builds $name with its status, code, English message and details",
    ({ build, status, body }) => {
      const failure = build();

      expect(failure).toBeInstanceOf(HttpException);
      expect(failure.getStatus()).toBe(status);
      expect(failure.getResponse()).toEqual(body);
    },
  );

  it("builds a new exception each time, so a caller cannot change another one", () => {
    expect(hourEntryNotFound()).not.toBe(hourEntryNotFound());
  });

  it("says the same as the member record of the people module for a member that is not one", () => {
    expect(memberNotFound().getResponse()).toEqual({
      error: "MEMBER_NOT_FOUND",
      message: "Member not found.",
    });
  });
});
