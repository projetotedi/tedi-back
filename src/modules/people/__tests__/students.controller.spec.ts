import "reflect-metadata";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { StudentsController } from "../controllers/students.controller";
import { StudentDetailDto } from "../dto/student-detail.response.dto";
import { StudentsService } from "../services/students.service";

const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";

describe("StudentsController", () => {
  it("protects getStudent with students.view and no @Roles", () => {
    const handler = StudentsController.prototype.getStudent;

    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(Permission.STUDENTS_VIEW);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });

  it("delegates getStudent to StudentsService.findDetail", async () => {
    const detail = { id: STUDENT_ID } as StudentDetailDto;
    const findDetail = jest.fn().mockResolvedValue(detail);
    const controller = new StudentsController({ findDetail } as unknown as StudentsService);

    await expect(controller.getStudent(STUDENT_ID)).resolves.toBe(detail);

    expect(findDetail).toHaveBeenCalledTimes(1);
    expect(findDetail).toHaveBeenCalledWith(STUDENT_ID);
  });
});
