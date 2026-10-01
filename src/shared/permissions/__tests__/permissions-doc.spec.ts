import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Permission } from "../permission.enum";
import { renderPermissionsDoc } from "../permissions-doc";

const DOC_PATH = join(__dirname, "..", "..", "..", "..", "docs", "PERMISSIONS.md");

function readDoc(): string {
  return readFileSync(DOC_PATH, "utf8").replace(/\r\n/g, "\n");
}

describe("docs/PERMISSIONS.md", () => {
  it("docs/PERMISSIONS.md is up to date with PERMISSION_MATRIX", () => {
    const expected = renderPermissionsDoc();
    if (readDoc() !== expected) {
      throw new Error("docs/PERMISSIONS.md is stale. Run `yarn permissions:export` and commit it.");
    }
  });

  it("lists every Permission value", () => {
    const doc = readDoc();
    for (const permission of Object.values(Permission)) {
      expect(doc).toContain(`\`${permission}\``);
    }
  });

  it("renders deterministically and ends with a newline", () => {
    expect(renderPermissionsDoc()).toBe(renderPermissionsDoc());
    expect(renderPermissionsDoc().endsWith("\n")).toBe(true);
  });
});
