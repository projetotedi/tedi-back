import { HoursCategoryTotalDto } from "../dto/hours-category-total.response.dto";
import { HoursStatusTotalDto } from "../dto/hours-status-total.response.dto";
import { HoursSummaryResponseDto } from "../dto/hours-summary.response.dto";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";

/** One row of `GROUP BY status, category`, as the database hands it over. */
export interface HoursSummaryRow {
  status: string;
  category: string;
  entries: number;
  declaredMinutes: number;
  validatedMinutes: number;
}

/** The statuses whose validated minutes are in the bank of hours. */
export const BANK_STATUSES: ReadonlySet<string> = new Set([
  HourEntryStatus.APPROVED,
  HourEntryStatus.ADJUSTED,
]);

/**
 * Folds the grouped rows into the summary. Every status and every category starts at zero, in the
 * order of their enums, so a missing one reads 0 and never disappears from the answer.
 *
 * `notes` are the observations of coordination of one member by category (GUS-173); a category
 * without one, and every category of a reading of the team, gets null.
 *
 * A row with a status or a category this code does not know, or with a total that is not a whole
 * number (a `bigint` the query forgot to cast arrives as a string, and `+=` would concatenate it),
 * throws instead of answering: a wrong bank of hours must not be published.
 */
export function buildHoursSummary(
  rows: readonly HoursSummaryRow[],
  period: { from: string | null; to: string | null },
  notes: ReadonlyMap<string, string> = new Map(),
): HoursSummaryResponseDto {
  const byStatus = new Map<string, HoursStatusTotalDto>(
    Object.values(HourEntryStatus).map((status) => [
      status,
      { status, entries: 0, declaredMinutes: 0, validatedMinutes: 0 },
    ]),
  );
  const byCategory = new Map<string, HoursCategoryTotalDto>(
    Object.values(HourEntryCategory).map((category) => [
      category,
      {
        category,
        entries: 0,
        declaredMinutes: 0,
        bankMinutes: 0,
        pendingMinutes: 0,
        note: notes.get(category) ?? null,
      },
    ]),
  );
  let bankMinutes = 0;

  for (const row of rows) {
    const statusTotal = byStatus.get(row.status);
    const categoryTotal = byCategory.get(row.category);
    if (statusTotal === undefined || categoryTotal === undefined) {
      throw new Error(
        `Hours summary row with an unknown status or category: ${row.status}, ${row.category}.`,
      );
    }
    if (
      !Number.isInteger(row.entries) ||
      !Number.isInteger(row.declaredMinutes) ||
      !Number.isInteger(row.validatedMinutes)
    ) {
      throw new Error(`Hours summary row with a total that is not a whole number.`);
    }

    statusTotal.entries += row.entries;
    statusTotal.declaredMinutes += row.declaredMinutes;
    statusTotal.validatedMinutes += row.validatedMinutes;

    categoryTotal.entries += row.entries;
    categoryTotal.declaredMinutes += row.declaredMinutes;
    if (BANK_STATUSES.has(row.status)) {
      categoryTotal.bankMinutes += row.validatedMinutes;
      bankMinutes += row.validatedMinutes;
    }
    if (row.status === HourEntryStatus.PENDING) {
      categoryTotal.pendingMinutes += row.declaredMinutes;
    }
  }

  return {
    from: period.from,
    to: period.to,
    bankMinutes,
    byStatus: [...byStatus.values()],
    byCategory: [...byCategory.values()],
  };
}
