import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { DataSource, EntityManager } from "typeorm";
import { Edition } from "../entities/edition.entity";
import { EditionsService } from "../services/editions.service";

const EDITION_ID = "01999a3e-7c1b-7000-8000-0000000000e1";
const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
const UPDATED_AT = new Date("2026-09-02T12:00:00.000Z");

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function editionRow(name: string, id = EDITION_ID) {
  return { id, name, created_at: CREATED_AT, updated_at: UPDATED_AT, deleted_at: null };
}

describe("EditionsService", () => {
  let service: EditionsService;

  const manager = { query: jest.fn() };
  const repository = { find: jest.fn() };
  const dataSource = { getRepository: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    dataSource.getRepository.mockReturnValue(repository);

    const moduleRef = await Test.createTestingModule({
      providers: [EditionsService, { provide: DataSource, useValue: dataSource }],
    }).compile();

    service = moduleRef.get(EditionsService);
  });

  describe("findOrCreate()", () => {
    const asManager = () => manager as unknown as EntityManager;

    it("inserts and returns created=true when ON CONFLICT returns a row", async () => {
      manager.query.mockResolvedValueOnce([editionRow("2026.2")]);

      const result = await service.findOrCreate(asManager(), "2026.2");

      expect(result.created).toBe(true);
      expect(result.edition).toBeInstanceOf(Edition);
      expect(result.edition).toMatchObject({
        id: EDITION_ID,
        name: "2026.2",
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        deletedAt: null,
      });
      expect(manager.query).toHaveBeenCalledTimes(1);

      const [sql, parameters] = manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO "editions"');
      expect(sql).toContain('ON CONFLICT ("name") DO NOTHING');
      expect(sql).toContain("RETURNING");
      expect(parameters).toEqual([expect.stringMatching(UUID_V7), "2026.2"]);
    });

    it("selects the existing edition and returns created=false on conflict", async () => {
      manager.query.mockResolvedValueOnce([]).mockResolvedValueOnce([editionRow("2026.1")]);

      const result = await service.findOrCreate(asManager(), "2026.1");

      expect(result.created).toBe(false);
      expect(result.edition).toBeInstanceOf(Edition);
      expect(result.edition).toMatchObject({ id: EDITION_ID, name: "2026.1" });
      expect(manager.query).toHaveBeenCalledTimes(2);

      const [sql, parameters] = manager.query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('FROM "editions"');
      expect(sql).toContain('WHERE "name" = $1');
      expect(parameters).toEqual(["2026.1"]);
    });

    it("does not filter deleted_at when it reads the edition it conflicted with", async () => {
      manager.query.mockResolvedValueOnce([]).mockResolvedValueOnce([editionRow("2026.1")]);

      await service.findOrCreate(asManager(), "2026.1");

      // The unique index covers soft-deleted rows too: the row the name conflicts with may be one.
      const [sql] = manager.query.mock.calls[1] as [string];
      expect(sql).not.toContain("deleted_at IS NULL");
    });

    it("gives each new edition its own id", async () => {
      manager.query.mockResolvedValue([editionRow("2026.2")]);

      await service.findOrCreate(asManager(), "2026.2");
      await service.findOrCreate(asManager(), "2026.3");

      const first = (manager.query.mock.calls[0] as [string, string[]])[1][0];
      const second = (manager.query.mock.calls[1] as [string, string[]])[1][0];
      expect(first).not.toBe(second);
    });

    it("runs on the manager it receives and never opens a connection of its own", async () => {
      manager.query.mockResolvedValueOnce([editionRow("2026.2")]);

      await service.findOrCreate(asManager(), "2026.2");

      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it("fails loudly when the name conflicted but the row cannot be read", async () => {
      manager.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await expect(service.findOrCreate(asManager(), "2026.1")).rejects.toThrow(
        'Edition "2026.1" conflicted on insert but could not be read.',
      );
    });

    it("lets a database error reach the caller, so the transaction of the class rolls back", async () => {
      const boom = new Error("connection lost");
      manager.query.mockRejectedValueOnce(boom);

      await expect(service.findOrCreate(asManager(), "2026.1")).rejects.toBe(boom);
      expect(manager.query).toHaveBeenCalledTimes(1);
    });
  });

  describe("list()", () => {
    it("orders by name, the most recent first, and maps to id and name", async () => {
      repository.find.mockResolvedValue([
        Object.assign(new Edition(), editionRow("2026.2", "id-2")),
        Object.assign(new Edition(), editionRow("2026.1", "id-1")),
      ]);

      const result = await service.list();

      expect(dataSource.getRepository).toHaveBeenCalledWith(Edition);
      expect(repository.find).toHaveBeenCalledWith({ order: { name: "DESC" } });
      expect(result).toEqual([
        { id: "id-2", name: "2026.2" },
        { id: "id-1", name: "2026.1" },
      ]);
    });

    it("exposes only id and name, never the columns of the entity", async () => {
      repository.find.mockResolvedValue([
        Object.assign(new Edition(), {
          id: EDITION_ID,
          name: "2026.1",
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
          deletedAt: null,
        }),
      ]);

      const [edition] = await service.list();

      expect(Object.keys(edition).sort()).toEqual(["id", "name"]);
    });

    it("answers an empty list when there is no edition", async () => {
      repository.find.mockResolvedValue([]);

      await expect(service.list()).resolves.toEqual([]);
    });
  });
});
