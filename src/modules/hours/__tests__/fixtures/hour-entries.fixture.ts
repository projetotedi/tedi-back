import { DataSource } from "typeorm";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";

/**
 * Fixtures of the hours module for its e2e. Only the tables of this module: the people and the
 * departments come from the services and the fixtures of `people`.
 */

/** A day in the past for every entry that does not care about the day. */
export const PAST_DAY = "2026-03-10";

/**
 * The body of the card: 2h30 (150 minutes) of planning on a past day, without notes. `overrides`
 * win over every default.
 */
export function hourEntryBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activity: "Planejamento da aula de teclado e mouse",
    category: "planning",
    date: PAST_DAY,
    declaredMinutes: 150,
    ...overrides,
  };
}

/** Tomorrow in APP_TIME_ZONE, by the real clock: the first day the routes refuse. */
export function tomorrowInAppTimeZone(): string {
  return todayInAppTimeZone(new Date(Date.now() + 86_400_000));
}

/**
 * Reviews an entry by hand, as the review of coordination (GUS-164) will: a raw UPDATE, since no
 * route of this card does it.
 */
export async function reviewEntry(
  dataSource: DataSource,
  hourEntryId: string,
  review: {
    status: "approved" | "adjusted" | "rejected";
    validatedMinutes: number | null;
    reviewNote: string | null;
    reviewedById: string;
  },
): Promise<void> {
  await dataSource.query(
    `UPDATE hour_entries
        SET status = $2, validated_minutes = $3, review_note = $4, reviewed_by_id = $5,
            reviewed_at = now()
      WHERE id = $1`,
    [hourEntryId, review.status, review.validatedMinutes, review.reviewNote, review.reviewedById],
  );
}

/** One row of the history of an entry, as stored. */
export interface HourEntryEventRow {
  type: string;
  actor_id: string;
  from_status: string | null;
  to_status: string | null;
  from_minutes: number | null;
  to_minutes: number | null;
  note: string | null;
  created_at: Date;
}

/** The history of an entry, in the order it is read: `created_at, id`. */
export function eventsOf(
  dataSource: DataSource,
  hourEntryId: string,
): Promise<HourEntryEventRow[]> {
  return dataSource.query(
    `SELECT type, actor_id, from_status, to_status, from_minutes, to_minutes, note, created_at
       FROM hour_entry_events
      WHERE hour_entry_id = $1
      ORDER BY created_at, id`,
    [hourEntryId],
  );
}

/** The row of an entry, removed or not. */
export interface HourEntryRow {
  id: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export async function entryRow(
  dataSource: DataSource,
  hourEntryId: string,
): Promise<HourEntryRow | undefined> {
  const rows: HourEntryRow[] = await dataSource.query(
    `SELECT id, status, created_at, updated_at, deleted_at FROM hour_entries WHERE id = $1`,
    [hourEntryId],
  );
  return rows[0];
}

/** How many entries exist, removed included. */
export async function countEntries(dataSource: DataSource): Promise<number> {
  const rows: Array<{ count: number }> = await dataSource.query(
    `SELECT COUNT(*)::int AS count FROM hour_entries`,
  );
  return rows[0].count;
}
