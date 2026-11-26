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
import { CourseClassesController } from "../controllers/course-classes.controller";
import { EnrollmentsController } from "../controllers/enrollments.controller";
import { StudentEnrollmentsController } from "../controllers/student-enrollments.controller";
import { EnrollStudentsResponseDto } from "../dto/enroll-students.response.dto";
import { EnrollmentResponseDto } from "../dto/enrollment.response.dto";
import { StudentEnrollmentsResponseDto } from "../dto/student-enrollments.response.dto";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import { StudentEnrollmentSituation } from "../enums/student-enrollment-situation.enum";
import { EnrollmentListingService } from "../services/enrollment-listing.service";
import { EnrollmentsService } from "../services/enrollments.service";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const ENROLLMENT_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";
const ACTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000aa",
  role: Role.DIRECTOR,
  accessEnabled: true,
};
const EMPTY_PAGE = { data: [], total: 0, page: 1, limit: 20 };

function route(handler: object): [string, RequestMethod] {
  return [
    Reflect.getMetadata(PATH_METADATA, handler),
    Reflect.getMetadata(METHOD_METADATA, handler),
  ];
}

describe("enrollment controllers", () => {
  it.each([
    ["enrollStudents", ClassEnrollmentsController.prototype.enrollStudents],
    ["listAvailableStudents", ClassEnrollmentsController.prototype.listAvailableStudents],
    ["updateEnrollmentStatus", EnrollmentsController.prototype.updateEnrollmentStatus],
    ["removeEnrollment", EnrollmentsController.prototype.removeEnrollment],
  ])(
    "requires enrollments.manage on enrollStudents, listAvailableStudents, updateEnrollmentStatus and removeEnrollment (%s)",
    (_name, handler) => {
      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(Permission.ENROLLMENTS_MANAGE);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    },
  );

  it("requires classes.view on listClassEnrollments and students.view on listStudentEnrollments and listStudentsByEnrollment", () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        ClassEnrollmentsController.prototype.listClassEnrollments,
      ),
    ).toBe(Permission.CLASSES_VIEW);
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        StudentEnrollmentsController.prototype.listStudentEnrollments,
      ),
    ).toBe(Permission.STUDENTS_VIEW);
    expect(
      Reflect.getMetadata(PERMISSION_KEY, EnrollmentsController.prototype.listStudentsByEnrollment),
    ).toBe(Permission.STUDENTS_VIEW);
  });

  it("tags the three controllers classes and registers them after ClassesController", () => {
    const controllers: unknown[] = Reflect.getMetadata("controllers", ClassesModule);

    // CourseClassesController keeps the first place (its literal routes under /classes/).
    expect(controllers.indexOf(CourseClassesController)).toBe(0);
    for (const controller of [
      ClassEnrollmentsController,
      EnrollmentsController,
      StudentEnrollmentsController,
    ]) {
      expect(Reflect.getMetadata("swagger/apiUseTags", controller)).toEqual(["classes"]);
      expect(controllers.indexOf(controller)).toBeGreaterThan(
        controllers.indexOf(ClassesController),
      );
    }

    expect(Reflect.getMetadata(PATH_METADATA, ClassEnrollmentsController)).toBe("classes");
    expect(route(ClassEnrollmentsController.prototype.enrollStudents)).toEqual([
      ":id/enrollments",
      RequestMethod.POST,
    ]);
    expect(route(ClassEnrollmentsController.prototype.listClassEnrollments)).toEqual([
      ":id/enrollments",
      RequestMethod.GET,
    ]);
    expect(route(ClassEnrollmentsController.prototype.listAvailableStudents)).toEqual([
      ":id/available-students",
      RequestMethod.GET,
    ]);
    expect(Reflect.getMetadata(PATH_METADATA, EnrollmentsController)).toBe("enrollments");
    expect(route(EnrollmentsController.prototype.updateEnrollmentStatus)).toEqual([
      ":id",
      RequestMethod.PATCH,
    ]);
    expect(route(EnrollmentsController.prototype.listStudentsByEnrollment)).toEqual([
      "students",
      RequestMethod.GET,
    ]);
    expect(Reflect.getMetadata(PATH_METADATA, StudentEnrollmentsController)).toBe("students");
    expect(route(StudentEnrollmentsController.prototype.listStudentEnrollments)).toEqual([
      ":id/enrollments",
      RequestMethod.GET,
    ]);
  });

  it("answers 204 on removeEnrollment", () => {
    const remove = EnrollmentsController.prototype.removeEnrollment;

    expect(route(remove)).toEqual([":id", RequestMethod.DELETE]);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, remove)).toBe(HttpStatus.NO_CONTENT);
  });

  it("delegates each route to its service with the id, the body or the query and the actor", async () => {
    const answer: EnrollStudentsResponseDto = { enrolled: [], skipped: [], warnings: [] };
    const enrollment = { id: ENROLLMENT_ID } as EnrollmentResponseDto;
    const history = { enrollments: [] } as unknown as StudentEnrollmentsResponseDto;
    const writes = {
      enroll: jest.fn().mockResolvedValue(answer),
      updateStatus: jest.fn().mockResolvedValue(enrollment),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const reads = {
      listClassEnrollments: jest.fn().mockResolvedValue(EMPTY_PAGE),
      listAvailableStudents: jest.fn().mockResolvedValue(EMPTY_PAGE),
      listStudentEnrollments: jest.fn().mockResolvedValue(history),
      listStudentsByEnrollment: jest.fn().mockResolvedValue(EMPTY_PAGE),
    };
    const writesService = writes as unknown as EnrollmentsService;
    const readsService = reads as unknown as EnrollmentListingService;
    const classEnrollments = new ClassEnrollmentsController(writesService, readsService);
    const enrollments = new EnrollmentsController(writesService, readsService);
    const studentEnrollments = new StudentEnrollmentsController(readsService);

    const body = { studentIds: [STUDENT_ID] };
    await expect(classEnrollments.enrollStudents(CLASS_ID, body, ACTOR)).resolves.toBe(answer);
    expect(writes.enroll).toHaveBeenCalledWith(CLASS_ID, body, ACTOR.id);

    const classQuery = { page: 2, status: EnrollmentStatus.ACTIVE };
    await expect(classEnrollments.listClassEnrollments(CLASS_ID, classQuery, ACTOR)).resolves.toBe(
      EMPTY_PAGE,
    );
    expect(reads.listClassEnrollments).toHaveBeenCalledWith(CLASS_ID, classQuery, ACTOR);

    const availableQuery = { search: "Ana" };
    await expect(classEnrollments.listAvailableStudents(CLASS_ID, availableQuery)).resolves.toBe(
      EMPTY_PAGE,
    );
    expect(reads.listAvailableStudents).toHaveBeenCalledWith(CLASS_ID, availableQuery);

    const change = { status: EnrollmentStatus.DROPPED, effectiveDate: "2026-04-10" };
    await expect(enrollments.updateEnrollmentStatus(ENROLLMENT_ID, change, ACTOR)).resolves.toBe(
      enrollment,
    );
    expect(writes.updateStatus).toHaveBeenCalledWith(ENROLLMENT_ID, change, ACTOR.id);

    await expect(enrollments.removeEnrollment(ENROLLMENT_ID, ACTOR)).resolves.toBeUndefined();
    expect(writes.remove).toHaveBeenCalledWith(ENROLLMENT_ID, ACTOR.id);

    const byEnrollment = { classId: CLASS_ID, situation: StudentEnrollmentSituation.NOT_ENROLLED };
    await expect(enrollments.listStudentsByEnrollment(byEnrollment)).resolves.toBe(EMPTY_PAGE);
    expect(reads.listStudentsByEnrollment).toHaveBeenCalledWith(byEnrollment);

    await expect(studentEnrollments.listStudentEnrollments(STUDENT_ID)).resolves.toBe(history);
    expect(reads.listStudentEnrollments).toHaveBeenCalledWith(STUDENT_ID);
  });
});
