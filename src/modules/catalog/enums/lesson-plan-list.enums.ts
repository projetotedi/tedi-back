/**
 * The usage filter of the list of lesson plans (GUS-95). IN_USE and UNUSED are the plans that are
 * not archived, in at least one course or in none; ARCHIVED is only the archived ones. Omitted, the
 * list has every plan that is not archived.
 */
export enum LessonPlanUsageFilter {
  IN_USE = "in_use",
  UNUSED = "unused",
  ARCHIVED = "archived",
}

/** The situation of a line of the list: archived wins over the usage. */
export enum LessonPlanListStatus {
  IN_USE = "in_use",
  UNUSED = "unused",
  ARCHIVED = "archived",
}

/**
 * Order of the list of lesson plans. TITLE is alphabetical, the default; UPDATED_AT puts the one
 * changed last first. Both break ties by id, so a page never repeats or skips a plan.
 */
export enum LessonPlanListSort {
  TITLE = "title",
  UPDATED_AT = "updatedAt",
}
