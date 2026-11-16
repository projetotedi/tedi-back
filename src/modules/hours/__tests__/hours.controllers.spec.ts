import "reflect-metadata";
import { HttpException, PipeTransform, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { HourEntriesController } from "../controllers/hour-entries.controller";
import { HoursController } from "../controllers/hours.controller";
import { MemberHoursViewController } from "../controllers/member-hours-view.controller";
import { MemberHoursController } from "../controllers/member-hours.controller";
import { MyHoursController } from "../controllers/my-hours.controller";
import { CreateHourEntryDto } from "../dto/create-hour-entry.dto";
import { HourEntryResponseDto } from "../dto/hour-entry.response.dto";
import { HoursSummaryResponseDto } from "../dto/hours-summary.response.dto";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { HoursReviewService } from "../services/hours-review.service";
import { HoursViewService } from "../services/hours-view.service";
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

  describe("HoursController", () => {
    it.each([["getHoursOverview", Permission.HOURS_VIEW_OTHERS]] as const)(
      "protects HoursController.%s with %s and no @Roles",
      (name, permission) => {
        const handler = HoursController.prototype[name];

        expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      },
    );

    it.each([
      {
        name: "getHoursOverview",
        route: "GET /hours/overview",
        method: RequestMethod.GET,
        path: "overview",
      },
    ] as const)("routes $name on $route", ({ name, method, path }) => {
      const handler = HoursController.prototype[name];

      expect(Reflect.getMetadata("method", handler)).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(PATH_METADATA, HoursController)).toBe("hours");
    });

    it("passes the actor and the query to the view service on getHoursOverview", async () => {
      const viewService = { getOverview: jest.fn() };
      const controller = new HoursController(viewService as unknown as HoursViewService);
      const overview = { members: { data: [], total: 0, page: 1, limit: 20 } };
      viewService.getOverview.mockResolvedValue(overview);
      const query = { from: "2026-03-01", to: "2026-03-31", search: "Ana" };

      await expect(controller.getHoursOverview(query, ACTOR)).resolves.toBe(overview);

      expect(viewService.getOverview).toHaveBeenCalledWith(ACTOR, query);
    });
  });

  describe("MemberHoursViewController", () => {
    it("protects getMemberHours with hours.viewOthers and no @Roles, on GET /members/:id/hours", () => {
      const handler = MemberHoursViewController.prototype.getMemberHours;

      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(Permission.HOURS_VIEW_OTHERS);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata("method", handler)).toBe(RequestMethod.GET);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(":id/hours");
      expect(Reflect.getMetadata(PATH_METADATA, MemberHoursViewController)).toBe("members");
      expect(methodsOf(MemberHoursViewController)).toEqual([RequestMethod.GET]);
    });

    it("answers 404 MEMBER_NOT_FOUND to a malformed id, through the pipe of the route", async () => {
      const pipes = idPipesOf(MemberHoursViewController, "getMemberHours");
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

    it("passes the id, the query and the actor to the service", async () => {
      const viewService = { getMemberHours: jest.fn() };
      const controller = new MemberHoursViewController(viewService as unknown as HoursViewService);
      const hours = { member: { id: MEMBER_ID } };
      viewService.getMemberHours.mockResolvedValue(hours);
      const query = { from: "2026-03-01", page: 2 };

      await expect(controller.getMemberHours(MEMBER_ID, query, ACTOR)).resolves.toBe(hours);

      expect(viewService.getMemberHours).toHaveBeenCalledWith(MEMBER_ID, ACTOR, query);
    });
  });

  describe("HourEntriesController", () => {
    it.each([
      ["listPendingHourEntries", Permission.HOURS_VIEW_OTHERS],
      ["validateHourEntries", Permission.HOURS_REVIEW],
      ["adjustHourEntry", Permission.HOURS_REVIEW],
      ["rejectHourEntry", Permission.HOURS_REVIEW],
      ["getHourEntryHistory", Permission.ACCOUNT_MANAGE_OWN],
    ] as const)("protects HourEntriesController.%s with %s and no @Roles", (name, permission) => {
      const handler = HourEntriesController.prototype[name];

      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    });

    it.each([
      {
        name: "listPendingHourEntries",
        route: "GET /hour-entries",
        method: RequestMethod.GET,
        path: "/",
      },
      {
        name: "validateHourEntries",
        route: "PATCH /hour-entries/validate",
        method: RequestMethod.PATCH,
        path: "validate",
      },
      {
        name: "adjustHourEntry",
        route: "PATCH /hour-entries/:id/adjust",
        method: RequestMethod.PATCH,
        path: ":id/adjust",
      },
      {
        name: "rejectHourEntry",
        route: "PATCH /hour-entries/:id/reject",
        method: RequestMethod.PATCH,
        path: ":id/reject",
      },
      {
        name: "getHourEntryHistory",
        route: "GET /hour-entries/:id/history",
        method: RequestMethod.GET,
        path: ":id/history",
      },
    ] as const)("routes $name on $route", ({ name, method, path }) => {
      const handler = HourEntriesController.prototype[name];

      expect(Reflect.getMetadata("method", handler)).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(PATH_METADATA, HourEntriesController)).toBe("hour-entries");
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBeUndefined();
    });

    it("has no route that edits the declared fields of an entry: only the review routes patch it", () => {
      const patches = Object.getOwnPropertyNames(HourEntriesController.prototype).filter(
        (name) =>
          name !== "constructor" &&
          Reflect.getMetadata(
            "method",
            (HourEntriesController.prototype as unknown as Record<string, () => void>)[name],
          ) === RequestMethod.PATCH,
      );

      expect(patches.sort()).toEqual(["adjustHourEntry", "rejectHourEntry", "validateHourEntries"]);
      expect(methodsOf(HourEntriesController)).not.toContain(RequestMethod.PUT);
      expect(methodsOf(HourEntriesController)).not.toContain(RequestMethod.DELETE);
    });

    it.each(["adjustHourEntry", "rejectHourEntry", "getHourEntryHistory"] as const)(
      "answers 404 HOUR_ENTRY_NOT_FOUND to a malformed id of %s, through the pipe of the route",
      async (name) => {
        const pipes = idPipesOf(HourEntriesController, name);
        expect(pipes).toHaveLength(1);

        const failure: unknown = await Promise.resolve(
          pipes[0].transform("not-a-uuid", { type: "param", data: "id" }),
        ).catch((error: unknown) => error);

        if (!(failure instanceof HttpException)) throw new Error("Expected an HttpException");
        expect(failure.getStatus()).toBe(404);
        expect(failure.getResponse()).toEqual({
          error: "HOUR_ENTRY_NOT_FOUND",
          message: "Hour entry not found.",
        });
      },
    );

    describe("delegation", () => {
      const entry = { id: ENTRY_ID } as HourEntryResponseDto;
      const reviewService = {
        validateEntries: jest.fn(),
        adjustEntry: jest.fn(),
        rejectEntry: jest.fn(),
      };
      const viewService = { listEntries: jest.fn(), getHistory: jest.fn() };
      const controller = new HourEntriesController(
        viewService as unknown as HoursViewService,
        reviewService as unknown as HoursReviewService,
      );

      beforeEach(() => {
        jest.clearAllMocks();
      });

      it("passes the body and the actor to the review service on validateHourEntries", async () => {
        reviewService.validateEntries.mockResolvedValue([entry]);
        const dto = { ids: [ENTRY_ID] };

        await expect(controller.validateHourEntries(dto, ACTOR)).resolves.toEqual([entry]);

        expect(reviewService.validateEntries).toHaveBeenCalledWith(dto, ACTOR);
      });

      it("passes the id, the body and the actor to the review service on adjustHourEntry and rejectHourEntry", async () => {
        reviewService.adjustEntry.mockResolvedValue(entry);
        reviewService.rejectEntry.mockResolvedValue(entry);
        const adjust = { validatedMinutes: 120, justification: "Duas horas." };
        const reject = { reason: "Fora do projeto." };

        await expect(controller.adjustHourEntry(ENTRY_ID, adjust, ACTOR)).resolves.toBe(entry);
        await expect(controller.rejectHourEntry(ENTRY_ID, reject, ACTOR)).resolves.toBe(entry);

        expect(reviewService.adjustEntry).toHaveBeenCalledWith(ENTRY_ID, adjust, ACTOR);
        expect(reviewService.rejectEntry).toHaveBeenCalledWith(ENTRY_ID, reject, ACTOR);
      });

      it("passes the actor and the query to the view service on listPendingHourEntries, and the id on getHourEntryHistory", async () => {
        const page = { data: [], total: 0, page: 1, limit: 20 };
        viewService.listEntries.mockResolvedValue(page);
        viewService.getHistory.mockResolvedValue([]);
        const query = { status: HourEntryStatus.PENDING, personId: MEMBER_ID, from: "2026-03-01" };

        await expect(controller.listPendingHourEntries(query, ACTOR)).resolves.toBe(page);
        await expect(controller.getHourEntryHistory(ENTRY_ID, ACTOR)).resolves.toEqual([]);

        expect(viewService.listEntries).toHaveBeenCalledWith(ACTOR, query);
        expect(viewService.getHistory).toHaveBeenCalledWith(ENTRY_ID, ACTOR);
      });

      it("passes the failure of the review service on as it is", async () => {
        const failure = new HttpException({ error: "SELF_REVIEW_NOT_ALLOWED" }, 409);
        reviewService.adjustEntry.mockRejectedValueOnce(failure);

        await expect(
          controller.adjustHourEntry(
            ENTRY_ID,
            { validatedMinutes: 120, justification: "Duas horas." },
            ACTOR,
          ),
        ).rejects.toBe(failure);
      });
    });
  });
});
