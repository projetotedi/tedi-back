import { HttpException } from "@nestjs/common";
import { minutesBetween } from "@shared/dates/time-of-day";

/** The days a class runs, both "YYYY-MM-DD", both inside the period (SchoolClass.startDate/endDate). */
export interface ClassPeriod {
  startDate: string;
  endDate: string;
}

/**
 * True when `date` falls inside the period of the class, ends included: the first and the last day
 * of the class take lessons (RN-21). All three are "YYYY-MM-DD", which compare chronologically when
 * compared as text.
 */
export function isWithinClassPeriod(date: string, period: ClassPeriod): boolean {
  return date >= period.startDate && date <= period.endDate;
}

/**
 * True when the lesson ends after it starts. Equal times are a lesson of no length and an end
 * before the start would cross midnight: neither is a lesson. Both are "HH:mm".
 */
export function isValidTimeRange(startTime: string, endTime: string): boolean {
  return minutesBetween(startTime, endTime) > 0;
}

/**
 * 400 LESSON_OUTSIDE_CLASS_PERIOD, with the field in `details` so the front anchors the error on the
 * day. The one place that builds it: the creation and the reschedule answer the same.
 */
export function lessonOutsideClassPeriod(): HttpException {
  return new HttpException(
    {
      error: "LESSON_OUTSIDE_CLASS_PERIOD",
      message: "The date of the lesson must fall inside the period of the class.",
      details: [
        { field: "date", message: "date must fall inside the period of the class, ends included" },
      ],
    },
    400,
  );
}

/**
 * 400 INVALID_TIME_RANGE, with the field in `details` so the front anchors the error on the end
 * time. The one place that builds it: the checks before the transaction, the one inside it and the
 * check constraint `ck_lessons_time_range` all answer the same.
 */
export function invalidTimeRange(): HttpException {
  return new HttpException(
    {
      error: "INVALID_TIME_RANGE",
      message: "endTime must be after startTime.",
      details: [{ field: "endTime", message: "endTime must be after startTime" }],
    },
    400,
  );
}
