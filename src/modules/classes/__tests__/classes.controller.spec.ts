import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { ClassesController } from "../controllers/classes.controller";
import { ClassDetailDto } from "../dto/class-detail.response.dto";
import { ClassResponseDto } from "../dto/class.response.dto";
import { ClassStatus } from "../enums/class-status.enum";
import { ClassDetailService } from "../services/class-detail.service";
import { ClassListService } from "../services/class-list.service";
import { ClassesService } from "../services/classes.service";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.DIRECTOR,
  accessEnabled: true,
};

describe("ClassesController", () => {
  it.each([
    ["listClasses", Permission.CLASSES_VIEW],
    ["getClass", Permission.CLASSES_VIEW],
    ["createClass", Permission.CLASSES_MANAGE],
    ["updateClass", Permission.CLASSES_MANAGE],
    ["archiveClass", Permission.CLASSES_MANAGE],
    ["unarchiveClass", Permission.CLASSES_MANAGE],
  ] as const)("protects %s with %s and no @Roles", (name, permission) => {
    const handler = ClassesController.prototype[name];

    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });

  it("serves GET /classes for the list", () => {
    const handler = ClassesController.prototype.listClasses;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("/");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  it("serves GET /classes/:id", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ClassesController)).toBe("classes");

    const handler = ClassesController.prototype.getClass;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(":id");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  describe("delegation", () => {
    const schoolClass = { id: CLASS_ID } as ClassResponseDto;
    const service = {
      create: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      unarchive: jest.fn(),
    };
    const detail = { id: CLASS_ID } as ClassDetailDto;
    const detailService = { findDetail: jest.fn() };
    const listService = { list: jest.fn() };
    const controller = new ClassesController(
      service as unknown as ClassesService,
      detailService as unknown as ClassDetailService,
      listService as unknown as ClassListService,
    );

    beforeEach(() => {
      jest.clearAllMocks();
      for (const method of Object.values(service)) method.mockResolvedValue(schoolClass);
      detailService.findDetail.mockResolvedValue(detail);
    });

    it("delegates listClasses to ClassListService.list with the query", async () => {
      const page = { data: [], total: 0, page: 1, limit: 20 };
      listService.list.mockResolvedValue(page);
      const query = { search: "info", status: [ClassStatus.PLANNED] };

      await expect(controller.listClasses(query)).resolves.toBe(page);

      expect(listService.list).toHaveBeenCalledWith(query);
      expect(detailService.findDetail).not.toHaveBeenCalled();
    });

    it("delegates getClass to ClassDetailService.findDetail with the id", async () => {
      await expect(controller.getClass(CLASS_ID)).resolves.toBe(detail);

      expect(detailService.findDetail).toHaveBeenCalledTimes(1);
      expect(detailService.findDetail).toHaveBeenCalledWith(CLASS_ID);
    });

    it("delegates createClass to ClassesService.create with the actor id", async () => {
      const dto = {
        courseId: COURSE_ID,
        code: "INFO-A",
        editionName: "2026.1",
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        capacity: 15,
      };

      await expect(controller.createClass(dto, ACTOR)).resolves.toBe(schoolClass);

      expect(service.create).toHaveBeenCalledWith(dto, ACTOR.id);
    });

    it("delegates updateClass to ClassesService.update with the id and the actor id", async () => {
      const dto = { status: ClassStatus.IN_PROGRESS };

      await expect(controller.updateClass(CLASS_ID, dto, ACTOR)).resolves.toBe(schoolClass);

      expect(service.update).toHaveBeenCalledWith(CLASS_ID, dto, ACTOR.id);
    });

    it("hands the courseId of the edit to ClassesService.update untouched", async () => {
      const dto = { courseId: COURSE_ID, capacity: 20 };

      await controller.updateClass(CLASS_ID, dto, ACTOR);

      expect(service.update).toHaveBeenCalledWith(CLASS_ID, dto, ACTOR.id);
      expect(service.update.mock.calls[0][1]).toBe(dto);
    });

    it("delegates archiveClass to ClassesService.archive with the id, the body and the actor id", async () => {
      const dto = { reason: "Turma encerrada." };

      await expect(controller.archiveClass(CLASS_ID, dto, ACTOR)).resolves.toBe(schoolClass);

      expect(service.archive).toHaveBeenCalledWith(CLASS_ID, dto, ACTOR.id);
    });

    it("delegates unarchiveClass to ClassesService.unarchive with the id and the actor id", async () => {
      await expect(controller.unarchiveClass(CLASS_ID, ACTOR)).resolves.toBe(schoolClass);

      expect(service.unarchive).toHaveBeenCalledWith(CLASS_ID, ACTOR.id);
    });
  });
});
