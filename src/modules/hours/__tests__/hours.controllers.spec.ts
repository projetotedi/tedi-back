import "reflect-metadata";
import { HttpException, PipeTransform, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { MemberHoursController } from "../controllers/member-hours.controller";
import { MyHoursController } from "../controllers/my-hours.controller";
import { CreateHourEntryDto } from "../dto/create-hour-entry.dto";
import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { HoursSummaryResponseDto } from "../dto/hours-summary.response.dto";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { HoursService } from "../services/hours.service";

const ENTRY_ID = "01999a3e-7c1b-7000-8000-000000000a01";
const MEMBER_ID = "01999a3e-0000-7000-8000-0000000000bb";
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

/** The pipes of the `id` argument of a handler, as Nest will run them. */
function idPipesOf(controller: object, name: string): PipeTransform[] {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) as Record<
    string,
    { data: string; pipes: PipeTransform[] }
  >;
  return Object.values(args).find((argument) => argument.data === "id")?.pipes ?? [];
}

/** The HTTP methods of every handler of a controller. */
function methodsOf(controller: { prototype: object }): RequestMethod[] {
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== "constructor")
    .map((name) =>
      Reflect.getMetadata("method", (controller.prototype as Record<string, () => void>)[name]),
    );
}

describe("hours controllers", () => {
  describe("MyHoursController", () => {
    it.each([
      ["logMyHours", Permission.ACCOUNT_MANAGE_OWN],
      ["listMyHourEntries", Permission.ACCOUNT_MANAGE_OWN],
      ["getMyHoursSummary", Permission.ACCOUNT_MANAGE_OWN],
      ["removeMyHourEntry", Permission.ACCOUNT_MANAGE_OWN],
    ] as const)("protects MyHoursController.%s with %s and no @Roles", (name, permission) => {
      const handler = MyHoursController.prototype[name];

      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    });

    it.each([
      {
        name: "logMyHours",
        route: "POST /me/hour-entries",
        method: RequestMethod.POST,
        path: "hour-entries",
      },
      {
        name: "listMyHourEntries",
        route: "GET /me/hour-entries",
        method: RequestMethod.GET,
        path: "hour-entries",
      },
      {
        name: "getMyHoursSummary",
        route: "GET /me/hours/summary",
        method: RequestMethod.GET,
        path: "hours/summary",
      },
      {
        name: "removeMyHourEntry",
        route: "DELETE /me/hour-entries/:id",
        method: RequestMethod.DELETE,
        path: "hour-entries/:id",
      },
    ] as const)("routes $name on $route", ({ name, method, path }) => {
      const handler = MyHoursController.prototype[name];

      expect(Reflect.getMetadata("method", handler)).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(PATH_METADATA, MyHoursController)).toBe("me");
    });

    it("answers 204 on removeMyHourEntry", () => {
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, MyHoursController.prototype.removeMyHourEntry),
      ).toBe(204);
    });

    it("has no route to edit an hour entry: it is removed and logged again", () => {
      const methods = methodsOf(MyHoursController);

      expect(methods).toHaveLength(4);
      expect(methods).not.toContain(RequestMethod.PATCH);
      expect(methods).not.toContain(RequestMethod.PUT);
    });

    it("answers 404 HOUR_ENTRY_NOT_FOUND to a malformed id of removeMyHourEntry, through the pipe of the route", async () => {
      const pipes = idPipesOf(MyHoursController, "removeMyHourEntry");
      expect(pipes).toHaveLength(1);

      const failure: unknown = await Promise.resolve(
        pipes[0].transform("not-a-uuid", { type: "param", data: "id" }),
      ).catch((error: unknown) => error);

      if (!(failure instanceof HttpException)) throw new Error("Expected an HttpException");
      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toMatchObject({ error: "HOUR_ENTRY_NOT_FOUND" });
      await expect(
        Promise.resolve(pipes[0].transform(ENTRY_ID.toUpperCase(), { type: "param", data: "id" })),
      ).resolves.toBe(ENTRY_ID.toUpperCase());
    });

    describe("delegation", () => {
      const entry = { id: ENTRY_ID } as HourEntryResponseDto;
      const service = {
        logMyHours: jest.fn(),
        listMyEntries: jest.fn(),
        getMySummary: jest.fn(),
        removeMyEntry: jest.fn(),
      };
      const controller = new MyHoursController(service as unknown as HoursService);

      beforeEach(() => {
        jest.clearAllMocks();
      });

      it("passes the actor and the body to the service on logMyHours", async () => {
        service.logMyHours.mockResolvedValue(entry);

        await expect(controller.logMyHours(BODY, ACTOR)).resolves.toBe(entry);

        expect(service.logMyHours).toHaveBeenCalledWith(BODY, ACTOR);
      });

      it("passes the actor and the query to the service on listMyHourEntries", async () => {
        const page: PaginatedResult<HourEntryResponseDto> = {
          data: [entry],
          total: 1,
          page: 1,
          limit: 20,
        };
        service.listMyEntries.mockResolvedValue(page);
        const query = { status: HourEntryStatus.PENDING, from: "2026-03-01" };

        await expect(controller.listMyHourEntries(query, ACTOR)).resolves.toBe(page);

        expect(service.listMyEntries).toHaveBeenCalledWith(ACTOR, query);
      });

      it("passes the actor and the period to the service on getMyHoursSummary", async () => {
        const summary = { bankMinutes: 0 } as HoursSummaryResponseDto;
        service.getMySummary.mockResolvedValue(summary);
        const query = { from: "2026-03-01", to: "2026-03-31" };

        await expect(controller.getMyHoursSummary(query, ACTOR)).resolves.toBe(summary);

        expect(service.getMySummary).toHaveBeenCalledWith(ACTOR, query);
      });

      it("passes the id and the actor to the service on removeMyHourEntry", async () => {
        service.removeMyEntry.mockResolvedValue(undefined);

        await expect(controller.removeMyHourEntry(ENTRY_ID, ACTOR)).resolves.toBeUndefined();

        expect(service.removeMyEntry).toHaveBeenCalledWith(ENTRY_ID, ACTOR);
      });

      it("passes the failure of the service on as it is", async () => {
        const failure = new HttpException({ error: "ENTRY_NOT_PENDING" }, 409);
        service.removeMyEntry.mockRejectedValueOnce(failure);

        await expect(controller.removeMyHourEntry(ENTRY_ID, ACTOR)).rejects.toBe(failure);
      });
    });
  });

  describe("MemberHoursController", () => {
    it("protects MemberHoursController.logHoursForMember with hours.logForOthers and no @Roles", () => {
      const handler = MemberHoursController.prototype.logHoursForMember;

      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(Permission.HOURS_LOG_FOR_OTHERS);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    });

    it("routes logHoursForMember on POST /members/:id/hour-entries", () => {
      const handler = MemberHoursController.prototype.logHoursForMember;

      expect(Reflect.getMetadata("method", handler)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(":id/hour-entries");
      expect(Reflect.getMetadata(PATH_METADATA, MemberHoursController)).toBe("members");
    });

    it("has no route to edit an hour entry either", () => {
      expect(methodsOf(MemberHoursController)).toEqual([RequestMethod.POST]);
    });

    it("answers 404 MEMBER_NOT_FOUND to a malformed id, through the pipe of the route", async () => {
      const pipes = idPipesOf(MemberHoursController, "logHoursForMember");
      expect(pipes).toHaveLength(1);

      const failure: unknown = await Promise.resolve(
        pipes[0].transform("not-a-uuid", { type: "param", data: "id" }),
      ).catch((error: unknown) => error);

      if (!(failure instanceof HttpException)) throw new Error("Expected an HttpException");
      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "MEMBER_NOT_FOUND",
        message: "Member not found.",
      });
    });

    describe("delegation", () => {
      const service = { logHoursForMember: jest.fn() };
      const controller = new MemberHoursController(service as unknown as HoursService);

      beforeEach(() => {
        jest.clearAllMocks();
      });

      it("passes the id, the body and the actor to the service", async () => {
        const entry = { id: ENTRY_ID } as HourEntryResponseDto;
        service.logHoursForMember.mockResolvedValue(entry);

        await expect(controller.logHoursForMember(MEMBER_ID, BODY, ACTOR)).resolves.toBe(entry);

        expect(service.logHoursForMember).toHaveBeenCalledWith(MEMBER_ID, BODY, ACTOR);
      });

      it("passes the failure of the service on as it is", async () => {
        const failure = new HttpException({ error: "FORBIDDEN_SCOPE" }, 403);
        service.logHoursForMember.mockRejectedValueOnce(failure);

        await expect(controller.logHoursForMember(MEMBER_ID, BODY, ACTOR)).rejects.toBe(failure);
      });
    });
  });
});
