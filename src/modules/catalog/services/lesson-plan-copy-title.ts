import { LESSON_PLAN_TITLE_MAX_LENGTH } from "../dto/lesson-plan-limits";

/** Suffix of the title of a duplicated lesson plan. It is data shown as is, not a message (D4). */
export const LESSON_PLAN_COPY_SUFFIX = " (cópia)";

/**
 * Title of the copy: the original plus the suffix. When that would exceed the column (varchar 200),
 * the original is cut by code points (Postgres counts characters, not UTF-16 units) and trimmed at
 * the end, so the result always fits (D2).
 */
export function copyTitle(title: string): string {
  const room = LESSON_PLAN_TITLE_MAX_LENGTH - Array.from(LESSON_PLAN_COPY_SUFFIX).length;
  const characters = Array.from(title);

  if (characters.length <= room) return title + LESSON_PLAN_COPY_SUFFIX;

  return characters.slice(0, room).join("").trimEnd() + LESSON_PLAN_COPY_SUFFIX;
}
