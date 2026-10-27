import "reflect-metadata";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { EditionsController } from "../controllers/editions.controller";
import { EditionResponseDto } from "../dto/edition.response.dto";
import { EditionsService } from "../services/editions.service";

describe("EditionsController", () => {
  it.each([["listEditions", Permission.CLASSES_VIEW]] as const)(
    "protects %s with %s and no @Roles",
    (name, permission) => {
      const handler = EditionsController.prototype[name];

      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    },
  );

  describe("delegation", () => {
    const editions: EditionResponseDto[] = [
      { id: "01999a3e-7c1b-7000-8000-0000000000e2", name: "2026.2" },
      { id: "01999a3e-7c1b-7000-8000-0000000000e1", name: "2026.1" },
    ];
    const service = { list: jest.fn() };
    const controller = new EditionsController(service as unknown as EditionsService);

    beforeEach(() => {
      jest.clearAllMocks();
      service.list.mockResolvedValue(editions);
    });

    it("delegates listEditions to EditionsService.list", async () => {
      await expect(controller.listEditions()).resolves.toBe(editions);

      expect(service.list).toHaveBeenCalledTimes(1);
      expect(service.list).toHaveBeenCalledWith();
    });
  });
});
