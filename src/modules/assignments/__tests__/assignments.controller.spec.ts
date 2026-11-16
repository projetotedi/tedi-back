import "reflect-metadata";
import { PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { ApplicationsController } from "../controllers/applications.controller";
import { AssignmentsController } from "../controllers/assignments.controller";
import { LessonApplicationsController } from "../controllers/lesson-applications.controller";
import { LessonAssignmentsController } from "../controllers/lesson-assignments.controller";
import { MemberAssignmentsController } from "../controllers/member-assignments.controller";
import { MyAssignmentsController } from "../controllers/my-assignments.controller";
import { LessonAssignmentResponseDto } from "../dto/lesson-assignment.response.dto";
import { MemberAssignmentResponseDto } from "../dto/member-assignment.response.dto";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { ApplicationsService } from "../services/applications.service";
import { AssignmentsService } from "../services/assignments.service";
import { MyAssignmentsService } from "../services/my-assignments.service";

const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const PERSON_ID = "01999a3e-0000-7000-8000-0000000000b1";
const ASSIGNMENT_ID = "01999a3e-7c1b-7000-8000-0000000000a1";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.DIRECTOR,
  accessEnabled: true,
};

type Controller =
  | typeof LessonAssignmentsController
  | typeof AssignmentsController
  | typeof MemberAssignmentsController
  | typeof LessonApplicationsController
  | typeof ApplicationsController
  | typeof MyAssignmentsController;

/** Every controller of the module: the three of the GUS-158 and the ones of the applications. */
const CONTROLLERS = [
  LessonAssignmentsController,
  AssignmentsController,
  MemberAssignmentsController,
  LessonApplicationsController,
  ApplicationsController,
  MyAssignmentsController,
] as const;

function handlerOf(controller: Controller, name: string): () => void {
  return (controller.prototype as unknown as Record<string, () => void>)[name];
}

/** The id of the route is read through ONE pipe: a malformed id is a 404 of the resource of the URL. */
function pipesOfId(controller: Controller, name: string): unknown[] | undefined {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) as Record<
    string,
    { data: string; pipes: unknown[] }
  >;
  return Object.values(args).find((argument) => argument.data === "id")?.pipes;
}

