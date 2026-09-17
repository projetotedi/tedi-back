import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { HealthController } from "@shared/health/health.controller";
import { buildDocument } from "@shared/swagger/swagger.util";

describe("swagger.util", () => {
  describe("buildDocument", () => {
    it("sets operationId to the method name (CA2: check, not HealthController_check)", async () => {
      const module = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          {
            provide: DataSource,
            useValue: { query: jest.fn() },
          },
        ],
      }).compile();

      const app = module.createNestApplication();
      await app.init();

      const doc = buildDocument(app);

      expect(doc.paths["/health"].get?.operationId).toBe("check");

      await app.close();
    });

    it("tags the /health endpoint with 'health'", async () => {
      const module = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          {
            provide: DataSource,
            useValue: { query: jest.fn() },
          },
        ],
      }).compile();

      const app = module.createNestApplication();
      await app.init();

      const doc = buildDocument(app);

      expect(doc.paths["/health"].get?.tags).toContain("health");

      await app.close();
    });
  });
});
