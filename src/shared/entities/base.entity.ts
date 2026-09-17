import { v7 as uuidv7 } from "uuid";
import {
  BeforeInsert,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Abstract base class for all domain entities.
 * Provides a UUID v7 primary key (generated in the app, never by the DB),
 * soft-delete via deletedAt, and standard timestamp columns.
 */
export abstract class BaseEntity {
  @PrimaryColumn({ type: "uuid" })
  id: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt: Date | null;

  @BeforeInsert()
  protected assignUuidV7(): void {
    if (!this.id) {
      this.id = uuidv7();
    }
  }
}
