/**
 * Pure utility for line-by-line comparison of two OpenAPI JSON strings.
 *
 * Intentionally has zero external dependencies so it can be used in tests
 * and in `scripts/check-openapi.ts` alike.
 */

export interface DiffResult {
  /** True when both strings are identical. */
  equal: boolean;
  /** Human-readable unified-style diff, or empty string when equal. */
  diff: string;
}

/**
 * Compares two OpenAPI JSON strings line by line.
 *
 * Produces a simple diff format:
 * - Lines only in `a` are prefixed with `- `.
 * - Lines only in `b` are prefixed with `+ `.
 *
 * This is not a full unified diff (no context lines, no hunk headers), but
 * it is sufficient to show which keys changed when `openapi:check` fails.
 */
export function diffOpenApiStrings(a: string, b: string): DiffResult {
  if (a === b) {
    return { equal: true, diff: "" };
  }

  const linesA = a.split("\n");
  const linesB = b.split("\n");

  const diffLines: string[] = [];
  const maxLen = Math.max(linesA.length, linesB.length);

  for (let i = 0; i < maxLen; i++) {
    const lineA = linesA[i];
    const lineB = linesB[i];

    if (lineA === lineB) {
      continue;
    }

    if (lineA !== undefined) {
      diffLines.push(`- ${lineA}`);
    }
    if (lineB !== undefined) {
      diffLines.push(`+ ${lineB}`);
    }
  }

  return { equal: false, diff: diffLines.join("\n") };
}
