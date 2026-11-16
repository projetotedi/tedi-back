import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { LessonMemberAttendanceController } from "../controllers/lesson-member-attendance.controller";
import { MemberAttendanceController } from "../controllers/member-attendance.controller";
import { MemberAttendanceStatus } from "../enums/member-attendance-status.enum";
import { MemberAttendanceHistoryService } from "../services/member-attendance-history.service";
import { MemberAttendanceService } from "../services/member-attendance.service";

const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.COORDINATOR,
  accessEnabled: true,
};

function handlerOf(controller: object, name: string): () => void {
  return (controller as Record<string, () => void>)[name];
}

describe("the controllers of the attendance", () => {
  it("requires lessons.view on listMemberAttendance and attendance.confirmMember on confirmMemberAttendance", () => {
    const prototype = LessonMemberAttendanceController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, LessonMemberAttendanceController)).toBe(
      "lessons/:id/attendance/members",
    );

    for (const [name, permission, method] of [
      ["listMemberAttendance", Permission.LESSONS_VIEW, RequestMethod.GET],
      ["confirmMemberAttendance", Permission.ATTENDANCE_CONFIRM_MEMBER, RequestMethod.PUT],
    ] as const) {
      const handler = handlerOf(prototype, name);
      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    }
  });

  it("requires members.view on getMemberAttendanceHistory", () => {
    const handler = handlerOf(MemberAttendanceController.prototype, "getMemberAttendanceHistory");

    expect(Reflect.getMetadata(PATH_METADATA, MemberAttendanceController)).toBe(
      "members/:id/attendance",
    );
    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(Permission.MEMBERS_VIEW);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  it("hands the id, the body and the actor to the services unchanged", async () => {
    const history = { getByMember: jest.fn().mockResolvedValue({ totals: {}, items: [] }) };
    const historyController = new MemberAttendanceController(
      history as unknown as MemberAttendanceHistoryService,
    );
    expect(await historyController.getMemberAttendanceHistory(ACTOR.id, ACTOR)).toEqual({
      totals: {},
      items: [],
    });
    expect(history.getByMember).toHaveBeenCalledWith(ACTOR.id, ACTOR);

    const service = {
      listByLesson: jest.fn().mockResolvedValue(["list"]),
      confirm: jest.fn().mockResolvedValue(["after"]),
    };
    const controller = new LessonMemberAttendanceController(
      service as unknown as MemberAttendanceService,
    );
    const body = {
      entries: [
        {
          assignmentId: "01999a3e-7c1b-7000-8000-0000000000a1",
          status: MemberAttendanceStatus.PRESENT,
        },
      ],
    };

    expect(await controller.listMemberAttendance(LESSON_ID)).toEqual(["list"]);
    expect(service.listByLesson).toHaveBeenCalledWith(LESSON_ID);
    expect(await controller.confirmMemberAttendance(LESSON_ID, body, ACTOR)).toEqual(["after"]);
    expect(service.confirm).toHaveBeenCalledWith(LESSON_ID, body, ACTOR);
  });
});
