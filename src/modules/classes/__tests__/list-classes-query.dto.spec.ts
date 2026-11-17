import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ListClassesQueryDto } from "../dto/list-classes-query.dto";
import { ClassListSort } from "../enums/class-list-sort.enum";
import { ClassStatus } from "../enums/class-status.enum";

async function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(ListClassesQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, fields: errors.map((error) => error.property).sort() };
}

describe("ListClassesQueryDto", () => {
  it("accepts an empty query", async () => {
    const { fields } = await parse({});

    expect(fields).toEqual([]);
  });

  it("turns the strings of the query string into numbers, booleans and a list of statuses", async () => {
    const { dto, fields } = await parse({
      page: "2",
      limit: "10",
      editionId: "01999a3e-7c1b-7000-8000-0000000000e1",
      courseId: "01999a3e-7c1b-7000-8000-000000000001",
      category: "basic",
      status: "planned, in_progress",
      archived: "false",
      sort: "code",
    });

    expect(fields).toEqual([]);
    expect(dto).toMatchObject({
      page: 2,
      limit: 10,
      status: [ClassStatus.PLANNED, ClassStatus.IN_PROGRESS],
      archived: false,
      sort: ClassListSort.CODE,
    });
  });

  it("reads a repeated status and keeps each value once", async () => {
    const { dto, fields } = await parse({ status: ["completed", "planned,completed"] });

    expect(fields).toEqual([]);
    expect(dto.status).toEqual([ClassStatus.COMPLETED, ClassStatus.PLANNED]);
  });

  it.each([
    [{ status: "open" }, "status"],
    [{ status: "planned,closed" }, "status"],
    [{ status: 3 }, "status"],
    [{ archived: "yes" }, "archived"],
    [{ editionId: "2026.1" }, "editionId"],
    [{ courseId: "abc" }, "courseId"],
    [{ category: "expert" }, "category"],
    [{ sort: "name" }, "sort"],
    [{ limit: "101" }, "limit"],
    [{ page: "0" }, "page"],
    [{ search: "x".repeat(101) }, "search"],
  ])("rejects %j in %s", async (query, field) => {
    const { fields } = await parse(query);

    expect(fields).toEqual([field]);
  });
});
