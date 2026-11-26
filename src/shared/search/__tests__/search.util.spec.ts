import { DataSource, ObjectLiteral, SelectQueryBuilder } from "typeorm";
import {
  applyDigitsSearch,
  applyTextSearch,
  applyTextSearchAllWords,
  digitsSearchCondition,
  normalizeSearchTerm,
  textSearchAllWordsCondition,
  textSearchCondition,
} from "../search.util";

function fakeQueryBuilder(): { qb: SelectQueryBuilder<ObjectLiteral>; andWhere: jest.Mock } {
  const andWhere = jest.fn();
  const getParameters = jest.fn().mockReturnValue({});
  const qb = { andWhere, getParameters } as unknown as SelectQueryBuilder<ObjectLiteral>;
  andWhere.mockReturnValue(qb);
  return { qb, andWhere };
}

function realQueryBuilder(): SelectQueryBuilder<ObjectLiteral> {
  return new DataSource({ type: "postgres" })
    .createQueryBuilder()
    .select("person.id")
    .from("people", "person");
}

const NAME_OR_RA_SQL =
  "(public.search_normalize(person.name) LIKE public.search_normalize(:textSearchTerm) ESCAPE '\\' " +
  "OR public.search_normalize(person.ra) LIKE public.search_normalize(:textSearchTerm) ESCAPE '\\')";

const INVALID_COLUMNS = [
  "name",
  "",
  "a.b.c",
  "person.name)",
  "person.name; DROP TABLE people",
  "person.name OR 1=1",
  "1person.name",
];

