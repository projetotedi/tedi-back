import "reflect-metadata";
import { HttpException, RequestMethod } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { MyHoursController } from "../controllers/my-hours.controller";
import { CreateHourEntryDto } from "../dto/create-hour-entry.dto";
import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HoursService } from "../services/hours.service";

const ENTRY_ID = "01999a3e-7c1b-7000-8000-000000000a01";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.MEMBER,
  accessEnabled: true,
};
const BODY: CreateHourEntryDto = {
  activity: "Planejamento da aula de teclado e mouse",
  category: HourEntryCategory.PLANNING,
  date: "2026-03-10",
  declaredMinutes: 150,
};

describe("hours controllers", () => {
  describe("MyHoursController", () => {
    it.each([["logMyHours", Permission.ACCOUNT_MANAGE_OWN]] as const)(
      "protects MyHoursController.%s with %s and no @Roles",
      (name, permission) => {
        const handler = MyHoursController.prototype[name];

        expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      },
    );

    it.each([
      {
        name: "logMyHours",
        route: "POST /me/hour-entries",
        method: RequestMethod.POST,
        path: "hour-entries",
      },
    ] as const)("routes $name on $route", ({ name, method, path }) => {
      const handler = MyHoursController.prototype[name];

      expect(Reflect.getMetadata("method", handler)).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(PATH_METADATA, MyHoursController)).toBe("me");
    });

    describe("delegation", () => {
      const entry = { id: ENTRY_ID } as HourEntryResponseDto;
      const service = { logMyHours: jest.fn() };
      const controller = new MyHoursController(service as unknown as HoursService);

      beforeEach(() => {
        jest.clearAllMocks();
      });

      it("passes the actor and the body to the service on logMyHours", async () => {
        service.logMyHours.mockResolvedValue(entry);

        await expect(controller.logMyHours(BODY, ACTOR)).resolves.toBe(entry);

        expect(service.logMyHours).toHaveBeenCalledWith(BODY, ACTOR);
      });

      it("passes the failure of the service on as it is", async () => {
        const failure = new HttpException({ error: "HOUR_ENTRY_DATE_IN_FUTURE" }, 400);
        service.logMyHours.mockRejectedValueOnce(failure);

        await expect(controller.logMyHours(BODY, ACTOR)).rejects.toBe(failure);
      });
    });
  });
});
