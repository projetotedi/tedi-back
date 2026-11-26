import "reflect-metadata";
import { PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { LessonsController } from "../controllers/lessons.controller";
import { LessonsCalendarQueryDto } from "../dto/calendar-query.dto";
import { LessonListItemResponseDto } from "../dto/lesson-list-item.response.dto";
import { LessonResponseDto } from "../dto/lesson.response.dto";
import { ListLessonsQueryDto } from "../dto/list-lessons-query.dto";
import { LessonStatus } from "../enums/lesson-status.enum";
import { LessonListingService } from "../services/lesson-listing.service";
import { LessonsService } from "../services/lessons.service";

const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.DIRECTOR,
  accessEnabled: true,
};

describe("LessonsController", () => {
  it.each([
    ["createLesson", Permission.LESSONS_MANAGE],
    ["listLessons", Permission.LESSONS_VIEW],
    ["listLessonsCalendar", Permission.LESSONS_VIEW],
    ["getLesson", Permission.LESSONS_VIEW],
    ["updateLesson", Permission.LESSONS_MANAGE],
    ["cancelLesson", Permission.LESSONS_MANAGE],
    ["rescheduleLesson", Permission.LESSONS_MANAGE],
  ] as const)("protects %s with %s and no @Roles", (name, permission) => {
    const handler = LessonsController.prototype[name];

    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });

  it("lets every profile read and only lessons.manage write: the three reads are the routes on lessons.view", () => {
    const reads = (
      [
        "createLesson",
        "listLessons",
        "listLessonsCalendar",
        "getLesson",
        "updateLesson",
        "cancelLesson",
        "rescheduleLesson",
      ] as const
    ).filter(
      (name) =>
        Reflect.getMetadata(PERMISSION_KEY, LessonsController.prototype[name]) ===
        Permission.LESSONS_VIEW,
    );

    expect(reads).toEqual(["listLessons", "listLessonsCalendar", "getLesson"]);
  });

  it.each([
    { name: "createLesson", route: "POST /lessons", method: RequestMethod.POST, path: "/" },
    { name: "listLessons", route: "GET /lessons", method: RequestMethod.GET, path: "/" },
    {
      name: "listLessonsCalendar",
      route: "GET /lessons/calendar",
      method: RequestMethod.GET,
      path: "calendar",
    },
    { name: "getLesson", route: "GET /lessons/:id", method: RequestMethod.GET, path: ":id" },
    {
      name: "updateLesson",
      route: "PATCH /lessons/:id",
      method: RequestMethod.PATCH,
      path: ":id",
    },
    {
      name: "cancelLesson",
      route: "PATCH /lessons/:id/cancel",
      method: RequestMethod.PATCH,
      path: ":id/cancel",
    },
    {
      name: "rescheduleLesson",
      route: "PATCH /lessons/:id/reschedule",
      method: RequestMethod.PATCH,
      path: ":id/reschedule",
    },
  ] as const)("routes $name on $route", ({ name, method, path }) => {
    const handler = LessonsController.prototype[name];

    expect(Reflect.getMetadata("method", handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(PATH_METADATA, LessonsController)).toBe("lessons");
  });

  it("has no route to delete a lesson: it is cancelled and stays", () => {
    const names = Object.getOwnPropertyNames(LessonsController.prototype).filter(
      (name) => name !== "constructor",
    );

    expect(names.sort()).toEqual([
      "cancelLesson",
      "createLesson",
      "getLesson",
      "listLessons",
      "listLessonsCalendar",
      "rescheduleLesson",
      "updateLesson",
    ]);
    for (const name of names) {
      const method = Reflect.getMetadata(
        "method",
        (LessonsController.prototype as unknown as Record<string, () => void>)[name],
      );
      expect(method).not.toBe(RequestMethod.DELETE);
    }
  });

  it("reads the id of the route of the four lesson routes through a pipe, so a malformed id is a 404", () => {
    for (const name of ["getLesson", "updateLesson", "cancelLesson", "rescheduleLesson"] as const) {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, LessonsController, name) as Record<
        string,
        { data: string; pipes: unknown[] }
      >;
      const idArgument = Object.values(args).find((argument) => argument.data === "id");

      expect(idArgument?.pipes).toHaveLength(1);
    }
  });

  it("declares listLessons and listLessonsCalendar before getLesson, so GET /lessons/calendar is not taken for GET /lessons/:id", () => {
    // Express matches in registration order and Nest registers the methods in the order they are
    // declared: `:id` first would answer 404 LESSON_NOT_FOUND for "calendar".
    const names = Object.getOwnPropertyNames(LessonsController.prototype);
    const list = names.indexOf("listLessons");
    const calendar = names.indexOf("listLessonsCalendar");
    const detail = names.indexOf("getLesson");

    expect(list).toBeGreaterThan(-1);
    expect(calendar).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(-1);
    expect(list).toBeLessThan(detail);
    expect(calendar).toBeLessThan(detail);
  });

  it("validates the query of each read route with its own DTO: the calendar needs the period, the list does not", () => {
    const paramTypes = (name: string): unknown =>
      Reflect.getMetadata("design:paramtypes", LessonsController.prototype, name);

    expect(paramTypes("listLessons")).toEqual([ListLessonsQueryDto]);
    expect(paramTypes("listLessonsCalendar")).toEqual([LessonsCalendarQueryDto]);
  });

  it("reads the query of the two routes with @Query(), and takes no id from the path", () => {
    for (const name of ["listLessons", "listLessonsCalendar"] as const) {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, LessonsController, name) as Record<
        string,
        { data: unknown }
      >;

      expect(Object.keys(args)).toHaveLength(1);
      expect(Object.keys(args)[0]).toContain(`${RouteParamtypes.QUERY}:`);
    }
  });

  describe("delegation", () => {
    const lesson = { id: LESSON_ID } as LessonResponseDto;
    const service = {
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
      reschedule: jest.fn(),
    };
    const listing = { list: jest.fn(), listCalendar: jest.fn() };
    const controller = new LessonsController(
      service as unknown as LessonsService,
      listing as unknown as LessonListingService,
    );

    beforeEach(() => {
      jest.clearAllMocks();
      for (const method of Object.values(service)) method.mockResolvedValue(lesson);
    });

    it("delegates listLessons to LessonListingService.list with the query, and answers its page", async () => {
      const page = { data: [], total: 0, page: 1, limit: 20 };
      listing.list.mockResolvedValue(page);
      const query = Object.assign(new ListLessonsQueryDto(), {
        classId: CLASS_ID,
        status: LessonStatus.PLANNED,
      });

      await expect(controller.listLessons(query)).resolves.toBe(page);

      expect(listing.list).toHaveBeenCalledWith(query);
      expect(listing.listCalendar).not.toHaveBeenCalled();
      expect(service.findById).not.toHaveBeenCalled();
    });

    it("delegates listLessonsCalendar to LessonListingService.listCalendar with the query, and answers its array", async () => {
      const items = [{ id: LESSON_ID }] as LessonListItemResponseDto[];
      listing.listCalendar.mockResolvedValue(items);
      const query = Object.assign(new LessonsCalendarQueryDto(), {
        from: "2026-03-01",
        to: "2026-04-11",
      });

      await expect(controller.listLessonsCalendar(query)).resolves.toBe(items);

      expect(listing.listCalendar).toHaveBeenCalledWith(query);
      expect(listing.list).not.toHaveBeenCalled();
      expect(service.findById).not.toHaveBeenCalled();
    });

    it("passes the failure of the listing on as it is", async () => {
      const failure = new Error("boom");
      listing.list.mockRejectedValueOnce(failure);
      listing.listCalendar.mockRejectedValueOnce(failure);

      await expect(controller.listLessons(new ListLessonsQueryDto())).rejects.toBe(failure);
      await expect(
        controller.listLessonsCalendar(
          Object.assign(new LessonsCalendarQueryDto(), { from: "2026-03-01", to: "2026-03-07" }),
        ),
      ).rejects.toBe(failure);
    });

    it("delegates createLesson to LessonsService.create with the actor id", async () => {
      const dto = {
        classId: CLASS_ID,
        title: "Teclado, mouse e janelas",
        date: "2026-03-10",
        startTime: "14:00",
        endTime: "15:30",
      };

      await expect(controller.createLesson(dto, ACTOR)).resolves.toBe(lesson);

      expect(service.create).toHaveBeenCalledWith(dto, ACTOR.id);
    });

    it("delegates getLesson to LessonsService.findById with the id only", async () => {
      await expect(controller.getLesson(LESSON_ID)).resolves.toBe(lesson);

      expect(service.findById).toHaveBeenCalledWith(LESSON_ID);
    });

    it("delegates updateLesson to LessonsService.update with the id, the body and the actor id", async () => {
      const dto = { status: LessonStatus.CONFIRMED };

      await expect(controller.updateLesson(LESSON_ID, dto, ACTOR)).resolves.toBe(lesson);

      expect(service.update).toHaveBeenCalledWith(LESSON_ID, dto, ACTOR.id);
    });

    it("delegates cancelLesson to LessonsService.cancel with the id, the body and the actor id", async () => {
      const dto = { reason: "Feriado municipal." };

      await expect(controller.cancelLesson(LESSON_ID, dto, ACTOR)).resolves.toBe(lesson);

      expect(service.cancel).toHaveBeenCalledWith(LESSON_ID, dto, ACTOR.id);
    });

    it("delegates rescheduleLesson to LessonsService.reschedule with the id, the body and the actor id", async () => {
      const dto = { date: "2026-03-17", startTime: "14:00", endTime: "15:30" };

      await expect(controller.rescheduleLesson(LESSON_ID, dto, ACTOR)).resolves.toBe(lesson);

      expect(service.reschedule).toHaveBeenCalledWith(LESSON_ID, dto, ACTOR.id);
    });

    it("passes the failure of the service on as it is", async () => {
      const failure = new Error("boom");
      service.cancel.mockRejectedValueOnce(failure);

      await expect(controller.cancelLesson(LESSON_ID, { reason: "Feriado." }, ACTOR)).rejects.toBe(
        failure,
      );
    });
  });
});
