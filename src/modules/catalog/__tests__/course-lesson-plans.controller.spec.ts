import "reflect-metadata";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { CourseLessonPlansController } from "../controllers/course-lesson-plans.controller";
import { CourseLessonPlansResponseDto } from "../dto/course-lesson-plans.response.dto";
import { CourseLessonPlansService } from "../services/course-lesson-plans.service";

const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000009";
const FIRST_PLAN_ID = "01999a3e-7c1b-7000-8000-000000000001";
const SECOND_PLAN_ID = "01999a3e-7c1b-7000-8000-000000000002";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.DIRECTOR,
  accessEnabled: true,
};

describe("CourseLessonPlansController", () => {
  it.each([
    ["listCourseLessonPlans", Permission.CATALOG_VIEW],
    ["replaceCourseLessonPlans", Permission.COURSES_MANAGE],
  ] as const)("protects %s with %s and no @Roles", (name, permission) => {
    const handler = CourseLessonPlansController.prototype[name];

    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });

  describe("delegation", () => {
    const sequence = { courseId: COURSE_ID } as CourseLessonPlansResponseDto;
    const service = { list: jest.fn(), replace: jest.fn() };
    const controller = new CourseLessonPlansController(
      service as unknown as CourseLessonPlansService,
    );

    beforeEach(() => {
      jest.clearAllMocks();
      for (const method of Object.values(service)) method.mockResolvedValue(sequence);
    });

    it("delegates listCourseLessonPlans to list with the id", async () => {
      await expect(controller.listCourseLessonPlans(COURSE_ID)).resolves.toBe(sequence);

      expect(service.list).toHaveBeenCalledWith(COURSE_ID);
      expect(service.replace).not.toHaveBeenCalled();
    });

    it("delegates replaceCourseLessonPlans to replace with the id, the dto and the actor id", async () => {
      const dto = { lessonPlanIds: [SECOND_PLAN_ID, FIRST_PLAN_ID] };

      await expect(controller.replaceCourseLessonPlans(COURSE_ID, dto, ACTOR)).resolves.toBe(
        sequence,
      );

      expect(service.replace).toHaveBeenCalledWith(COURSE_ID, dto, ACTOR.id);
      expect(service.list).not.toHaveBeenCalled();
    });
  });
});
