import "reflect-metadata";
import { HttpException, ParseUUIDPipe, RequestMethod } from "@nestjs/common";
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from "@nestjs/common/constants";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { ClassLessonsController } from "../controllers/class-lessons.controller";
import { ClassLessonsPreviewResponseDto } from "../dto/class-lessons-preview.response.dto";
import { GenerateClassLessonsDto } from "../dto/generate-class-lessons.dto";
import { GeneratedClassLessonsResponseDto } from "../dto/generated-class-lessons.response.dto";
import { Weekday } from "../enums/weekday.enum";
import { LessonGenerationService } from "../services/lesson-generation.service";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.DIRECTOR,
  accessEnabled: true,
};

const BODY: GenerateClassLessonsDto = {
  weekday: Weekday.TUESDAY,
  startTime: "09:00",
  endTime: "11:00",
  firstDate: "2026-04-07",
  location: "Laboratório 2 — Bloco B",
};

const HANDLERS = ["previewClassLessons", "generateClassLessons"] as const;

describe("ClassLessonsController", () => {
  it("protects previewClassLessons and generateClassLessons with lessons.manage and no @Roles", () => {
    for (const name of HANDLERS) {
      const handler = ClassLessonsController.prototype[name];

      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(Permission.LESSONS_MANAGE);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    }
  });

  it("is tagged lessons, so the front finds both routes in the file of the module", () => {
    expect(Reflect.getMetadata("swagger/apiUseTags", ClassLessonsController)).toEqual(["lessons"]);
  });

  it("maps POST /classes/:id/lessons/preview with HttpCode 200 and /generate with 201", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ClassLessonsController)).toBe("classes/:id/lessons");

    const preview = ClassLessonsController.prototype.previewClassLessons;
    expect(Reflect.getMetadata(METHOD_METADATA, preview)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, preview)).toBe("preview");
    // The preview creates nothing, so it is a 200 and not the 201 of a POST.
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, preview)).toBe(200);

    const generate = ClassLessonsController.prototype.generateClassLessons;
    expect(Reflect.getMetadata(METHOD_METADATA, generate)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, generate)).toBe("generate");
    // Left alone, Nest answers a POST with 201: it creates the lessons.
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, generate)).toBeUndefined();
  });

  it("has only the two routes of the generation: nothing to undo, delete or regenerate", () => {
    const names = Object.getOwnPropertyNames(ClassLessonsController.prototype).filter(
      (name) => name !== "constructor",
    );

    expect(names.sort()).toEqual(["generateClassLessons", "previewClassLessons"]);
  });

  it("reads the class id through a pipe, so a malformed id is a 404 CLASS_NOT_FOUND", async () => {
    for (const name of HANDLERS) {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, ClassLessonsController, name) as Record<
        string,
        { data: string; pipes: unknown[] }
      >;
      const idArgument = Object.values(args).find((argument) => argument.data === "id");

      expect(idArgument?.pipes).toHaveLength(1);
      const pipe = idArgument?.pipes[0] as ParseUUIDPipe;
      expect(pipe).toBeInstanceOf(ParseUUIDPipe);

      // The pipe answers what the service answers for a class that does not exist.
      const failure = await pipe
        .transform("not-a-uuid", { type: "param", data: "id" })
        .then(() => null)
        .catch((error: unknown) => error as HttpException);
      expect(failure).toBeInstanceOf(HttpException);
      expect(failure?.getStatus()).toBe(404);
      expect(failure?.getResponse()).toEqual({
        error: "CLASS_NOT_FOUND",
        message: "Class not found.",
      });

      await expect(pipe.transform(CLASS_ID, { type: "param", data: "id" })).resolves.toBe(CLASS_ID);
    }
  });

  describe("delegation", () => {
    const preview = { classId: CLASS_ID } as ClassLessonsPreviewResponseDto;
    const generated = { classId: CLASS_ID, lessons: [] } as GeneratedClassLessonsResponseDto;
    const service = { preview: jest.fn(), generate: jest.fn() };
    const controller = new ClassLessonsController(service as unknown as LessonGenerationService);

    beforeEach(() => {
      jest.clearAllMocks();
      service.preview.mockResolvedValue(preview);
      service.generate.mockResolvedValue(generated);
    });

    it("delegates previewClassLessons to LessonGenerationService.preview with the id and the body only", async () => {
      await expect(controller.previewClassLessons(CLASS_ID, BODY)).resolves.toBe(preview);

      expect(service.preview).toHaveBeenCalledWith(CLASS_ID, BODY);
      expect(service.generate).not.toHaveBeenCalled();
    });

    it("delegates generateClassLessons to LessonGenerationService.generate with the id, the body and the actor id", async () => {
      await expect(controller.generateClassLessons(CLASS_ID, BODY, ACTOR)).resolves.toBe(generated);

      expect(service.generate).toHaveBeenCalledWith(CLASS_ID, BODY, ACTOR.id);
      expect(service.preview).not.toHaveBeenCalled();
    });

    it("passes the failure of the service on as it is", async () => {
      const failure = new Error("boom");
      service.generate.mockRejectedValueOnce(failure);
      service.preview.mockRejectedValueOnce(failure);

      await expect(controller.generateClassLessons(CLASS_ID, BODY, ACTOR)).rejects.toBe(failure);
      await expect(controller.previewClassLessons(CLASS_ID, BODY)).rejects.toBe(failure);
    });
  });
});
