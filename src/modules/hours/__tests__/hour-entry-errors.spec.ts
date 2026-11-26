import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import {
  adjustedMinutesUnchanged,
  attendanceEntryNotRemovable,
  duplicateHourEntry,
  entryNotPending,
  entryNotPendingForReview,
  hourEntriesNotFound,
  hourEntryDateInFuture,
  hourEntryNotFound,
  invalidPeriod,
  memberNotFound,
  selfOnBehalfNotAllowed,
  selfReviewNotAllowed,
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
      name: "attendanceEntryNotRemovable",
      build: attendanceEntryNotRemovable,
      status: 409,
      body: {
        error: "ATTENDANCE_ENTRY_NOT_REMOVABLE",
        message:
          "Lesson hours of an attendance cannot be removed; the attendance is corrected instead.",
      },
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

  it.each([
    {
      name: "hourEntriesNotFound",
      build: () => hourEntriesNotFound(["ids.0", "ids.2"]),
      status: 400,
      body: {
        error: "HOUR_ENTRY_NOT_FOUND",
        message: "One or more hour entries do not exist.",
        details: [
          { field: "ids.0", message: "hour entry not found" },
          { field: "ids.2", message: "hour entry not found" },
        ],
      },
    },
    {
      name: "duplicateHourEntry",
      build: () => duplicateHourEntry(["ids.1"]),
      status: 400,
      body: {
        error: "DUPLICATE_HOUR_ENTRY",
        message: "The same hour entry appears more than once.",
        details: [{ field: "ids.1", message: "hour entry appears more than once" }],
      },
    },
    {
      name: "selfReviewNotAllowed with positions",
      build: () => selfReviewNotAllowed(["ids.3"]),
      status: 409,
      body: {
        error: "SELF_REVIEW_NOT_ALLOWED",
        message: "You cannot review your own hour entry.",
        details: [{ field: "ids.3", message: "you cannot review your own hour entry" }],
      },
    },
    {
      name: "selfReviewNotAllowed for one entry",
      build: () => selfReviewNotAllowed(),
      status: 409,
      body: { error: "SELF_REVIEW_NOT_ALLOWED", message: "You cannot review your own hour entry." },
    },
    {
      name: "entryNotPendingForReview with positions",
      build: () => entryNotPendingForReview(["ids.0"]),
      status: 409,
      body: {
        error: "ENTRY_NOT_PENDING",
        message: "Only pending hour entries can be reviewed.",
        details: [{ field: "ids.0", message: "hour entry is not pending" }],
      },
    },
    {
      name: "entryNotPendingForReview for one entry",
      build: () => entryNotPendingForReview(),
      status: 409,
      body: { error: "ENTRY_NOT_PENDING", message: "Only pending hour entries can be reviewed." },
    },
    {
      name: "adjustedMinutesUnchanged",
      build: adjustedMinutesUnchanged,
      status: 400,
      body: {
        error: "ADJUSTED_MINUTES_UNCHANGED",
        message:
          "validatedMinutes must differ from the declared minutes; validate the entry instead.",
        details: [
          {
            field: "validatedMinutes",
            message: "validatedMinutes must differ from the declared minutes",
          },
        ],
      },
    },
  ])(
    "builds the review error $name with its status, code, English message and details",
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
