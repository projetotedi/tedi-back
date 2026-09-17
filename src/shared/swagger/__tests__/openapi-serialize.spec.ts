import { sortDeep, serializeOpenApi } from "../../../../scripts/openapi-serialize";

describe("openapi-serialize", () => {
  describe("sortDeep", () => {
    it("sorts object keys alphabetically", () => {
      const result = sortDeep({ b: 1, a: 2 }) as Record<string, number>;
      expect(Object.keys(result)).toEqual(["a", "b"]);
    });

    it("preserves array element order", () => {
      const input = { values: ["z", "a", "m"] };
      const result = sortDeep(input) as { values: string[] };
      expect(result.values).toEqual(["z", "a", "m"]);
    });

    it("sorts nested object keys", () => {
      const result = sortDeep({ z: { b: 1, a: 2 }, a: 3 }) as {
        z: Record<string, number>;
        a: number;
      };
      expect(Object.keys(result)).toEqual(["a", "z"]);
      expect(Object.keys(result.z)).toEqual(["a", "b"]);
    });

    it("preserves arrays of objects element order", () => {
      const input = { tags: [{ name: "z" }, { name: "a" }] };
      const result = sortDeep(input) as { tags: Array<{ name: string }> };
      expect(result.tags[0].name).toBe("z");
      expect(result.tags[1].name).toBe("a");
    });

    it("handles null values", () => {
      expect(sortDeep(null)).toBeNull();
    });

    it("handles primitive values", () => {
      expect(sortDeep("hello")).toBe("hello");
      expect(sortDeep(42)).toBe(42);
      expect(sortDeep(true)).toBe(true);
    });
  });

  describe("serializeOpenApi", () => {
    it("ends with a newline (POSIX)", () => {
      const result = serializeOpenApi({ a: 1 });
      expect(result.endsWith("\n")).toBe(true);
    });

    it("is idempotent (same input → same output, Caso 1 in-process)", () => {
      const doc = { z: 2, a: 1, tags: ["health"] };
      expect(serializeOpenApi(doc)).toBe(serializeOpenApi(doc));
    });

    it("sorts keys in the output JSON", () => {
      const result = serializeOpenApi({ b: 2, a: 1 });
      const parsed = JSON.parse(result) as Record<string, number>;
      expect(Object.keys(parsed)).toEqual(["a", "b"]);
    });

    it("preserves enum array order in output", () => {
      const doc = { schema: { enum: ["error", "ok"] } };
      const result = serializeOpenApi(doc);
      const parsed = JSON.parse(result) as { schema: { enum: string[] } };
      expect(parsed.schema.enum).toEqual(["error", "ok"]);
    });
  });
});
