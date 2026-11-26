import { MemberRefDto } from "@modules/people/dto/member-ref.response.dto";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { HourEntryEventResponseDto } from "../dto/hour-entry-event.response.dto";
import { HoursMemberTotalDto } from "../dto/hours-member-total.response.dto";
import { MemberHourEntryResponseDto } from "../dto/member-hour-entry.response.dto";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { toHourEntryResponse } from "./hour-entry-response.mapper";

/** One row of the overview, `GROUP BY person_id`, as the database hands it over. */
export interface HoursMemberRow {
  personId: string;
  entries: number;
  declaredMinutes: number;
  bankMinutes: number;
  pendingEntries: number;
  pendingMinutes: number;
}

/**
 * A line of the overview. A total that is not a whole number (a `bigint` the query forgot to cast
 * arrives as a string) throws instead of answering: a wrong bank of hours must not be published.
 */
export function toHoursMemberTotal(
  row: HoursMemberRow,
  member: MemberRefDto | null,
): HoursMemberTotalDto {
  const totals = [
    row.entries,
    row.declaredMinutes,
    row.bankMinutes,
    row.pendingEntries,
    row.pendingMinutes,
  ];
  if (!totals.every((total) => Number.isInteger(total))) {
    throw new Error("Hours overview row with a total that is not a whole number.");
  }

  return {
    personId: row.personId,
    member,
    entries: row.entries,
    declaredMinutes: row.declaredMinutes,
    bankMinutes: row.bankMinutes,
    pendingEntries: row.pendingEntries,
    pendingMinutes: row.pendingMinutes,
  };
}

/** An entry of the queue: the answer of the entry, field by field, and whose it is. */
export function toMemberHourEntry(
  entry: HourEntry,
  member: MemberRefDto | null,
  cancelledLessonIds: ReadonlySet<string>,
): MemberHourEntryResponseDto {
  return { ...toHourEntryResponse(entry, cancelledLessonIds), member };
}

/**
 * A row of the history, copied field by field: the entity has columns the contract does not show
 * (`updatedAt`, `deletedAt`), and a spread would publish whatever column comes next.
 */
export function toHourEntryEventResponse(
  event: HourEntryEvent,
  actor: PersonRefDto | null,
): HourEntryEventResponseDto {
  return {
    id: event.id,
    hourEntryId: event.hourEntryId,
    type: event.type,
    actor,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    fromMinutes: event.fromMinutes,
    toMinutes: event.toMinutes,
    note: event.note,
    createdAt: event.createdAt,
  };
}
