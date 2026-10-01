/**
 * Stable serialisation utilities for the OpenAPI document.
 *
 * `sortDeep` recursively sorts object keys (arrays are preserved as-is so that
 * `enum`, `required`, `tags` and similar ordered arrays remain stable).
 *
 * `serializeOpenApi` produces a deterministic JSON string that always ends
 * with a POSIX newline (`\n`), matching what editors and `oxfmt` expect.
 */

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

/**
 * Recursively sorts object keys in alphabetical order.
 * Arrays are traversed but their element order is preserved.
 */
export function sortDeep(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }

  if (value !== null && typeof value === "object") {
    const sorted: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortDeep((value as JsonObject)[key]);
    }
    return sorted;
  }

  return value;
}

/**
 * Serialises an OpenAPI document to a stable, human-readable JSON string.
 *
 * Guaranteed properties:
 * - Object keys sorted alphabetically (deterministic diffs).
 * - Array order preserved (enum values, required fields, tags).
 * - Ends with `\n` (POSIX-compliant plain-text file).
 * - Idempotent: calling this twice with the same input returns the same string.
 */
export function serializeOpenApi(doc: object): string {
  return JSON.stringify(sortDeep(doc as JsonValue), null, 2) + "\n";
}
