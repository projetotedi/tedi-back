export const CLASS_CODE_MAX_LENGTH = 30;
export const CLASS_NAME_MAX_LENGTH = 200;
export const CLASS_LOCATION_MAX_LENGTH = 200;
export const CLASS_CAPACITY_MAX = 1000;

export const EDITION_NAME_MAX_LENGTH = 20;
/** "<year>.<term>", for example 2026.1. With this shape the alphabetical order is the chronological one. */
export const EDITION_NAME_PATTERN = /^\d{4}\.[1-9]$/;

/** Most courses `GET /classes/summary-by-course` takes at once: the page limit of the project. */
export const CLASSES_SUMMARY_MAX_COURSES = 100;
