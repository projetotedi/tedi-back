import "reflect-metadata";
import { PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { AssignmentsController } from "../controllers/assignments.controller";
import { LessonAssignmentsController } from "../controllers/lesson-assignments.controller";
import { MemberAssignmentsController } from "../controllers/member-assignments.controller";
import { LessonAssignmentResponseDto } from "../dto/lesson-assignment.response.dto";
import { MemberAssignmentResponseDto } from "../dto/member-assignment.response.dto";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { AssignmentsService } from "../services/assignments.service";

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
  | typeof MemberAssignmentsController;

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
  ] as const)("routes $name on $method $base/$path", ({ controller, name, method, path, base }) => {
    const handler = handlerOf(controller, name);

    expect(Reflect.getMetadata("method", handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe(base);
  });

  it("has exactly the five routes of the card, and none to delete an assignment: it is cancelled and stays", () => {
    const routes = (
      [LessonAssignmentsController, AssignmentsController, MemberAssignmentsController] as const
    ).flatMap((controller) =>
      Object.getOwnPropertyNames(controller.prototype)
        .filter((name) => name !== "constructor")
        .map((name) => ({
          name,
          method: Reflect.getMetadata("method", handlerOf(controller, name)) as RequestMethod,
        })),
    );

    expect(routes.map((route) => route.name).sort()).toEqual([
      "cancelAssignment",
      "confirmAssignment",
      "createAssignment",
      "listLessonAssignments",
      "listMemberAssignments",
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

    it("passes the failure of the service on as it is", async () => {
      const failure = new Error("boom");
      service.cancel.mockRejectedValueOnce(failure);

      await expect(assignments.cancelAssignment(ASSIGNMENT_ID, ACTOR)).rejects.toBe(failure);
    });
  });
});
