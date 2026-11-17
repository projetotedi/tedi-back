import "reflect-metadata";
import { HttpException, PipeTransform, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { LessonStudentAttendanceController } from "../controllers/lesson-student-attendance.controller";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";
import { StudentRollCallService } from "../services/student-roll-call.service";

const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.MEMBER,
  accessEnabled: true,
};

function handlerOf(controller: object, name: string): () => void {
  return (controller as Record<string, () => void>)[name];
}

/** The pipe that reads the id of the route: a malformed id is a 404 of the resource of the URL. */
function pipeOfId(controller: object, name: string): PipeTransform {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) as Record<
    string,
    { data: string; pipes: PipeTransform[] }
  >;
  const pipe = Object.values(args).find((argument) => argument.data === "id")?.pipes[0];
  if (pipe === undefined) throw new Error(`${name} has no pipe on its id.`);
  return pipe;
}

describe("the controllers of the roll call of the students", () => {
  it("requires lessons.view on listStudentAttendance and attendance.takeStudents on signStudentAttendance", () => {
    expect(Reflect.getMetadata(PATH_METADATA, LessonStudentAttendanceController)).toBe(
      "lessons/:id/attendance/students",
    );

    for (const [name, permission, method] of [
      ["listStudentAttendance", Permission.LESSONS_VIEW, RequestMethod.GET],
      ["signStudentAttendance", Permission.ATTENDANCE_TAKE_STUDENTS, RequestMethod.PUT],
    ] as const) {
      const handler = handlerOf(LessonStudentAttendanceController.prototype, name);
      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    }
  });

  it("answers a malformed id with 404 LESSON_NOT_FOUND", async () => {
    const metadata = { type: "param" as const, data: "id" };
    for (const name of ["listStudentAttendance", "signStudentAttendance"]) {
      const failure = await Promise.resolve(
        pipeOfId(LessonStudentAttendanceController, name).transform("not-a-uuid", metadata),
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(HttpException);
      expect(failure).toMatchObject({ status: 404, response: { error: "LESSON_NOT_FOUND" } });
    }
  });

  it("tags both controllers attendance and delegates the id, the body and the actor", async () => {
    expect(Reflect.getMetadata("swagger/apiUseTags", LessonStudentAttendanceController)).toEqual([
      "attendance",
    ]);

    const service = {
      list: jest.fn().mockResolvedValue(["list"]),
      sign: jest.fn().mockResolvedValue(["after"]),
    };
    const controller = new LessonStudentAttendanceController(
      service as unknown as StudentRollCallService,
    );
    const body = {
      entries: [
        {
          enrollmentId: "01999a3e-7c1b-7000-8000-000000000e01",
          status: StudentAttendanceStatus.PRESENT,
        },
      ],
    };

    expect(await controller.listStudentAttendance(LESSON_ID, ACTOR)).toEqual(["list"]);
    expect(service.list).toHaveBeenCalledWith(LESSON_ID, ACTOR);
    expect(await controller.signStudentAttendance(LESSON_ID, body, ACTOR)).toEqual(["after"]);
    expect(service.sign).toHaveBeenCalledWith(LESSON_ID, body, ACTOR);
  });
});
