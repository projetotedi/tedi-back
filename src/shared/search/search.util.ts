import { ObjectLiteral, SelectQueryBuilder } from "typeorm";

export interface SearchCondition {
  sql: string;
  parameters: Record<string, string>;
}

const COLUMN_REFERENCE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
  if (typeof input !== "string") return undefined;

  const collapsed = input.trim().replace(/\s+/g, " ");
  if (collapsed === "") return undefined;

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
  if (normalized === undefined) return undefined;

  const predicates = columns.map(
    (column) => `search_normalize(${column}) LIKE search_normalize(:${parameterName}) ESCAPE '\\'`,
  );

  return {
    sql: `(${predicates.join(" OR ")})`,
    parameters: { [parameterName]: `%${normalized}%` },
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
  if (digits === "") return undefined;

  return {
    sql: `${column} LIKE :${parameterName}`,
    parameters: { [parameterName]: `%${digits}%` },
  };
}

export function applyTextSearch<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  columns: readonly string[],
  term: string | null | undefined,
): SelectQueryBuilder<T> {
  const condition = textSearchCondition(columns, term);
  if (condition) qb.andWhere(condition.sql, condition.parameters);
  return qb;
}

export function applyDigitsSearch<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  column: string,
  term: string | null | undefined,
): SelectQueryBuilder<T> {
  const condition = digitsSearchCondition(column, term);
  if (condition) qb.andWhere(condition.sql, condition.parameters);
  return qb;
}
