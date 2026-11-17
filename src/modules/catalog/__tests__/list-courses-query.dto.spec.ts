import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ListCoursesQueryDto } from "../dto/list-courses-query.dto";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseListSort } from "../enums/course-list-sort.enum";
import { CourseStatus } from "../enums/course-status.enum";

async function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(ListCoursesQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, fields: errors.map((error) => error.property).sort() };
}

describe("ListCoursesQueryDto", () => {
  it("accepts an empty query", async () => {
    const { dto, fields } = await parse({});

    expect(fields).toEqual([]);
    expect(dto).toEqual(new ListCoursesQueryDto());
  });

  it("turns the strings of the query string into numbers and booleans", async () => {
    const { dto, fields } = await parse({
      page: "2",
      limit: "50",
      search: "informatica",
      category: "basic",
      status: "active",
      hasPrerequisite: "true",
      sort: "createdAt",
    });

    expect(fields).toEqual([]);
    expect(dto).toMatchObject({
      page: 2,
      limit: 50,
      search: "informatica",
      category: CourseCategory.BASIC,
      status: CourseStatus.ACTIVE,
      hasPrerequisite: true,
      sort: CourseListSort.CREATED_AT,
    });
  });

  it("reads hasPrerequisite=false as false, not as a truthy string", async () => {
    const { dto, fields } = await parse({ hasPrerequisite: "false" });

    expect(fields).toEqual([]);
    expect(dto.hasPrerequisite).toBe(false);
  });

  it.each([
    [{ page: "0" }, "page"],
    [{ page: "1.5" }, "page"],
    [{ limit: "101" }, "limit"],
    [{ limit: "abc" }, "limit"],
    [{ search: "x".repeat(101) }, "search"],
    [{ category: "expert" }, "category"],
    [{ status: "deleted" }, "status"],
    [{ hasPrerequisite: "sim" }, "hasPrerequisite"],
    [{ sort: "title" }, "sort"],
  ])("rejects %j in %s", async (query, field) => {
    const { fields } = await parse(query);

    expect(fields).toEqual([field]);
  });
});
