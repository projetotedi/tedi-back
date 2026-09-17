import { diffOpenApiStrings } from "../../../../scripts/openapi-diff";

describe("openapi-diff", () => {
  describe("diffOpenApiStrings", () => {
    it("returns equal:true and empty diff when strings are identical", () => {
      const a = '{\n  "version": "0.1.0"\n}\n';
      const result = diffOpenApiStrings(a, a);
      expect(result.equal).toBe(true);
      expect(result.diff).toBe("");
    });

    it("returns equal:false with diff lines when strings differ (Caso 2)", () => {
      const a = '{\n  "version": "0.1.0"\n}\n';
      const b = '{\n  "version": "0.2.0"\n}\n';
      const result = diffOpenApiStrings(a, b);
      expect(result.equal).toBe(false);
      expect(result.diff).toContain("- ");
      expect(result.diff).toContain("+ ");
    });

    it("diff contains removed lines prefixed with -", () => {
      const a = "line1\nline2\nline3\n";
      const b = "line1\nchanged\nline3\n";
      const result = diffOpenApiStrings(a, b);
      expect(result.diff).toContain("- line2");
    });

    it("diff contains added lines prefixed with +", () => {
      const a = "line1\nline2\nline3\n";
      const b = "line1\nchanged\nline3\n";
      const result = diffOpenApiStrings(a, b);
      expect(result.diff).toContain("+ changed");
    });

    it("handles strings of different lengths", () => {
      const a = "line1\nline2\n";
      const b = "line1\nline2\nline3\n";
      const result = diffOpenApiStrings(a, b);
      expect(result.equal).toBe(false);
      expect(result.diff).toContain("+ line3");
    });
  });
});
