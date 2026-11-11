import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { ClassesModule } from "../classes.module";
import { ClassesController } from "../controllers/classes.controller";
import { CourseClassesController } from "../controllers/course-classes.controller";
import { ClassesSummaryByCourseQueryDto } from "../dto/classes-summary-by-course-query.dto";
import { ClassesSummaryByCourseResponseDto } from "../dto/classes-summary-by-course.response.dto";
import { CourseClassItemResponseDto } from "../dto/course-class-item.response.dto";
import { ListCourseClassesQueryDto } from "../dto/list-course-classes-query.dto";
import { ClassStatus } from "../enums/class-status.enum";
import { CourseClassesService } from "../services/course-classes.service";

const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const OTHER_COURSE_ID = "01999a3e-7c1b-7000-8000-000000000002";

describe("CourseClassesController", () => {
  it.each([["listCourseClasses"], ["getClassesSummaryByCourse"]] as const)(
    "protects %s with classes.view and no @Roles",
    (name) => {
      const handler = CourseClassesController.prototype[name];

      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(Permission.CLASSES_VIEW);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    },
  );

  it("is tagged classes, so the front finds both routes in the file of the module", () => {
    expect(Reflect.getMetadata("swagger/apiUseTags", CourseClassesController)).toEqual(["classes"]);
  });

  it("serves GET courses/:id/classes and GET classes/summary-by-course, from the root", () => {
    expect(Reflect.getMetadata(PATH_METADATA, CourseClassesController)).toBe("/");

    const list = CourseClassesController.prototype.listCourseClasses;
    expect(Reflect.getMetadata(PATH_METADATA, list)).toBe("courses/:id/classes");
    expect(Reflect.getMetadata(METHOD_METADATA, list)).toBe(RequestMethod.GET);

    const summary = CourseClassesController.prototype.getClassesSummaryByCourse;
    expect(Reflect.getMetadata(PATH_METADATA, summary)).toBe("classes/summary-by-course");
    expect(Reflect.getMetadata(METHOD_METADATA, summary)).toBe(RequestMethod.GET);
  });

  it("is registered before ClassesController, so the detail GET /classes/:id never captures summary-by-course", () => {
    const controllers: unknown[] = Reflect.getMetadata("controllers", ClassesModule);

    expect(controllers.indexOf(CourseClassesController)).toBe(0);
    expect(controllers.indexOf(CourseClassesController)).toBeLessThan(
      controllers.indexOf(ClassesController),
    );
  });

  describe("delegation", () => {
    const page: PaginatedResult<CourseClassItemResponseDto> = {
      data: [],
      total: 0,
      page: 1,
      limit: 20,
    };
    const summary: ClassesSummaryByCourseResponseDto[] = [
      { courseId: COURSE_ID, total: 2, active: 2 },
    ];
    const service = { listCourseClasses: jest.fn(), summarizeByCourse: jest.fn() };
    const controller = new CourseClassesController(service as unknown as CourseClassesService);

    beforeEach(() => {
      jest.clearAllMocks();
      service.listCourseClasses.mockResolvedValue(page);
      service.summarizeByCourse.mockResolvedValue(summary);
    });

    it("delegates listCourseClasses to CourseClassesService.listCourseClasses with the id and the query", async () => {
      const query: ListCourseClassesQueryDto = { page: 2, limit: 10, status: ClassStatus.PLANNED };

      await expect(controller.listCourseClasses(COURSE_ID, query)).resolves.toBe(page);

      expect(service.listCourseClasses).toHaveBeenCalledTimes(1);
      expect(service.listCourseClasses).toHaveBeenCalledWith(COURSE_ID, query);
    });

    it("delegates getClassesSummaryByCourse to CourseClassesService.summarizeByCourse with the ids", async () => {
      const query: ClassesSummaryByCourseQueryDto = { courseIds: [COURSE_ID, OTHER_COURSE_ID] };

      await expect(controller.getClassesSummaryByCourse(query)).resolves.toBe(summary);

      expect(service.summarizeByCourse).toHaveBeenCalledTimes(1);
      expect(service.summarizeByCourse).toHaveBeenCalledWith([COURSE_ID, OTHER_COURSE_ID]);
    });
  });
});
