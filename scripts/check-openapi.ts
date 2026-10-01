/**
 * Checks that `docs/openapi.json` is up-to-date with the current source code.
 *
 * Run with:
 *   yarn openapi:check
 *
 * Exits with code 1 (and prints a diff) if the committed file diverges from
 * what `yarn openapi:export` would produce. Used in the CI `qualidade` job.
 *
 * Uses `process.exitCode = 1` (not `process.exit(1)`) so pending async
 * operations can drain before the process terminates.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { computeOpenApiJson } from "./openapi-runtime";
import { diffOpenApiStrings } from "./openapi-diff";

async function main(): Promise<void> {
  const filePath = join(__dirname, "..", "docs", "openapi.json");

  if (!existsSync(filePath)) {
    console.error("docs/openapi.json not found. Run `yarn openapi:export` first.");
    process.exitCode = 1;
    return;
  }

  const committed = readFileSync(filePath, "utf8");
  const fresh = await computeOpenApiJson();

  const result = diffOpenApiStrings(committed, fresh);

  if (result.equal) {
    console.log("docs/openapi.json is up-to-date.");
    return;
  }

  console.error("docs/openapi.json is outdated. Run `yarn openapi:export` and commit the result.");
  console.error("\nDiff (- committed  + fresh):\n");
  console.error(result.diff);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