/** What one word compares in the all-words search: the expression of `textSearchCondition`. */
function wordSql(column: string, parameterName: string): string {
  return `public.search_normalize(${column}) LIKE public.search_normalize(:${parameterName}) ESCAPE '\\'`;
}

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

  it("removes NUL characters before trimming and collapsing, because Postgres rejects them in text", () => {
    expect(normalizeSearchTerm("Ma\u0000ria")).toBe("Maria");
    expect(normalizeSearchTerm("\u0000Ana \u0000 Paula\u0000")).toBe("Ana Paula");
    expect(normalizeSearchTerm("50\u0000%")).toBe("50\\%");
  });

  it("returns undefined for a term made only of NUL characters and spaces", () => {
    expect(normalizeSearchTerm("\u0000")).toBeUndefined();
    expect(normalizeSearchTerm("\u0000\u0000")).toBeUndefined();
    expect(normalizeSearchTerm(" \u0000 ")).toBeUndefined();
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
      sql: "(public.search_normalize(person.name) LIKE public.search_normalize(:textSearchTerm) ESCAPE '\\')",
      parameters: { textSearchTerm: "%Ana Paula%" },
    });
  });

  it("uses the given parameter name in the SQL and in the parameters", () => {
    expect(textSearchCondition(["person.name"], "ana", "nameTerm")).toEqual({
      sql: "(public.search_normalize(person.name) LIKE public.search_normalize(:nameTerm) ESCAPE '\\')",
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

  it("throws when the parameter name already exists in the query", () => {
    const andWhere = jest.fn();
    const qb = {
      andWhere,
      getParameters: jest.fn().mockReturnValue({ textSearchTerm: "%existing%" }),
    } as unknown as SelectQueryBuilder<ObjectLiteral>;

    expect(() => applyTextSearch(qb, ["person.name"], "ana")).toThrow(
      'Search parameter "textSearchTerm" is already defined in this query.',
    );
    expect(andWhere).not.toHaveBeenCalled();
  });

  it("does not touch the query builder when the term has only NUL characters", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    applyTextSearch(qb, ["person.name"], "\u0000\u0000");

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

  it("uses the given parameter name in the condition", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    applyTextSearch(qb, ["person.name"], "ana", "nameTerm");

    expect(andWhere).toHaveBeenCalledWith(
      "(public.search_normalize(person.name) LIKE public.search_normalize(:nameTerm) ESCAPE '\\')",
      { nameTerm: "%ana%" },
    );
  });

  it("keeps one parameter per search when two searches on the same query builder use different parameter names", () => {
    const qb = realQueryBuilder();

    applyTextSearch(qb, ["person.name"], "ana", "nameTerm");
    applyTextSearch(qb, ["person.ra"], "2024", "raTerm");

    const [sql, parameters] = qb.getQueryAndParameters();
    expect(qb.getParameters()).toEqual({ nameTerm: "%ana%", raTerm: "%2024%" });
    expect(parameters).toEqual(["%ana%", "%2024%"]);
    expect(sql).toContain(
      "(public.search_normalize(person.name) LIKE public.search_normalize($1) ESCAPE '\\')",
    );
    expect(sql).toContain(
      "(public.search_normalize(person.ra) LIKE public.search_normalize($2) ESCAPE '\\')",
    );
  });

  it("throws for an invalid parameter name", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    expect(() => applyTextSearch(qb, ["person.name"], "ana", "term; DROP TABLE people")).toThrow(
      "Invalid search parameter name",
    );
    expect(andWhere).not.toHaveBeenCalled();
  });
});

describe("textSearchAllWordsCondition", () => {
  const TITLE_AND_SUBJECT = ["lesson.title", "lesson.subject"];

  it("ANDs one condition per word, each ORed over the columns", () => {
    expect(textSearchAllWordsCondition(TITLE_AND_SUBJECT, "senhas privacidade")).toEqual({
      sql:
        `((${wordSql("lesson.title", "textSearchWord0")} OR ${wordSql("lesson.subject", "textSearchWord0")})` +
        ` AND (${wordSql("lesson.title", "textSearchWord1")} OR ${wordSql("lesson.subject", "textSearchWord1")}))`,
      parameters: { textSearchWord0: "%senhas%", textSearchWord1: "%privacidade%" },
    });
  });

  it("builds the very condition of textSearchCondition for a single word", () => {
    expect(textSearchAllWordsCondition(["person.name", "person.ra"], "Ana", "term")).toEqual(
      textSearchCondition(["person.name", "person.ra"], "Ana", "term0"),
    );
  });

  it("names the parameter of word i after the prefix and i, counting from 0", () => {
    const condition = textSearchAllWordsCondition(["lesson.title"], "a b c", "lessonSearch");

    expect(condition?.parameters).toEqual({
      lessonSearch0: "%a%",
      lessonSearch1: "%b%",
      lessonSearch2: "%c%",
    });
    expect(condition?.sql).toContain(":lessonSearch0");
    expect(condition?.sql).toContain(":lessonSearch2");
    expect(condition?.sql).not.toContain(":textSearchWord");
  });

  it("looks for a word that comes more than once a single time", () => {
    expect(
      textSearchAllWordsCondition(["lesson.title"], "senhas privacidade senhas senhas"),
    ).toEqual({
      sql: `((${wordSql("lesson.title", "textSearchWord0")}) AND (${wordSql("lesson.title", "textSearchWord1")}))`,
      parameters: { textSearchWord0: "%senhas%", textSearchWord1: "%privacidade%" },
    });
    expect(textSearchAllWordsCondition(["lesson.title"], "ana ana")).toEqual(
      textSearchCondition(["lesson.title"], "ana", "textSearchWord0"),
    );
  });

  it("collapses spaces, tabs and line breaks between the words and around the term", () => {
    expect(
      textSearchAllWordsCondition(TITLE_AND_SUBJECT, "  senhas \t\n  privacidade \r\n"),
    ).toEqual(textSearchAllWordsCondition(TITLE_AND_SUBJECT, "senhas privacidade"));
  });

  it("keeps % and _ as literal characters, escaping them inside each word", () => {
    expect(textSearchAllWordsCondition(["lesson.title"], "50% a_b")?.parameters).toEqual({
      textSearchWord0: "%50\\%%",
      textSearchWord1: "%a\\_b%",
    });
  });

  it("escapes the backslash and the look-alikes of the wildcards inside each word", () => {
    expect(textSearchAllWordsCondition(["lesson.title"], "a\\b 50\uFF05")?.parameters).toEqual({
      textSearchWord0: "%a\\\\b%",
      textSearchWord1: "%50\\%%",
    });
  });

  it("drops the NUL characters before it splits, so a NUL never makes a word", () => {
    expect(
      textSearchAllWordsCondition(["lesson.title"], "Ma\u0000ria \u0000 Silva")?.parameters,
    ).toEqual({ textSearchWord0: "%Maria%", textSearchWord1: "%Silva%" });
  });

  it("keeps case and accents: search_normalize handles them in the database", () => {
    expect(textSearchAllWordsCondition(["lesson.title"], "Navegação SEGURA")?.parameters).toEqual({
      textSearchWord0: "%Navegação%",
      textSearchWord1: "%SEGURA%",
    });
  });

  it("returns undefined when the term is blank, null, undefined or only NUL characters", () => {
    expect(textSearchAllWordsCondition(TITLE_AND_SUBJECT, "   ")).toBeUndefined();
    expect(textSearchAllWordsCondition(TITLE_AND_SUBJECT, "")).toBeUndefined();
    expect(textSearchAllWordsCondition(TITLE_AND_SUBJECT, null)).toBeUndefined();
    expect(textSearchAllWordsCondition(TITLE_AND_SUBJECT, undefined)).toBeUndefined();
    expect(textSearchAllWordsCondition(TITLE_AND_SUBJECT, "\u0000 \u0000")).toBeUndefined();
  });

  it("throws when there is no column, even for a blank term", () => {
    expect(() => textSearchAllWordsCondition([], "ana")).toThrow(
      "A search needs at least one column.",
    );
    expect(() => textSearchAllWordsCondition([], undefined)).toThrow(
      "A search needs at least one column.",
    );
  });

  it.each(INVALID_COLUMNS)("throws for the invalid column %j", (column) => {
    expect(() => textSearchAllWordsCondition([column], "ana")).toThrow("Invalid search column");
    expect(() => textSearchAllWordsCondition(["lesson.title", column], undefined)).toThrow(
      "Invalid search column",
    );
  });

  it.each(["term; DROP TABLE lessons", "", "1word", "a b", "a-b"])(
    "throws for the invalid parameter prefix %j, even for a blank term",
    (prefix) => {
      expect(() => textSearchAllWordsCondition(["lesson.title"], "ana", prefix)).toThrow(
        "Invalid search parameter name",
      );
      expect(() => textSearchAllWordsCondition(["lesson.title"], undefined, prefix)).toThrow(
        "Invalid search parameter name",
      );
    },
  );
});

describe("applyTextSearchAllWords", () => {
  it("adds the condition with andWhere, one parameter per word", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    applyTextSearchAllWords(qb, ["lesson.title", "lesson.subject"], "senhas privacidade");

    expect(andWhere).toHaveBeenCalledTimes(1);
    expect(andWhere).toHaveBeenCalledWith(
      textSearchAllWordsCondition(["lesson.title", "lesson.subject"], "senhas privacidade")?.sql,
      { textSearchWord0: "%senhas%", textSearchWord1: "%privacidade%" },
    );
  });

  it("does not touch the query builder when the term is blank, null, undefined or only NULs", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    applyTextSearchAllWords(qb, ["lesson.title"], "   ");
    applyTextSearchAllWords(qb, ["lesson.title"], "");
    applyTextSearchAllWords(qb, ["lesson.title"], null);
    applyTextSearchAllWords(qb, ["lesson.title"], undefined);
    applyTextSearchAllWords(qb, ["lesson.title"], "\u0000\u0000");

    expect(andWhere).not.toHaveBeenCalled();
  });

  it("throws when any parameter it needs is already in the query, and adds nothing", () => {
    for (const taken of ["textSearchWord0", "textSearchWord1"]) {
      const andWhere = jest.fn();
      const qb = {
        andWhere,
        getParameters: jest.fn().mockReturnValue({ [taken]: "%existing%" }),
      } as unknown as SelectQueryBuilder<ObjectLiteral>;

      expect(() => applyTextSearchAllWords(qb, ["lesson.title"], "senhas privacidade")).toThrow(
        `Search parameter "${taken}" is already defined in this query.`,
      );
      expect(andWhere).not.toHaveBeenCalled();
    }
  });

  it("returns the same query builder with and without a term", () => {
    const { qb } = fakeQueryBuilder();

    expect(applyTextSearchAllWords(qb, ["lesson.title"], "ana")).toBe(qb);
    expect(applyTextSearchAllWords(qb, ["lesson.title"], undefined)).toBe(qb);
  });

  it("throws for no column and for an invalid column", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    expect(() => applyTextSearchAllWords(qb, [], "ana")).toThrow(
      "A search needs at least one column.",
    );
    expect(() => applyTextSearchAllWords(qb, ["title"], "ana")).toThrow("Invalid search column");
    expect(andWhere).not.toHaveBeenCalled();
  });

  it("uses the given prefix in the condition", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    applyTextSearchAllWords(qb, ["lesson.title"], "ana maria", "lessonSearch");

    expect(andWhere).toHaveBeenCalledWith(
      `((${wordSql("lesson.title", "lessonSearch0")}) AND (${wordSql("lesson.title", "lessonSearch1")}))`,
      { lessonSearch0: "%ana%", lessonSearch1: "%maria%" },
    );
  });

  it("throws for an invalid parameter prefix", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    expect(() =>
      applyTextSearchAllWords(qb, ["lesson.title"], "ana", "term; DROP TABLE lessons"),
    ).toThrow("Invalid search parameter name");
    expect(andWhere).not.toHaveBeenCalled();
  });

  it("keeps one parameter per word, numbered in the order of the query, next to another search with a different name", () => {
    const qb = realQueryBuilder();

    applyTextSearch(qb, ["person.name"], "ana", "nameTerm");
    applyTextSearchAllWords(qb, ["person.name", "person.ra"], "maria silva", "peopleSearch");

    const [sql, parameters] = qb.getQueryAndParameters();
    expect(qb.getParameters()).toEqual({
      nameTerm: "%ana%",
      peopleSearch0: "%maria%",
      peopleSearch1: "%silva%",
    });
    expect(parameters).toEqual(["%ana%", "%maria%", "%silva%"]);
    expect(sql).toContain(
      "(public.search_normalize(person.name) LIKE public.search_normalize($2) ESCAPE '\\' " +
        "OR public.search_normalize(person.ra) LIKE public.search_normalize($2) ESCAPE '\\')",
    );
    expect(sql).toContain(
      "(public.search_normalize(person.name) LIKE public.search_normalize($3) ESCAPE '\\' " +
        "OR public.search_normalize(person.ra) LIKE public.search_normalize($3) ESCAPE '\\')",
    );
  });

  it("throws when the same search is applied twice to one query builder with the same prefix", () => {
    const qb = realQueryBuilder();

    applyTextSearchAllWords(qb, ["person.name"], "maria silva", "peopleSearch");

    expect(() => applyTextSearchAllWords(qb, ["person.ra"], "maria", "peopleSearch")).toThrow(
      'Search parameter "peopleSearch0" is already defined in this query.',
    );
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

  it("ignores NUL characters like any other character that is not a digit", () => {
    expect(digitsSearchCondition("person.phone", "43\u000099")).toEqual({
      sql: "person.phone LIKE :digitsSearchTerm",
      parameters: { digitsSearchTerm: "%4399%" },
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

  it("uses the given parameter name in the condition", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    applyDigitsSearch(qb, "person.phone", "4399", "phoneTerm");

    expect(andWhere).toHaveBeenCalledWith("person.phone LIKE :phoneTerm", {
      phoneTerm: "%4399%",
    });
  });

  it("keeps one parameter per search when two searches on the same query builder use different parameter names", () => {
    const qb = realQueryBuilder();

    applyDigitsSearch(qb, "person.phone", "4399", "phoneTerm");
    applyDigitsSearch(qb, "person.emergency_phone", "1234", "emergencyTerm");

    expect(qb.getParameters()).toEqual({ phoneTerm: "%4399%", emergencyTerm: "%1234%" });
    expect(qb.getQueryAndParameters()[1]).toEqual(["%4399%", "%1234%"]);
  });

  it("throws for an invalid parameter name", () => {
    const { qb, andWhere } = fakeQueryBuilder();

    expect(() => applyDigitsSearch(qb, "person.phone", "123", "term; DROP")).toThrow(
      "Invalid search parameter name",
    );
    expect(andWhere).not.toHaveBeenCalled();
  });
});
