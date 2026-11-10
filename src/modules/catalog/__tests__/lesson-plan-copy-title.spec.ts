import { LESSON_PLAN_TITLE_MAX_LENGTH } from "../dto/lesson-plan-limits";
import { LESSON_PLAN_COPY_SUFFIX, copyTitle } from "../services/lesson-plan-copy-title";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function lengthInCharacters(text: string): number {
  return Array.from(text).length;
}

describe("copyTitle", () => {
  it("appends ' (cópia)' to a short title", () => {
    expect(copyTitle("Teclado, mouse e janelas")).toBe("Teclado, mouse e janelas (cópia)");
  });

  it("has a suffix of 8 characters", () => {
    expect(LESSON_PLAN_COPY_SUFFIX).toBe(" (cópia)");
    expect(lengthInCharacters(LESSON_PLAN_COPY_SUFFIX)).toBe(8);
    // The "ó" is the single character U+00F3, not an "o" plus a combining accent.
    expect(LESSON_PLAN_COPY_SUFFIX.normalize("NFC")).toBe(LESSON_PLAN_COPY_SUFFIX);
    expect(LESSON_PLAN_COPY_SUFFIX).toHaveLength(8);
  });

  it("keeps a 192-character title whole and reaches exactly 200", () => {
    const result = copyTitle("t".repeat(192));

    expect(result).toBe("t".repeat(192) + " (cópia)");
    expect(lengthInCharacters(result)).toBe(LESSON_PLAN_TITLE_MAX_LENGTH);
  });

  it("cuts a 200-character title to 192 characters before the suffix", () => {
    const result = copyTitle("t".repeat(200));

    expect(result).toBe("t".repeat(192) + " (cópia)");
    expect(lengthInCharacters(result)).toBe(LESSON_PLAN_TITLE_MAX_LENGTH);
  });

  it("trims the space left at the end of the cut", () => {
    const result = copyTitle(`${"a".repeat(191)} ${"b".repeat(8)}`);

    expect(result).toBe("a".repeat(191) + " (cópia)");
    expect(lengthInCharacters(result)).toBe(199);
  });

  it("never splits an emoji and counts it as one character", () => {
    // 199 "a" plus an emoji: 200 characters, 201 UTF-16 units. The cut is before the emoji.
    const emojiLast = copyTitle(`${"a".repeat(199)}😀`);
    // The emoji is the 192nd character: cutting by UTF-16 units would leave half of it.
    const emojiAtTheCut = copyTitle(`${"a".repeat(191)}😀${"b".repeat(8)}`);

    expect(emojiLast).toBe("a".repeat(192) + " (cópia)");
    expect(emojiAtTheCut).toBe(`${"a".repeat(191)}😀 (cópia)`);
    for (const result of [emojiLast, emojiAtTheCut]) {
      expect(lengthInCharacters(result)).toBeLessThanOrEqual(LESSON_PLAN_TITLE_MAX_LENGTH);
      expect(result).not.toMatch(LONE_SURROGATE);
    }
    // Each emoji counts as one, so 150 of them (300 UTF-16 units) stay whole under the 192 limit.
    expect(copyTitle("😀".repeat(150))).toBe("😀".repeat(150) + " (cópia)");
  });

  it("appends the suffix again to a title that is already a copy", () => {
    expect(copyTitle("X (cópia)")).toBe("X (cópia) (cópia)");
    expect(copyTitle(copyTitle("Janelas"))).toBe("Janelas (cópia) (cópia)");
  });
});
