import "reflect-metadata";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { LessonPlansController } from "../controllers/lesson-plans.controller";
import { LessonPlanResponseDto } from "../dto/lesson-plan.response.dto";
import { LessonPlansService } from "../services/lesson-plans.service";

const PLAN_ID = "01999a3e-7c1b-7000-8000-000000000001";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.DIRECTOR,
  accessEnabled: true,
};

describe("LessonPlansController", () => {
  it.each([
    ["createLessonPlan", Permission.LESSON_PLANS_MANAGE],
    ["getLessonPlan", Permission.CATALOG_VIEW],
    ["updateLessonPlan", Permission.LESSON_PLANS_MANAGE],
    ["archiveLessonPlan", Permission.LESSON_PLANS_MANAGE],
    ["unarchiveLessonPlan", Permission.LESSON_PLANS_MANAGE],
  ] as const)("protects %s with %s and no @Roles", (name, permission) => {
    const handler = LessonPlansController.prototype[name];

    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });

  describe("delegation", () => {
    const plan = { id: PLAN_ID } as LessonPlanResponseDto;
    const service = {
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      unarchive: jest.fn(),
    };
    const controller = new LessonPlansController(service as unknown as LessonPlansService);

    beforeEach(() => {
      jest.clearAllMocks();
      for (const method of Object.values(service)) method.mockResolvedValue(plan);
    });

    it("delegates createLessonPlan to LessonPlansService.create with the actor id", async () => {
      const dto = { title: "Janelas", expectedDurationMinutes: 45, contents: ["Janelas"] };

      await expect(controller.createLessonPlan(dto, ACTOR)).resolves.toBe(plan);

      expect(service.create).toHaveBeenCalledWith(dto, ACTOR.id);
    });

    it("delegates getLessonPlan to LessonPlansService.findById", async () => {
      await expect(controller.getLessonPlan(PLAN_ID)).resolves.toBe(plan);

      expect(service.findById).toHaveBeenCalledWith(PLAN_ID);
    });

    it("delegates updateLessonPlan to LessonPlansService.update with the actor id", async () => {
      const dto = { expectedDurationMinutes: 120 };

      await expect(controller.updateLessonPlan(PLAN_ID, dto, ACTOR)).resolves.toBe(plan);

      expect(service.update).toHaveBeenCalledWith(PLAN_ID, dto, ACTOR.id);
    });

    it("delegates archiveLessonPlan to LessonPlansService.archive with the reason and the actor id", async () => {
      const dto = { reason: "Conteúdo revisado." };

      await expect(controller.archiveLessonPlan(PLAN_ID, dto, ACTOR)).resolves.toBe(plan);

      expect(service.archive).toHaveBeenCalledWith(PLAN_ID, dto, ACTOR.id);
    });

    it("delegates unarchiveLessonPlan to LessonPlansService.unarchive with the actor id", async () => {
      await expect(controller.unarchiveLessonPlan(PLAN_ID, ACTOR)).resolves.toBe(plan);

      expect(service.unarchive).toHaveBeenCalledWith(PLAN_ID, ACTOR.id);
    });
  });
});
