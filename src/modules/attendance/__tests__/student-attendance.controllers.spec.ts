import "reflect-metadata";
import { HttpException, PipeTransform, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { LessonStudentAttendanceController } from "../controllers/lesson-student-attendance.controller";
import { StudentAttendanceController } from "../controllers/student-attendance.controller";
import { AbsenceJustificationReason } from "../enums/absence-justification-reason.enum";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";
import { StudentAttendanceRecordsService } from "../services/student-attendance-records.service";
import { StudentRollCallService } from "../services/student-roll-call.service";

const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const ATTENDANCE_ID = "01999a3e-7c1b-7000-8000-000000000a01";
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
  it("requires lessons.view on listStudentAttendance, attendance.takeStudents on signStudentAttendance and justifyAbsence, and attendance.correct on correctStudentAttendance", () => {
    expect(Reflect.getMetadata(PATH_METADATA, LessonStudentAttendanceController)).toBe(
      "lessons/:id/attendance/students",
    );
    expect(Reflect.getMetadata(PATH_METADATA, StudentAttendanceController)).toBe(
      "student-attendance",
    );

    for (const [controller, name, permission, method, path] of [
      [
        LessonStudentAttendanceController,
        "listStudentAttendance",
        Permission.LESSONS_VIEW,
        RequestMethod.GET,
        "/",
      ],
      [
        LessonStudentAttendanceController,
        "signStudentAttendance",
        Permission.ATTENDANCE_TAKE_STUDENTS,
        RequestMethod.PUT,
        "/",
      ],
      [
        StudentAttendanceController,
        "justifyAbsence",
        Permission.ATTENDANCE_TAKE_STUDENTS,
        RequestMethod.PATCH,
        ":id/justify",
      ],
      [
        StudentAttendanceController,
        "correctStudentAttendance",
        Permission.ATTENDANCE_CORRECT,
        RequestMethod.PATCH,
        ":id/correct",
      ],
    ] as const) {
      const handler = handlerOf(controller.prototype, name);
      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    }
  });

  it("answers a malformed id with the 404 of the resource of the URL", async () => {
    const metadata = { type: "param" as const, data: "id" };
    for (const [controller, name, code] of [
      [LessonStudentAttendanceController, "listStudentAttendance", "LESSON_NOT_FOUND"],
      [LessonStudentAttendanceController, "signStudentAttendance", "LESSON_NOT_FOUND"],
      [StudentAttendanceController, "justifyAbsence", "STUDENT_ATTENDANCE_NOT_FOUND"],
      [StudentAttendanceController, "correctStudentAttendance", "STUDENT_ATTENDANCE_NOT_FOUND"],
    ] as const) {
      const failure = await Promise.resolve(
        pipeOfId(controller, name).transform("not-a-uuid", metadata),
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(HttpException);
      expect(failure).toMatchObject({ status: 404, response: { error: code } });
    }
  });

  it("tags both controllers attendance and delegates the id, the body and the actor", async () => {
    for (const controller of [LessonStudentAttendanceController, StudentAttendanceController]) {
      expect(Reflect.getMetadata("swagger/apiUseTags", controller)).toEqual(["attendance"]);
    }

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

    const records = {
      justify: jest.fn().mockResolvedValue({ id: "justified" }),
      correct: jest.fn().mockResolvedValue({ id: "corrected" }),
    };
    const recordsController = new StudentAttendanceController(
      records as unknown as StudentAttendanceRecordsService,
    );
    const justification = { reason: AbsenceJustificationReason.HEALTH, note: "Consulta." };
    const correction = { status: StudentAttendanceStatus.ABSENT, reason: "Engano." };
    expect(await recordsController.justifyAbsence(ATTENDANCE_ID, justification, ACTOR)).toEqual({
      id: "justified",
    });
    expect(records.justify).toHaveBeenCalledWith(ATTENDANCE_ID, justification, ACTOR);
    expect(
      await recordsController.correctStudentAttendance(ATTENDANCE_ID, correction, ACTOR),
    ).toEqual({ id: "corrected" });
    expect(records.correct).toHaveBeenCalledWith(ATTENDANCE_ID, correction, ACTOR);
  });
});