describe("the controllers of the assignments", () => {
  it.each([
    [LessonAssignmentsController, "createAssignment", Permission.ASSIGNMENTS_CREATE],
    [LessonAssignmentsController, "listLessonAssignments", Permission.LESSONS_VIEW],
    [AssignmentsController, "confirmAssignment", Permission.ASSIGNMENTS_CREATE],
    [AssignmentsController, "cancelAssignment", Permission.ASSIGNMENTS_CREATE],
    [MemberAssignmentsController, "listMemberAssignments", Permission.MEMBERS_VIEW],
    [LessonApplicationsController, "applyToLesson", Permission.ASSIGNMENTS_MANAGE_OWN],
    [ApplicationsController, "listPendingApplications", Permission.ASSIGNMENTS_REVIEW],
    [ApplicationsController, "approveApplication", Permission.ASSIGNMENTS_REVIEW],
    [ApplicationsController, "rejectApplication", Permission.ASSIGNMENTS_REVIEW],
    [MyAssignmentsController, "listMyAssignments", Permission.ASSIGNMENTS_MANAGE_OWN],
    [MyAssignmentsController, "listOpenLessons", Permission.ASSIGNMENTS_MANAGE_OWN],
  ] as const)("protects %s.%s with %s and no @Roles", (controller, name, permission) => {
    const handler = handlerOf(controller, name);

    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });

  it.each([
    {
      controller: LessonAssignmentsController,
      name: "createAssignment",
      method: RequestMethod.POST,
      path: "/",
      base: "lessons/:id/assignments",
    },
    {
      controller: LessonAssignmentsController,
      name: "listLessonAssignments",
      method: RequestMethod.GET,
      path: "/",
      base: "lessons/:id/assignments",
    },
    {
      controller: AssignmentsController,
      name: "confirmAssignment",
      method: RequestMethod.PATCH,
      path: ":id/confirm",
      base: "assignments",
    },
    {
      controller: AssignmentsController,
      name: "cancelAssignment",
      method: RequestMethod.PATCH,
      path: ":id/cancel",
      base: "assignments",
    },
    {
      controller: MemberAssignmentsController,
      name: "listMemberAssignments",
      method: RequestMethod.GET,
      path: "/",
      base: "members/:id/assignments",
    },
    {
      controller: LessonApplicationsController,
      name: "applyToLesson",
      method: RequestMethod.POST,
      path: "/",
      base: "lessons/:id/applications",
    },
    {
      controller: ApplicationsController,
      name: "listPendingApplications",
      method: RequestMethod.GET,
      path: "/",
      base: "applications",
    },
    {
      controller: ApplicationsController,
      name: "approveApplication",
      method: RequestMethod.PATCH,
      path: ":id/approve",
      base: "applications",
    },
    {
      controller: ApplicationsController,
      name: "rejectApplication",
      method: RequestMethod.PATCH,
      path: ":id/reject",
      base: "applications",
    },
    {
      controller: MyAssignmentsController,
      name: "listMyAssignments",
      method: RequestMethod.GET,
      path: "assignments",
      base: "me",
    },
    {
      controller: MyAssignmentsController,
      name: "listOpenLessons",
      method: RequestMethod.GET,
      path: "open-lessons",
      base: "me",
    },
  ] as const)("routes $name on $method $base/$path", ({ controller, name, method, path, base }) => {
    const handler = handlerOf(controller, name);

    expect(Reflect.getMetadata("method", handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe(base);
  });

  it("has exactly the eleven routes of the two cards, and none to delete an assignment: it is cancelled and stays", () => {
    const routes = CONTROLLERS.flatMap((controller: Controller) =>
      Object.getOwnPropertyNames(controller.prototype)
        .filter((name) => name !== "constructor")
        .map((name) => ({
          name,
          method: Reflect.getMetadata("method", handlerOf(controller, name)) as RequestMethod,
        })),
    );

    expect(routes.map((route) => route.name).sort()).toEqual([
      "applyToLesson",
      "approveApplication",
      "cancelAssignment",
      "confirmAssignment",
      "createAssignment",
      "listLessonAssignments",
      "listMemberAssignments",
      "listMyAssignments",
      "listOpenLessons",
      "listPendingApplications",
      "rejectApplication",
    ]);
    expect(routes.map((route) => route.method)).not.toContain(RequestMethod.DELETE);
  });

  it("reads the id of every route through a pipe, so a malformed id is a 404 and not a 500", () => {
    for (const [controller, name] of [
      [LessonAssignmentsController, "createAssignment"],
      [LessonAssignmentsController, "listLessonAssignments"],
      [AssignmentsController, "confirmAssignment"],
      [AssignmentsController, "cancelAssignment"],
      [MemberAssignmentsController, "listMemberAssignments"],
      [LessonApplicationsController, "applyToLesson"],
      [ApplicationsController, "approveApplication"],
      [ApplicationsController, "rejectApplication"],
    ] as const) {
      expect(pipesOfId(controller, name)).toHaveLength(1);
    }
  });

  describe("delegation", () => {
    const assignment = { id: ASSIGNMENT_ID } as LessonAssignmentResponseDto;
    const memberAssignments = [{ id: ASSIGNMENT_ID }] as MemberAssignmentResponseDto[];
    const service = {
      create: jest.fn(),
      listByLesson: jest.fn(),
      confirm: jest.fn(),
      cancel: jest.fn(),
      listByMember: jest.fn(),
    };
    const lessonAssignments = new LessonAssignmentsController(
      service as unknown as AssignmentsService,
    );
    const assignments = new AssignmentsController(service as unknown as AssignmentsService);
    const memberAssignmentsController = new MemberAssignmentsController(
      service as unknown as AssignmentsService,
    );

    beforeEach(() => {
      jest.clearAllMocks();
      service.create.mockResolvedValue(assignment);
      service.confirm.mockResolvedValue(assignment);
      service.cancel.mockResolvedValue(assignment);
      service.listByLesson.mockResolvedValue([assignment]);
      service.listByMember.mockResolvedValue(memberAssignments);
    });

    it("delegates createAssignment to AssignmentsService.create with the lesson, the body and the actor id", async () => {
      const dto = {
        personId: PERSON_ID,
        role: AssignmentRole.MONITOR,
        status: AssignmentStatus.PENDING,
      };

      await expect(lessonAssignments.createAssignment(LESSON_ID, dto, ACTOR)).resolves.toBe(
        assignment,
      );

      expect(service.create).toHaveBeenCalledWith(LESSON_ID, dto, ACTOR.id);
    });

    it("delegates listLessonAssignments to AssignmentsService.listByLesson with the lesson and the whole actor, for the note", async () => {
      await expect(lessonAssignments.listLessonAssignments(LESSON_ID, ACTOR)).resolves.toEqual([
        assignment,
      ]);

      // The whole AuthUser, not only the id: the service asks the policy whether she reads the note.
      expect(service.listByLesson).toHaveBeenCalledWith(LESSON_ID, ACTOR);
    });

    it("delegates confirmAssignment to AssignmentsService.confirm with the id and the actor id", async () => {
      await expect(assignments.confirmAssignment(ASSIGNMENT_ID, ACTOR)).resolves.toBe(assignment);

      expect(service.confirm).toHaveBeenCalledWith(ASSIGNMENT_ID, ACTOR.id);
    });

    it("delegates cancelAssignment to AssignmentsService.cancel with the id and the actor id", async () => {
      await expect(assignments.cancelAssignment(ASSIGNMENT_ID, ACTOR)).resolves.toBe(assignment);

      expect(service.cancel).toHaveBeenCalledWith(ASSIGNMENT_ID, ACTOR.id);
    });

    it("delegates listMemberAssignments to AssignmentsService.listByMember with the member and the whole actor, for the scope", async () => {
      await expect(
        memberAssignmentsController.listMemberAssignments(PERSON_ID, ACTOR),
      ).resolves.toBe(memberAssignments);

      expect(service.listByMember).toHaveBeenCalledWith(PERSON_ID, ACTOR);
    });

    describe("the applications (GUS-160)", () => {
      const pending = { total: 0, lessons: [] };
      const applications = {
        apply: jest.fn(),
        listPending: jest.fn(),
        approve: jest.fn(),
        reject: jest.fn(),
      };
      const lessonApplications = new LessonApplicationsController(
        applications as unknown as ApplicationsService,
      );
      const review = new ApplicationsController(applications as unknown as ApplicationsService);

      beforeEach(() => {
        applications.apply.mockResolvedValue(assignment);
        applications.listPending.mockResolvedValue(pending);
        applications.approve.mockResolvedValue(assignment);
        applications.reject.mockResolvedValue(assignment);
      });

      it("delegates listPendingApplications with the query and the whole actor (for the note)", async () => {
        const query = { status: AssignmentStatus.PENDING } as const;

        await expect(review.listPendingApplications(query, ACTOR)).resolves.toBe(pending);

        expect(applications.listPending).toHaveBeenCalledWith(query, ACTOR);
      });

      it("delegates approveApplication and rejectApplication with the id and the actor id", async () => {
        await expect(review.approveApplication(ASSIGNMENT_ID, ACTOR)).resolves.toBe(assignment);
        await expect(review.rejectApplication(ASSIGNMENT_ID, ACTOR)).resolves.toBe(assignment);

        expect(applications.approve).toHaveBeenCalledWith(ASSIGNMENT_ID, ACTOR.id);
        expect(applications.reject).toHaveBeenCalledWith(ASSIGNMENT_ID, ACTOR.id);
      });

      it("delegates listMyAssignments and listOpenLessons with the query and the whole actor", async () => {
        const mine = { from: "2026-03-09", to: "2026-04-05", totals: {}, items: [] };
        const myAssignments = { listMine: jest.fn(), listOpen: jest.fn() };
        myAssignments.listMine.mockResolvedValue(mine);
        myAssignments.listOpen.mockResolvedValue([]);
        const controller = new MyAssignmentsController(
          myAssignments as unknown as MyAssignmentsService,
        );
        const query = { from: "2026-03-09" };

        await expect(controller.listMyAssignments(query, ACTOR)).resolves.toBe(mine);
        await expect(controller.listOpenLessons(query, ACTOR)).resolves.toEqual([]);

        // The whole AuthUser: the person is the one of the session.
        expect(myAssignments.listMine).toHaveBeenCalledWith(ACTOR, query);
        expect(myAssignments.listOpen).toHaveBeenCalledWith(ACTOR, query);
      });

      it("delegates applyToLesson with the lesson, the body and the whole actor", async () => {
        const dto = { role: AssignmentRole.MONITOR, note: "Chego antes." };

        await expect(lessonApplications.applyToLesson(LESSON_ID, dto, ACTOR)).resolves.toBe(
          assignment,
        );

        // The whole AuthUser: the applicant is the person of the session.
        expect(applications.apply).toHaveBeenCalledWith(LESSON_ID, dto, ACTOR);
      });
    });

    it("passes the failure of the service on as it is", async () => {
      const failure = new Error("boom");
      service.cancel.mockRejectedValueOnce(failure);

      await expect(assignments.cancelAssignment(ASSIGNMENT_ID, ACTOR)).rejects.toBe(failure);
    });
  });
});
