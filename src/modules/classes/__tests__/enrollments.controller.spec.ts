import "reflect-metadata";
import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { ClassesModule } from "../classes.module";
import { ClassEnrollmentsController } from "../controllers/class-enrollments.controller";
import { ClassesController } from "../controllers/classes.controller";
import { EnrollmentsController } from "../controllers/enrollments.controller";
import { EnrollStudentsResponseDto } from "../dto/enroll-students.response.dto";
import { EnrollmentResponseDto } from "../dto/enrollment.response.dto";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import { EnrollmentsService } from "../services/enrollments.service";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const ENROLLMENT_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.DIRECTOR,
  accessEnabled: true,
};

describe("enrollment controllers", () => {
  it.each([
    [ClassEnrollmentsController.prototype.enrollStudents],
    [EnrollmentsController.prototype.updateEnrollmentStatus],
    [EnrollmentsController.prototype.removeEnrollment],
  ])(
    "requires enrollments.manage on enrollStudents, listAvailableStudents, updateEnrollmentStatus and removeEnrollment",
    (handler) => {
      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(Permission.ENROLLMENTS_MANAGE);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    },
  );

  it("tags the three controllers classes and registers them after ClassesController", () => {
    const controllers: unknown[] = Reflect.getMetadata("controllers", ClassesModule);

    for (const controller of [ClassEnrollmentsController, EnrollmentsController]) {
      expect(Reflect.getMetadata("swagger/apiUseTags", controller)).toEqual(["classes"]);
      expect(controllers.indexOf(controller)).toBeGreaterThan(
        controllers.indexOf(ClassesController),
      );
    }
    expect(Reflect.getMetadata(PATH_METADATA, ClassEnrollmentsController)).toBe("classes");
    expect(Reflect.getMetadata(PATH_METADATA, EnrollmentsController)).toBe("enrollments");

    const enroll = ClassEnrollmentsController.prototype.enrollStudents;
    expect(Reflect.getMetadata(PATH_METADATA, enroll)).toBe(":id/enrollments");
    expect(Reflect.getMetadata(METHOD_METADATA, enroll)).toBe(RequestMethod.POST);
    const update = EnrollmentsController.prototype.updateEnrollmentStatus;
    expect(Reflect.getMetadata(PATH_METADATA, update)).toBe(":id");
    expect(Reflect.getMetadata(METHOD_METADATA, update)).toBe(RequestMethod.PATCH);
  });

  it("answers 204 on removeEnrollment", () => {
    const remove = EnrollmentsController.prototype.removeEnrollment;

    expect(Reflect.getMetadata(PATH_METADATA, remove)).toBe(":id");
    expect(Reflect.getMetadata(METHOD_METADATA, remove)).toBe(RequestMethod.DELETE);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, remove)).toBe(HttpStatus.NO_CONTENT);
  });

  it("delegates each route to its service with the id, the body or the query and the actor", async () => {
    const answer: EnrollStudentsResponseDto = { enrolled: [], skipped: [], warnings: [] };
    const enrollment = { id: ENROLLMENT_ID } as EnrollmentResponseDto;
    const service = {
      enroll: jest.fn().mockResolvedValue(answer),
      updateStatus: jest.fn().mockResolvedValue(enrollment),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const writes = service as unknown as EnrollmentsService;
    const classEnrollments = new ClassEnrollmentsController(writes);
    const enrollments = new EnrollmentsController(writes);

    const body = { studentIds: [STUDENT_ID] };
    await expect(classEnrollments.enrollStudents(CLASS_ID, body, ACTOR)).resolves.toBe(answer);
    expect(service.enroll).toHaveBeenCalledWith(CLASS_ID, body, ACTOR.id);

    const change = { status: EnrollmentStatus.DROPPED, effectiveDate: "2026-04-10" };
    await expect(enrollments.updateEnrollmentStatus(ENROLLMENT_ID, change, ACTOR)).resolves.toBe(
      enrollment,
    );
    expect(service.updateStatus).toHaveBeenCalledWith(ENROLLMENT_ID, change, ACTOR.id);

    await expect(enrollments.removeEnrollment(ENROLLMENT_ID, ACTOR)).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith(ENROLLMENT_ID, ACTOR.id);
  });
});
