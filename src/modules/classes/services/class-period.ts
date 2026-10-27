import { HttpException } from "@nestjs/common";

/**
 * True when the class ends on or after the day it starts (RN-21): one day is a valid period.
 * Both are "YYYY-MM-DD", which compare chronologically when compared as text.
 */
export function isValidPeriod(startDate: string, endDate: string): boolean {
  return endDate >= startDate;
}

/**
 * 400 INVALID_PERIOD, with the field in `details` so the front anchors the error on the end date.
 * The one place that builds it: the check before the transaction, the check of an edit against the
 * dates already stored and the check constraint `ck_classes_period` all answer the same.
 */
export function invalidPeriod(): HttpException {
  return new HttpException(
    {
      error: "INVALID_PERIOD",
      message: "endDate must be on or after startDate.",
      details: [{ field: "endDate", message: "endDate must be on or after startDate" }],
    },
    400,
  );
}
