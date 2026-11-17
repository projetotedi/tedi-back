import { DataSource } from "typeorm";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import { Course } from "../entities/course.entity";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseStatus } from "../enums/course-status.enum";
import { CourseLookupService } from "../services/course-lookup.service";

function buildCourse(id: string, archivedAt: Date | null = null): Course {
  return Object.assign(new Course(), {
    id,
    name: `Curso ${id}`,
    category: CourseCategory.BASIC,
    archive: Object.assign(new ArchivableColumns(), {
      archivedAt,
      archivedById: null,
      archiveReason: null,
    }),
  });
}

describe("CourseLookupService", () => {
  function setup(courses: Course[] = []) {
    const repository = { find: jest.fn(async () => courses), createQueryBuilder: jest.fn() };
    const dataSource = { getRepository: jest.fn(() => repository) };
    const service = new CourseLookupService(dataSource as unknown as DataSource);
    return { service, repository };
  }

  describe("getCourseSummaries()", () => {
    it("does not query for no ids", async () => {
      const { service, repository } = setup();

      expect((await service.getCourseSummaries([])).size).toBe(0);
      expect(repository.find).not.toHaveBeenCalled();
    });

    it("reads every id once, deleted courses included, and keys the summaries by id with the status", async () => {
      const { service, repository } = setup([buildCourse("a"), buildCourse("b", new Date())]);

      const summaries = await service.getCourseSummaries(["a", "b", "a"]);

      expect(repository.find).toHaveBeenCalledTimes(1);
      const [options] = repository.find.mock.calls[0] as unknown as [
        { where: { id: { value: string[] } }; withDeleted: boolean },
      ];
      expect(options.where.id.value).toEqual(["a", "b"]);
      expect(options.withDeleted).toBe(true);
      expect(summaries.get("a")).toEqual({
        id: "a",
        name: "Curso a",
        category: CourseCategory.BASIC,
        status: CourseStatus.ACTIVE,
      });
      expect(summaries.get("b")?.status).toBe(CourseStatus.ARCHIVED);
    });
  });
});
