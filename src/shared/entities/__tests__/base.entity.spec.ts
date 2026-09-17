import "reflect-metadata";
import { getMetadataArgsStorage } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";

// Concrete subclass used only in tests — no @Entity decorator needed for unit tests.
class TestEntity extends BaseEntity {}

function callAssignUuidV7(entity: BaseEntity): void {
  (entity as unknown as { assignUuidV7(): void }).assignUuidV7();
}

describe("BaseEntity", () => {
  describe("assignUuidV7", () => {
    it("generates a valid UUID v7 when id is not set", () => {
      const entity = new TestEntity();
      callAssignUuidV7(entity);

      expect(entity.id).toBeDefined();
      expect(entity.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("UUID version byte is 7", () => {
      const entity = new TestEntity();
      callAssignUuidV7(entity);
      // Position 14 in the canonical UUID string is the version nibble.
      expect(entity.id.charAt(14)).toBe("7");
    });

    it("does not overwrite an existing id", () => {
      const entity = new TestEntity();
      entity.id = "00000000-0000-7000-8000-000000000001";
      callAssignUuidV7(entity);
      expect(entity.id).toBe("00000000-0000-7000-8000-000000000001");
    });

    it("generates lexicographically increasing ids in sequence", () => {
      const first = new TestEntity();
      callAssignUuidV7(first);

      const second = new TestEntity();
      callAssignUuidV7(second);

      // UUID v7 is time-ordered; two ids generated in sequence should be increasing.
      expect(second.id >= first.id).toBe(true);
    });
  });

  describe("TypeORM column metadata", () => {
    it("registers the expected column names via getMetadataArgsStorage", () => {
      // The metadata is registered at class-definition time via decorators.
      const storage = getMetadataArgsStorage();
      const allColumns = storage.columns.filter((c) => {
        const target = c.target as Function;
        return target === BaseEntity || target.prototype instanceof BaseEntity;
      });

      const names = allColumns.map((c) => (c.options as { name?: string }).name ?? c.propertyName);
      expect(names).toContain("created_at");
      expect(names).toContain("updated_at");
      expect(names).toContain("deleted_at");

      const primaryCols = allColumns.filter((c) => c.propertyName === "id");
      expect(primaryCols.length).toBeGreaterThan(0);
    });
  });
});
