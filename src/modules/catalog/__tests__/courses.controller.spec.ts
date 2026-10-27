import "reflect-metadata";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { CoursesController } from "../controllers/courses.controller";
import { CourseResponseDto } from "../dto/course.response.dto";
import { CourseCategory } from "../enums/course-category.enum";
import { CoursesService } from "../services/courses.service";

const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const PREREQUISITE_ID = "01999a3e-7c1b-7000-8000-000000000002";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.DIRECTOR,
  accessEnabled: true,
};

describe("CoursesController", () => {
  it.each([
    ["createCourse", Permission.COURSES_MANAGE],
    ["updateCourse", Permission.COURSES_MANAGE],
  ] as const)("protects %s with %s and no @Roles", (name, permission) => {
    const handler = CoursesController.prototype[name];

    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });

  describe("delegation", () => {
    const course = { id: COURSE_ID } as CourseResponseDto;
    const service = { create: jest.fn(), update: jest.fn() };
    const controller = new CoursesController(service as unknown as CoursesService);

    beforeEach(() => {
      jest.clearAllMocks();
      for (const method of Object.values(service)) method.mockResolvedValue(course);
    });

    it("delegates createCourse to CoursesService.create with the actor id", async () => {
      const dto = {
        name: "Informática Intermediária",
        description: "Planilhas, textos e apresentações.",
        category: CourseCategory.INTERMEDIATE,
        prerequisiteIds: [PREREQUISITE_ID],
      };

      await expect(controller.createCourse(dto, ACTOR)).resolves.toBe(course);

      expect(service.create).toHaveBeenCalledWith(dto, ACTOR.id);
    });

    it("delegates updateCourse to CoursesService.update with the id and the actor id", async () => {
      const dto = { category: CourseCategory.ADVANCED };

      await expect(controller.updateCourse(COURSE_ID, dto, ACTOR)).resolves.toBe(course);

      expect(service.update).toHaveBeenCalledWith(COURSE_ID, dto, ACTOR.id);
    });
  });
});
