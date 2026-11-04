/**
 * Usage status of a lesson plan in the API (RF-017). It is derived and is NOT a column: a plan is
 * IN_USE when at least one course that is not deleted has it in its sequence (archived courses
 * included, like `courseCount`) and UNUSED otherwise.
 *
 * It says nothing about archiving, which stays in `archivedAt`: an archived plan can be IN_USE,
 * since it keeps its place in the sequences it was already in (RN-27).
 */
export enum LessonPlanUsageStatus {
  IN_USE = "in_use",
  UNUSED = "unused",
}
