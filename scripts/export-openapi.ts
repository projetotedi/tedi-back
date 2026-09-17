/**
 * Exports the OpenAPI document to `docs/openapi.json`.
 *
 * Run with:
 *   yarn openapi:export
 *
 * Boots a minimal NestJS app (no database, no HTTP server) and writes the
 * serialised document. Safe to run at any time — the output is deterministic.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { computeOpenApiJson } from "./openapi-runtime";

async function main(): Promise<void> {
  const json = await computeOpenApiJson();
  const outPath = join(__dirname, "..", "docs", "openapi.json");
  writeFileSync(outPath, json, "utf8");
  console.log(`docs/openapi.json written (${json.length} bytes)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
