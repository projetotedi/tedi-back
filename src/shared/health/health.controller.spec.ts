import { HealthController } from "./health.controller";
import { PUBLIC_KEY } from "@shared/decorators/public.decorator";

describe("HealthController", () => {
  describe("GET /health metadata", () => {
    it("has @Public() metadata set on check() (auth:public === true)", () => {
      const meta = Reflect.getMetadata(PUBLIC_KEY, HealthController.prototype.check);
      expect(meta).toBe(true);
    });
  });
});
