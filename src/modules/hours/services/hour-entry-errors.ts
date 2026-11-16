import { HttpException } from "@nestjs/common";

/**
 * The business errors of the hours, one helper each, so a service and a pipe answer the same thing.
 * The messages are English literals and the stable part is the `error` code: the front translates
 * by it (there is no i18n in the backend).
 */

/**
 * 404 for `/me/hour-entries/:id`: a malformed id, an unknown one, an entry of another person and
 * one already removed all answer the same, so the route never tells that someone else's entry
 * exists.
 */
export function hourEntryNotFound(): HttpException {
  return new HttpException(
    { error: "HOUR_ENTRY_NOT_FOUND", message: "Hour entry not found." },
    404,
  );
}

/** 409: only a pending entry can be removed; a reviewed one is part of the bank of hours. */
export function entryNotPending(): HttpException {
  return new HttpException(
    { error: "ENTRY_NOT_PENDING", message: "Only pending hour entries can be removed." },
    409,
  );
}

/** 400: hours are logged for work already done, never after today in APP_TIME_ZONE. */
export function hourEntryDateInFuture(): HttpException {
  return new HttpException(
    {
      error: "HOUR_ENTRY_DATE_IN_FUTURE",
      message: "Hours cannot be logged for a future date.",
      details: [{ field: "date", message: "date must not be after today" }],
    },
    400,
  );
}

/**
 * 404 for `/members/:id/hour-entries`: a malformed id, an unknown or deleted person and a person
 * without an approved member registration. The same code and text as the member record of the
 * people module, built here because a module does not import the helpers of another.
 */
export function memberNotFound(): HttpException {
  return new HttpException({ error: "MEMBER_NOT_FOUND", message: "Member not found." }, 404);
}

/** 400: logging for oneself goes through `/me`, so `on_behalf` always means "logged by someone else". */
export function selfOnBehalfNotAllowed(): HttpException {
  return new HttpException(
    {
      error: "SELF_ON_BEHALF_NOT_ALLOWED",
      message: "Log your own hours with POST /me/hour-entries.",
    },
    400,
  );
}

/** 400: a period whose start is after its end, anchored on `to`. */
export function invalidPeriod(): HttpException {
  return new HttpException(
    {
      error: "INVALID_PERIOD",
      message: "from must be on or before to.",
      details: [{ field: "to", message: "to must be on or after from" }],
    },
    400,
  );
}
