import { Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";

/**
 * One row of the history of an hour entry: who did what to it, when, and from what to what. The
 * history cannot be edited or deleted: the trigger `trg_hour_entry_events_append_only` answers
 * 23001 to any UPDATE or DELETE, so `updated_at` and `deleted_at` never change after the insert.
 * Read in the order `created_at, id`.
 *
 * `fromStatus`/`toStatus` and `fromMinutes`/`toMinutes` say what changed: a creation goes from
 * nothing to `pending` and the declared minutes; a removal goes from `pending` and the declared
 * minutes to nothing. The statuses reuse the Postgres enum of `hour_entries`. `note` is the
 * justification or the reason of a review (GUS-164): free text (RNF-13).
 *
 * The foreign keys are declared by table name, as in HourEntry. The one to `hour_entries` is
 * `NO ACTION`: an entry with history is never deleted, only soft deleted.
 */
@Entity({ name: "hour_entry_events" })
@Index("idx_hour_entry_events_hour_entry_id", ["hourEntryId"])
@ForeignKey("hour_entries", ["hour_entry_id"], ["id"], {
  name: "fk_hour_entry_events_hour_entry_id",
})
@ForeignKey("people", ["actor_id"], ["id"], { name: "fk_hour_entry_events_actor_id" })
export class HourEntryEvent extends BaseEntity {
  @Column({ name: "hour_entry_id", type: "uuid" })
  hourEntryId: string;

  @Column({
    name: "type",
    type: "enum",
    enum: HourEntryEventType,
    enumName: "hour_entry_events_type_enum",
  })
  type: HourEntryEventType;

  /** Who did it. */
  @Column({ name: "actor_id", type: "uuid" })
  actorId: string;

  @Column({
    name: "from_status",
    type: "enum",
    enum: HourEntryStatus,
    enumName: "hour_entries_status_enum",
    nullable: true,
    default: null,
  })
  fromStatus: HourEntryStatus | null;

  @Column({
    name: "to_status",
    type: "enum",
    enum: HourEntryStatus,
    enumName: "hour_entries_status_enum",
    nullable: true,
    default: null,
  })
  toStatus: HourEntryStatus | null;

  @Column({ name: "from_minutes", type: "integer", nullable: true, default: null })
  fromMinutes: number | null;

  @Column({ name: "to_minutes", type: "integer", nullable: true, default: null })
  toMinutes: number | null;

  @Column({ name: "note", type: "text", nullable: true, default: null })
  note: string | null;
}
