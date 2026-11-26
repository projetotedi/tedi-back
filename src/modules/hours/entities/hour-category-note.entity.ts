import { Check, Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";

/** The longest observation, in characters. */
export const HOUR_CATEGORY_NOTE_MAX_LENGTH = 500;

/**
 * The observation of coordination on the hours of a member in one category (GUS-173): free text
 * shown in the column OBSERVAÇÃO of the table "Horas por categoria", in Meu perfil and in the hours
 * of the member. One per person and category, with no period: the bank of hours is cumulative
 * (Q6.9), so the same observation shows whatever period is read.
 *
 * Clearing it keeps the row with `note` null, so who last touched it and when stay. The unique index
 * is partial (`deleted_at IS NULL`) by the convention of the repository, though no row is ever
 * soft-deleted. The category reuses `hour_entries_category_enum`. The foreign keys to `people` are
 * declared by table name, as in HourEntry.
 */
@Entity({ name: "hour_category_notes" })
@Index("uq_hour_category_notes_person_id_category", ["personId", "category"], {
  unique: true,
  where: `"deleted_at" IS NULL`,
})
@Check("ck_hour_category_notes_note", `"note" IS NULL OR length(btrim("note")) > 0`)
@ForeignKey("people", ["person_id"], ["id"], { name: "fk_hour_category_notes_person_id" })
@ForeignKey("people", ["updated_by_id"], ["id"], { name: "fk_hour_category_notes_updated_by_id" })
export class HourCategoryNote extends BaseEntity {
  /** Whose hours the observation is about. */
  @Column({ name: "person_id", type: "uuid" })
  personId: string;

  @Column({
    name: "category",
    type: "enum",
    enum: HourEntryCategory,
    enumName: "hour_entries_category_enum",
  })
  category: HourEntryCategory;

  /** Free text of coordination (RNF-13): it never goes to an audit event. Null once cleared. */
  @Column({ name: "note", type: "varchar", length: HOUR_CATEGORY_NOTE_MAX_LENGTH, nullable: true })
  note: string | null;

  /** Who wrote or cleared it last. */
  @Column({ name: "updated_by_id", type: "uuid" })
  updatedById: string;
}
