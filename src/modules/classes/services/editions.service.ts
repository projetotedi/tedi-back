import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { EditionResponseDto } from "../dto/edition.response.dto";
import { Edition } from "../entities/edition.entity";

interface EditionRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const EDITION_COLUMNS = `"id", "name", "created_at", "updated_at", "deleted_at"`;

function toEdition(row: EditionRow): Edition {
  return Object.assign(new Edition(), {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

/**
 * The editions of the classes (decision of 30/09: the edition comes in the form of the class, there
 * is no screen to manage them). Exposes the list for the selectors and the find-or-create that
 * `POST /classes` and the edit of a class use.
 */
@Injectable()
export class EditionsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Every edition, the most recent first. It orders by name, not by creation: with the shape
   * "<year>.<term>" (EDITION_NAME_PATTERN) the alphabetical order is the chronological one, and an
   * edition registered late (2026.1 after 2026.2) still lands in its place.
   */
  async list(): Promise<EditionResponseDto[]> {
    const editions = await this.dataSource.getRepository(Edition).find({ order: { name: "DESC" } });

    return editions.map((edition) => ({ id: edition.id, name: edition.name }));
  }

  /**
   * The edition with this name, created when it does not exist. `created` tells which one
   * happened. It always runs on the `manager` of the transaction of the class: if the class fails,
   * the edition it created goes away with it.
   *
   * One statement, `INSERT ... ON CONFLICT ("name") DO NOTHING`, instead of a select followed by an
   * insert, which two requests for the same new edition could both pass. Under READ COMMITTED the
   * insert of the second one waits for the transaction of the first. If that one commits, the
   * insert becomes a DO NOTHING and the select that follows (a new snapshot) sees the row; if it
   * rolls back, the insert goes on and creates the edition. Either way both end with one row.
   *
   * The select does not filter `deleted_at`: the unique index does not either, so a soft-deleted
   * row is still the one the name conflicts with.
   */
  async findOrCreate(
    manager: EntityManager,
    name: string,
  ): Promise<{ edition: Edition; created: boolean }> {
    const inserted: EditionRow[] = await manager.query(
      `INSERT INTO "editions" ("id", "name")
       VALUES ($1, $2)
       ON CONFLICT ("name") DO NOTHING
       RETURNING ${EDITION_COLUMNS}`,
      [uuidv7(), name],
    );
    if (inserted.length > 0) return { edition: toEdition(inserted[0]), created: true };

    const existing: EditionRow[] = await manager.query(
      `SELECT ${EDITION_COLUMNS} FROM "editions" WHERE "name" = $1`,
      [name],
    );
    if (existing.length === 0) {
      throw new Error(`Edition "${name}" conflicted on insert but could not be read.`);
    }

    return { edition: toEdition(existing[0]), created: false };
  }
}
