import { MemberRefDto } from "@modules/people/dto/member-ref.response.dto";
import { HoursPeriodQueryDto } from "../dto/hours-period-query.dto";
import { HourEntry } from "../entities/hour-entry.entity";

/** Entries read from the database per round trip of the export. */
export const HOURS_EXPORT_BATCH_SIZE = 500;

/** The Excel of pt-BR reads the accents of a UTF-8 file only with the byte order mark. */
export const CSV_BOM = "﻿";
/** `;` opens straight in the Excel of pt-BR, where `,` is the decimal separator. */
export const CSV_SEPARATOR = ";";
export const CSV_LINE_END = "\r\n";

/** The columns of the export, stable names in English; enum values go as their codes. */
export const HOURS_CSV_HEADER: readonly string[] = [
  "entry_id",
  "date",
  "person_id",
  "member_name",
  "department",
  "category",
  "activity",
  "origin",
  "status",
  "declared_minutes",
  "validated_minutes",
  "review_note",
  "reviewed_at",
];

/** The first characters that make a spreadsheet read a cell as a formula (OWASP CSV Injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

export type CsvValue = string | number | null;

/**
 * One cell: always between quotes, with every quote doubled, so a separator or a line break inside
 * the text stays in the cell. A text that starts like a formula gets an apostrophe in front, so the
 * spreadsheet shows it and never runs it. Null is an empty cell; a number goes as it is.
 */
export function csvCell(value: CsvValue): string {
  if (value === null) return '""';
  if (typeof value === "number") return `"${value}"`;
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${text.replaceAll('"', '""')}"`;
}

/** One line of the file, with its line end. */
export function csvLine(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(CSV_SEPARATOR) + CSV_LINE_END;
}

/**
 * The values of an entry in the order of HOURS_CSV_HEADER. The date stays YYYY-MM-DD and the
 * instant of the review goes in ISO 8601 (UTC). The notes of the person are not exported (RNF-10).
 * A member that is not found leaves her name and department empty.
 */
export function toHoursCsvValues(entry: HourEntry, member: MemberRefDto | null): CsvValue[] {
  return [
    entry.id,
    entry.date,
    entry.personId,
    member === null ? null : member.name,
    member === null || member.department === null ? null : member.department.name,
    entry.category,
    entry.activity,
    entry.origin,
    entry.status,
    entry.declaredMinutes,
    entry.validatedMinutes,
    entry.reviewNote,
    entry.reviewedAt === null ? null : entry.reviewedAt.toISOString(),
  ];
}

/**
 * `hours_<from>_<to>.csv`, with `start` and `end` for open ends. The dates already passed
 * IsCalendarDate, so nothing reaches the Content-Disposition header but digits and dashes.
 */
export function hoursExportFileName(period: HoursPeriodQueryDto): string {
  return `hours_${period.from ?? "start"}_${period.to ?? "end"}.csv`;
}
