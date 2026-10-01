/**
 * Exports the permission matrix to `docs/PERMISSIONS.md`.
 *
 * Run with:
 *   yarn permissions:export
 *
 * The output is deterministic. A unit test fails when the committed file is stale.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { renderPermissionsDoc } from "@shared/permissions/permissions-doc";

function main(): void {
  const markdown = renderPermissionsDoc();
  const outPath = join(__dirname, "..", "docs", "PERMISSIONS.md");
  writeFileSync(outPath, markdown, "utf8");
  console.log(`docs/PERMISSIONS.md written (${markdown.length} bytes)`);
}

main();
