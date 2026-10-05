import { ObjectLiteral, SelectQueryBuilder } from "typeorm";
import {
  applyDigitsSearch,
  applyTextSearch,
  digitsSearchCondition,
  normalizeSearchTerm,
  textSearchCondition,
} from "../search.util";

function fakeQueryBuilder(): { qb: SelectQueryBuilder<ObjectLiteral>; andWhere: jest.Mock } {
  const andWhere = jest.fn();
  const qb = { andWhere } as unknown as SelectQueryBuilder<ObjectLiteral>;
  andWhere.mockReturnValue(qb);
  return { qb, andWhere };
}

const NAME_OR_RA_SQL =
  "(search_normalize(person.name) LIKE search_normalize(:textSearchTerm) ESCAPE '\\' " +
  "OR search_normalize(person.ra) LIKE search_normalize(:textSearchTerm) ESCAPE '\\')";

const INVALID_COLUMNS = [
  "name",
  "",
  "a.b.c",
  "person.name)",
  "person.name; DROP TABLE people",
  "person.name OR 1=1",
  "1person.name",
];

describe("normalizeSearchTerm", () => {
  it("trims the term and collapses repeated spaces", () => {
    expect(normalizeSearchTerm("  Ana   Paula ")).toBe("Ana Paula");
  });

  it("collapses tabs and line breaks into one space", () => {
    expect(normalizeSearchTerm("Ana\t\n Paula\r\n")).toBe("Ana Paula");
  });

  it("escapes % and _ so they search for the literal characters", () => {
    expect(normalizeSearchTerm("50%_")).toBe("50\\%\\_");
  });

  it("escapes the backslash", () => {
    expect(normalizeSearchTerm("a\\b")).toBe("a\\\\b");
    expect(normalizeSearchTerm("100\\%")).toBe("100\\\\\\%");
  });

  it("returns undefined for a blank term, null and undefined", () => {
    expect(normalizeSearchTerm("   ")).toBeUndefined();
    expect(normalizeSearchTerm("")).toBeUndefined();
    expect(normalizeSearchTerm(" \t\n ")).toBeUndefined();
    expect(normalizeSearchTerm(null)).toBeUndefined();
    expect(normalizeSearchTerm(undefined)).toBeUndefined();
  });

  it("keeps case and accents: search_normalize handles them in the database", () => {
    expect(normalizeSearchTerm("  José MÁRIA ")).toBe("José MÁRIA");
  });

  it("escapes the look-alikes of the wildcards that unaccent converts to % _ and \\", () => {
    expect(normalizeSearchTerm("\uFF15\uFF10\uFF05")).toBe("\uFF15\uFF10\\%");
    expect(normalizeSearchTerm("50\uFF05")).toBe("50\\%");
    expect(normalizeSearchTerm("50\uFE6A")).toBe("50\\%");
    expect(normalizeSearchTerm("a\uFF3Fb")).toBe("a\\_b");
    expect(normalizeSearchTerm("a\u2216b")).toBe("a\\\\b");
    expect(normalizeSearchTerm("a\uFE68b")).toBe("a\\\\b");
    expect(normalizeSearchTerm("a\uFF3Cb")).toBe("a\\\\b");
  });
});

describe("textSearchCondition", () => {
  it("compares search_normalize of each column with the escaped term between %", () => {
    expect(textSearchCondition(["person.name", "person.ra"], "50%")).toEqual({
      sql: NAME_OR_RA_SQL,
      parameters: { textSearchTerm: "%50\\%%" },
    });
  });

  it("builds a single comparison for a single column", () => {
    expect(textSearchCondition(["person.name"], "  Ana   Paula ")).toEqual({
      sql: "(search_normalize(person.name) LIKE search_normalize(:textSearchTerm) ESCAPE '\\')",
      parameters: { textSearchTerm: "%Ana Paula%" },
    });
  });

  it("uses the given parameter name in the SQL and in the parameters", () => {
    expect(textSearchCondition(["person.name"], "ana", "nameTerm")).toEqual({
      sql: "(search_normalize(person.name) LIKE search_normalize(:nameTerm) ESCAPE '\\')",
      parameters: { nameTerm: "%ana%" },
    });
  });

  it("returns undefined when the term is blank, null or undefined", () => {
    expect(textSearchCondition(["person.name"], "   ")).toBeUndefined();
    expect(textSearchCondition(["person.name"], "")).toBeUndefined();
    expect(textSearchCondition(["person.name"], null)).toBeUndefined();
    expect(textSearchCondition(["person.name"], undefined)).toBeUndefined();
  });

  it("throws when there is no column, even for a blank term", () => {
    expect(() => textSearchCondition([], "ana")).toThrow("A search needs at least one column.");
    expect(() => textSearchCondition([], undefined)).toThrow("A search needs at least one column.");
  });

  it.each(INVALID_COLUMNS)("throws for the invalid column %j", (column) => {
    expect(() => textSearchCondition([column], "ana")).toThrow("Invalid search column");
    expect(() => textSearchCondition(["person.name", column], undefined)).toThrow(
      "Invalid search column",
    );
  });

  it("throws for an invalid parameter name", () => {
    expect(() => textSearchCondition(["person.name"], "ana", "term; DROP TABLE people")).toThrow(
      "Invalid search parameter name",
    );
    expect(() => textSearchCondition(["person.name"], "ana", "")).toThrow(
      "Invalid search parameter name",
    );
  });
});

