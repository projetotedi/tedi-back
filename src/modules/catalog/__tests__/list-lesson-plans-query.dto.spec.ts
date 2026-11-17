import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ListLessonPlansQueryDto } from "../dto/list-lesson-plans-query.dto";
import { LessonPlanListSort, LessonPlanUsageFilter } from "../enums/lesson-plan-list.enums";

async function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(ListLessonPlansQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, fields: errors.map((error) => error.property).sort() };
}

describe("ListLessonPlansQueryDto", () => {
  it("accepts an empty query", async () => {
    expect((await parse({})).fields).toEqual([]);
  });

  it("turns the strings of the query string into numbers", async () => {
    const { dto, fields } = await parse({
      page: "2",
      limit: "50",
      search: "teclado",
      content: "janela",
      usage: "unused",
      minDuration: "60",
      maxDuration: "120",
      excludeCourseId: "01999a3e-7c1b-7000-8000-000000000002",
      sort: "updatedAt",
    });

    expect(fields).toEqual([]);
    expect(dto).toMatchObject({
      page: 2,
      limit: 50,
      usage: LessonPlanUsageFilter.UNUSED,
      minDuration: 60,
      maxDuration: 120,
      sort: LessonPlanListSort.UPDATED_AT,
    });
  });

  it.each([
    [{ usage: "everything" }, "usage"],
    [{ sort: "duration" }, "sort"],
    [{ minDuration: "0" }, "minDuration"],
    [{ maxDuration: "1441" }, "maxDuration"],
    [{ minDuration: "abc" }, "minDuration"],
    [{ excludeCourseId: "course-a" }, "excludeCourseId"],
    [{ content: "x".repeat(101) }, "content"],
    [{ limit: "101" }, "limit"],
  ])("refuses %o", async (query, field) => {
    expect((await parse(query)).fields).toEqual([field]);
  });

  it("refuses a range that ends before it starts, on maxDuration", async () => {
    expect((await parse({ minDuration: "120", maxDuration: "60" })).fields).toEqual([
      "maxDuration",
    ]);
    expect((await parse({ minDuration: "60", maxDuration: "60" })).fields).toEqual([]);
    expect((await parse({ maxDuration: "60" })).fields).toEqual([]);
  });
});
