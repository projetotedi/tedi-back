import "reflect-metadata";
import { getMetadataArgsStorage } from "typeorm";
import { ArchivableColumns, isArchived, markArchived, markUnarchived } from "../archivable.columns";

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const OTHER_ACTOR_ID = "01999a3e-0000-7000-8000-0000000000bb";
const NOW = new Date("2026-10-01T13:00:00.000Z");

function active(): ArchivableColumns {
  const columns = new ArchivableColumns();
  columns.archivedAt = null;
  columns.archivedById = null;
  columns.archiveReason = null;
  return columns;
}

describe("ArchivableColumns", () => {
  it("maps archived_at, archived_by_id and archive_reason as nullable columns", () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === ArchivableColumns,
    );

    expect(
      columns.map((column) => ({
        property: column.propertyName,
        name: column.options.name,
        type: column.options.type,
        nullable: column.options.nullable,
      })),
    ).toEqual([
      { property: "archivedAt", name: "archived_at", type: "timestamptz", nullable: true },
      { property: "archivedById", name: "archived_by_id", type: "uuid", nullable: true },
      { property: "archiveReason", name: "archive_reason", type: "text", nullable: true },
    ]);
  });

  it("markArchived sets date, actor and reason and returns true", () => {
    const columns = active();

    expect(markArchived(columns, ACTOR_ID, "Mudou de cidade.", NOW)).toBe(true);

    expect(columns.archivedAt).toBe(NOW);
    expect(columns.archivedById).toBe(ACTOR_ID);
    expect(columns.archiveReason).toBe("Mudou de cidade.");
    expect(isArchived(columns)).toBe(true);
  });

  it("markArchived keeps the first archive and returns false when already archived", () => {
    const columns = active();
    markArchived(columns, ACTOR_ID, "first", NOW);

    const later = new Date("2026-10-02T09:00:00.000Z");
    expect(markArchived(columns, OTHER_ACTOR_ID, "second", later)).toBe(false);

    expect(columns.archivedAt).toBe(NOW);
    expect(columns.archivedById).toBe(ACTOR_ID);
    expect(columns.archiveReason).toBe("first");
  });

  it("markUnarchived clears the three columns and returns true", () => {
    const columns = active();
    markArchived(columns, ACTOR_ID, "reason", NOW);

    expect(markUnarchived(columns)).toBe(true);

    expect(columns.archivedAt).toBeNull();
    expect(columns.archivedById).toBeNull();
    expect(columns.archiveReason).toBeNull();
    expect(isArchived(columns)).toBe(false);
  });

  it("markUnarchived returns false when not archived", () => {
    expect(markUnarchived(active())).toBe(false);
  });
});
