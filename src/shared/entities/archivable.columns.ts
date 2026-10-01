import { Column } from "typeorm";

export const ARCHIVE_REASON_MAX_LENGTH = 500;

/**
 * Reusable "archive instead of delete" columns (RN-27): students, lesson plans, courses, classes.
 * Use with `@Column(() => ArchivableColumns, { prefix: false }) archive: ArchivableColumns;`
 * and declare the archived_by_id FK on the entity class (see docs/ARCHITECTURE.md section 10):
 * a @ForeignKey on a property of this embedded is ignored by TypeORM.
 */
export class ArchivableColumns {
  @Column({ name: "archived_at", type: "timestamptz", nullable: true, default: null })
  archivedAt: Date | null;

  @Column({ name: "archived_by_id", type: "uuid", nullable: true, default: null })
  archivedById: string | null;

  @Column({ name: "archive_reason", type: "text", nullable: true, default: null })
  archiveReason: string | null;
}

export function isArchived(columns: ArchivableColumns | null | undefined): boolean {
  return columns?.archivedAt != null;
}

/** Archives in place. No-op returning false when already archived: the first archive wins. */
export function markArchived(
  columns: ArchivableColumns,
  actorId: string,
  reason: string | null,
  now: Date,
): boolean {
  if (isArchived(columns)) return false;

  columns.archivedAt = now;
  columns.archivedById = actorId;
  columns.archiveReason = reason;
  return true;
}

/** Clears the three columns. No-op returning false when not archived. */
export function markUnarchived(columns: ArchivableColumns): boolean {
  if (!isArchived(columns)) return false;

  columns.archivedAt = null;
  columns.archivedById = null;
  columns.archiveReason = null;
  return true;
}
