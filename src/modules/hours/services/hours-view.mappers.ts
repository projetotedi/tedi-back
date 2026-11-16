import { MemberRefDto } from "@modules/people/dto/member-ref.response.dto";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { HourEntryEventResponseDto } from "../dto/hour-entry-event.response.dto";
import { MemberHourEntryResponseDto } from "../dto/member-hour-entry.response.dto";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { toHourEntryResponse } from "./hour-entry-response.mapper";

/** An entry of the queue: the answer of the entry, field by field, and whose it is. */
export function toMemberHourEntry(
  entry: HourEntry,
  member: MemberRefDto | null,
): MemberHourEntryResponseDto {
  return { ...toHourEntryResponse(entry), member };
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
