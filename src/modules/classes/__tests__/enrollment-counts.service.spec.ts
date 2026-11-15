import "reflect-metadata";
import { EntityManager } from "typeorm";
import { EnrollmentCountsService } from "../services/enrollment-counts.service";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const OTHER_CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c2";

describe("EnrollmentCountsService", () => {
  const manager = { query: jest.fn(), getRepository: jest.fn(), createQueryBuilder: jest.fn() };
  const service = new EnrollmentCountsService();

  beforeEach(() => jest.clearAllMocks());

  it("countActive is 0 until GUS-108", async () => {
    await expect(service.countActive(manager as unknown as EntityManager, CLASS_ID)).resolves.toBe(
      0,
    );
  });

  it("countActiveByClass answers an empty map until GUS-108, so every class reads as 0", async () => {
    const counts = await service.countActiveByClass(manager as unknown as EntityManager, [
      CLASS_ID,
      OTHER_CLASS_ID,
    ]);

    expect(counts).toBeInstanceOf(Map);
    expect(counts.size).toBe(0);
    expect(counts.get(CLASS_ID) ?? 0).toBe(0);
    expect(counts.get(OTHER_CLASS_ID) ?? 0).toBe(0);
  });

  it("answers an empty map for no classes at all", async () => {
    const counts = await service.countActiveByClass(manager as unknown as EntityManager, []);

    expect(counts.size).toBe(0);
  });

  it("does not touch the database while there is no enrollment table", async () => {
    await service.countActive(manager as unknown as EntityManager, CLASS_ID);
    await service.countActiveByClass(manager as unknown as EntityManager, [CLASS_ID]);

    expect(manager.query).not.toHaveBeenCalled();
    expect(manager.getRepository).not.toHaveBeenCalled();
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
  });
});