describe("applyTextSearch", () => {
  it("adds the condition with andWhere, escaping % in the term", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    applyTextSearch(qb, ["person.name", "person.ra"], "50%");

    expect(andWhere).toHaveBeenCalledTimes(1);
    expect(andWhere).toHaveBeenCalledWith(NAME_OR_RA_SQL, { textSearchTerm: "%50\\%%" });
  });

  it("does not touch the query builder when the term is blank, null or undefined", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    applyTextSearch(qb, ["person.name"], "   ");
    applyTextSearch(qb, ["person.name"], "");
    applyTextSearch(qb, ["person.name"], null);
    applyTextSearch(qb, ["person.name"], undefined);

    expect(andWhere).not.toHaveBeenCalled();
  });

  it("returns the same query builder with and without a term", () => {
    const { qb } = fakeQueryBuilder();

    expect(applyTextSearch(qb, ["person.name"], "ana")).toBe(qb);
    expect(applyTextSearch(qb, ["person.name"], undefined)).toBe(qb);
  });

  it("throws for no column and for an invalid column", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    expect(() => applyTextSearch(qb, [], "ana")).toThrow("A search needs at least one column.");
    expect(() => applyTextSearch(qb, ["name"], "ana")).toThrow("Invalid search column");
    expect(andWhere).not.toHaveBeenCalled();
  });
});

describe("digitsSearchCondition", () => {
  it("keeps only the digits of the term", () => {
    expect(digitsSearchCondition("person.phone", "(43) 99999-0000")).toEqual({
      sql: "person.phone LIKE :digitsSearchTerm",
      parameters: { digitsSearchTerm: "%43999990000%" },
    });
  });

  it("uses the given parameter name in the SQL and in the parameters", () => {
    expect(digitsSearchCondition("person.phone", "9999", "phoneTerm")).toEqual({
      sql: "person.phone LIKE :phoneTerm",
      parameters: { phoneTerm: "%9999%" },
    });
  });

  it("returns undefined when the term has no digit", () => {
    expect(digitsSearchCondition("person.phone", "abc")).toBeUndefined();
    expect(digitsSearchCondition("person.phone", "  - ( ) ")).toBeUndefined();
    expect(digitsSearchCondition("person.phone", "")).toBeUndefined();
    expect(digitsSearchCondition("person.phone", null)).toBeUndefined();
    expect(digitsSearchCondition("person.phone", undefined)).toBeUndefined();
  });

  it.each(INVALID_COLUMNS)("throws for the invalid column %j", (column) => {
    expect(() => digitsSearchCondition(column, "123")).toThrow("Invalid search column");
  });

  it("throws for an invalid parameter name", () => {
    expect(() => digitsSearchCondition("person.phone", "123", "term; DROP")).toThrow(
      "Invalid search parameter name",
    );
  });
});

describe("applyDigitsSearch", () => {
  it("adds the condition with andWhere", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    applyDigitsSearch(qb, "person.phone", "(43) 99999-0000");

    expect(andWhere).toHaveBeenCalledTimes(1);
    expect(andWhere).toHaveBeenCalledWith("person.phone LIKE :digitsSearchTerm", {
      digitsSearchTerm: "%43999990000%",
    });
  });

  it("does not touch the query builder when the term has no digit", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    applyDigitsSearch(qb, "person.phone", "abc");
    applyDigitsSearch(qb, "person.phone", undefined);

    expect(andWhere).not.toHaveBeenCalled();
  });

  it("returns the same query builder with and without digits", () => {
    const { qb } = fakeQueryBuilder();

    expect(applyDigitsSearch(qb, "person.phone", "123")).toBe(qb);
    expect(applyDigitsSearch(qb, "person.phone", "abc")).toBe(qb);
  });
});
