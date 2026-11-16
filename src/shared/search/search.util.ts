import { ObjectLiteral, SelectQueryBuilder } from "typeorm";

export interface SearchCondition {
  sql: string;
  parameters: Record<string, string>;
}

const COLUMN_REFERENCE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const NUL_CHARACTER = "\u0000";
const BACKSLASH_LOOKALIKES = /[\u2216\uFE68\uFF3C]/g;
const PERCENT_LOOKALIKES = /[\uFE6A\uFF05]/g;
const UNDERSCORE_LOOKALIKES = /\uFF3F/g;
const LIKE_WILDCARDS = /[\\%_]/g;

function assertColumns(columns: readonly string[]): void {
  if (columns.length === 0) {
    throw new Error("A search needs at least one column.");
  }
  for (const column of columns) {
    if (!COLUMN_REFERENCE.test(column)) {
      throw new Error(`Invalid search column "${column}": expected "alias.column".`);
    }
  }
}

function assertParameterName(parameterName: string): void {
  if (!PARAMETER_NAME.test(parameterName)) {
    throw new Error(`Invalid search parameter name "${parameterName}".`);
  }
}

export function normalizeSearchTerm(input: string | null | undefined): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }

  const collapsed = input.replaceAll(NUL_CHARACTER, "").trim().replace(/\s+/g, " ");

  if (collapsed === "") {
    return undefined;
  }

  return collapsed
    .replace(BACKSLASH_LOOKALIKES, "\\")
    .replace(PERCENT_LOOKALIKES, "%")
    .replace(UNDERSCORE_LOOKALIKES, "_")
    .replace(LIKE_WILDCARDS, "\\$&");
}

export function textSearchCondition(
  columns: readonly string[],
  term: string | null | undefined,
  parameterName = "textSearchTerm",
): SearchCondition | undefined {
  assertColumns(columns);
  assertParameterName(parameterName);

  const normalized = normalizeSearchTerm(term);

  if (normalized === undefined) {
    return undefined;
  }

  const predicates = columns.map(
    (column) =>
      `public.search_normalize(${column}) LIKE public.search_normalize(:${parameterName}) ESCAPE '\\'`,
  );

  return {
    sql: `(${predicates.join(" OR ")})`,
    parameters: { [parameterName]: `%${normalized}%` },
  };
}

/**
 * Word search: every word of the term has to show up, each one in ANY of the columns, in any
 * order. "senhas privacidade" finds the title "Senhas e privacidade" and also a lesson titled
 * "Segurança" whose subject is "Privacidade e senhas", because the words do not have to be next to
 * each other nor in the same column. `textSearchCondition` is the other one: it looks for the term
 * as a single stretch of text, so it does not find "senhas privacidade" in "Senhas e privacidade".
 *
 * The term is normalized (trimmed, spaces collapsed, `%` `_` and `\` escaped) and split on spaces.
 * A word that comes twice is looked for once. Word `i` gets the parameter `<parameterPrefix><i>`,
 * counted from 0, and the words are joined with AND. The SQL is the same expression that
 * `textSearchCondition` builds and the same one the GIN index covers, so the trigram indexes keep
 * serving each word (a word of fewer than three characters has no trigram and scans).
 *
 * With more than one word the result is wrapped in one more pair of parentheses, so it is a single
 * boolean group wherever it goes. Returns undefined for a blank term.
 */
export function textSearchAllWordsCondition(
  columns: readonly string[],
  term: string | null | undefined,
  parameterPrefix = "textSearchWord",
): SearchCondition | undefined {
  assertColumns(columns);
  assertParameterName(parameterPrefix);

  const normalized = normalizeSearchTerm(term);

  if (normalized === undefined) {
    return undefined;
  }

  const words = [...new Set(normalized.split(" "))];
  const parameters: Record<string, string> = {};

  const wordConditions = words.map((word, index) => {
    const parameterName = `${parameterPrefix}${index}`;
    parameters[parameterName] = `%${word}%`;

    const predicates = columns.map(
      (column) =>
        `public.search_normalize(${column}) LIKE public.search_normalize(:${parameterName}) ESCAPE '\\'`,
    );

    return `(${predicates.join(" OR ")})`;
  });

  return {
    sql: wordConditions.length === 1 ? wordConditions[0] : `(${wordConditions.join(" AND ")})`,
    parameters,
  };
}

export function digitsSearchCondition(
  column: string,
  term: string | null | undefined,
  parameterName = "digitsSearchTerm",
): SearchCondition | undefined {
  assertColumns([column]);
  assertParameterName(parameterName);

  const digits = typeof term === "string" ? term.replace(/\D/g, "") : "";

  if (digits === "") {
    return undefined;
  }

  return {
    sql: `${column} LIKE :${parameterName}`,
    parameters: { [parameterName]: `%${digits}%` },
  };
}

export function applyTextSearch<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  columns: readonly string[],
  term: string | null | undefined,
  parameterName?: string,
): SelectQueryBuilder<T> {
  const condition = textSearchCondition(columns, term, parameterName);

  if (condition) {
    assertParametersAvailable(qb, condition.parameters);
    qb.andWhere(condition.sql, condition.parameters);
  }

  return qb;
}

/**
 * Adds `textSearchAllWordsCondition` to the query with `andWhere`. Throws when any of the
 * parameters it needs (`<parameterPrefix>0`, `<parameterPrefix>1`...) is already in the query, and
 * does nothing for a blank term.
 */
export function applyTextSearchAllWords<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  columns: readonly string[],
  term: string | null | undefined,
  parameterPrefix?: string,
): SelectQueryBuilder<T> {
  const condition = textSearchAllWordsCondition(columns, term, parameterPrefix);

  if (condition) {
    assertParametersAvailable(qb, condition.parameters);
    qb.andWhere(condition.sql, condition.parameters);
  }

  return qb;
}

export function applyDigitsSearch<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  column: string,
  term: string | null | undefined,
  parameterName?: string,
): SelectQueryBuilder<T> {
  const condition = digitsSearchCondition(column, term, parameterName);

  if (condition) {
    assertParametersAvailable(qb, condition.parameters);
    qb.andWhere(condition.sql, condition.parameters);
  }

  return qb;
}

function assertParametersAvailable<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  parameters: Record<string, string>,
): void {
  const existingParameters = qb.getParameters();

  for (const parameterName of Object.keys(parameters)) {
    if (Object.hasOwn(existingParameters, parameterName)) {
      throw new Error(`Search parameter "${parameterName}" is already defined in this query.`);
    }
  }
}
